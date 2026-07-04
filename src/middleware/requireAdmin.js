const { client } = require('../redis');
const { pool } = require('../db');

const ADMIN_SESSION_TTL = 24 * 60 * 60; // 24 hours

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  user_admin: ['users.read', 'users.write', 'users.reset_password', 'users.delete', 'users.ban', 'users.unlock', 'authorizations.read', 'login_logs.read'],
  security_admin: ['users.read', 'users.ban', 'users.unlock', 'audit_logs.read', 'sms_audit.read', 'ip_bans.read', 'ip_bans.write'],
  config_admin: ['config.read', 'config.write', 'clients.read', 'clients.write', 'sms_config.read', 'sms_config.write', 'email_config.read', 'email_config.write'],
  readonly_admin: ['users.read', 'authorizations.read', 'login_logs.read', 'audit_logs.read', 'sms_audit.read', 'clients.read', 'config.read', 'sms_config.read', 'email_config.read', 'ip_bans.read'],
};

function normalizeRole(role) {
  const value = String(role || '').trim();
  if (value === 'admin') return 'super_admin';
  return ROLE_PERMISSIONS[value] ? value : null;
}

function isAdminRole(role) {
  return !!normalizeRole(role);
}

function hasAdminPermission(admin, permission) {
  const role = normalizeRole(admin?.role);
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function requireAdminPermission(permission) {
  return (req, res, next) => {
    if (!req.isAdmin || !req.adminUser) {
      return res.status(401).json({ success: false, message: '未登录管理员' });
    }
    if (!hasAdminPermission(req.adminUser, permission)) {
      return res.status(403).json({ success: false, message: '无权限' });
    }
    next();
  };
}

/**
 * Require admin middleware
 * - Validates admin session exists in Redis
 * - Verifies user is actually an admin in database (prevents privilege escalation)
 */
async function requireAdmin(req, res, next) {
  const token = req.cookies.admin_session;
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录管理员' });
  }

  try {
    // Check Redis for admin session
    const sessionData = await client.get(`admin_session:${token}`);
    if (!sessionData) {
      return res.status(401).json({ success: false, message: '管理员会话已失效' });
    }

    const session = JSON.parse(sessionData);
    const userId = session.user_id;

    if (!userId) {
      // Legacy session without user_id - invalidate it
      await client.del(`admin_session:${token}`);
      return res.status(401).json({ success: false, message: '管理员会话格式无效' });
    }

    // Verify user is actually an admin in database
    const [userRows] = await pool.execute(
      'SELECT id, username, email, role FROM users WHERE id = ?',
      [userId]
    );
    const user = userRows[0];

    if (!user) {
      // User doesn't exist - invalidate session
      await client.del(`admin_session:${token}`);
      return res.status(401).json({ success: false, message: '用户不存在' });
    }

    const normalizedRole = normalizeRole(user.role);
    if (!normalizedRole) {
      // User is no longer admin - invalidate session
      await client.del(`admin_session:${token}`);
      return res.status(403).json({ success: false, message: '权限不足' });
    }

    // Attach user to request for use in routes
    req.adminUser = { ...user, normalized_role: normalizedRole };
    req.admin = req.adminUser;
    req.isAdmin = true;
    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ success: false, message: '服务器错误' });
  }
}

/**
 * Create admin session in Redis
 * Stores user_id for database role verification
 */
async function createAdminSession(token, userId) {
  await client.setEx(`admin_session:${token}`, ADMIN_SESSION_TTL, JSON.stringify({
    user_id: userId,
    created: Date.now()
  }));
}

/**
 * Delete admin session from Redis
 */
async function deleteAdminSession(token) {
  await client.del(`admin_session:${token}`);
}

/**
 * Invalidate all admin sessions for a user
 * Call this when user's role changes from admin to non-admin
 */
async function invalidateUserAdminSessions(userId) {
  try {
    // Use SCAN instead of KEYS to avoid blocking Redis
    let cursor = '0';
    do {
      const result = await client.scan(cursor, 'MATCH', 'admin_session:*', 'COUNT', 100);
      cursor = result.cursor;

      for (const key of result.keys) {
        const sessionData = await client.get(key);
        if (sessionData) {
          const session = JSON.parse(sessionData);
          if (session.user_id === userId) {
            await client.del(key);
          }
        }
      }
    } while (cursor !== '0');
  } catch (err) {
    console.error('Error invalidating admin sessions:', err);
  }
}

module.exports = {
  requireAdmin,
  requireAdminPermission,
  hasAdminPermission,
  normalizeRole,
  isAdminRole,
  ROLE_PERMISSIONS,
  createAdminSession,
  deleteAdminSession,
  invalidateUserAdminSessions
};
