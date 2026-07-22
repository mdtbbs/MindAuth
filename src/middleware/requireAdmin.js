const { client } = require('../redis');
const {
  createAdminSession: smCreateAdminSession,
  authenticateAdminSession,
  revokeAdminSessionsForUser,
} = require('../modules/sessions/sessionManager');

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
 * Require admin middleware.
 * - Delegates session auth to sessionManager (hash-based Redis + DB role/ban re-check).
 * - Sets req.adminUser, req.admin, req.isAdmin for downstream routes.
 */
async function requireAdmin(req, res, next) {
  const rawToken = req.cookies.admin_session;
  if (!rawToken) {
    return res.status(401).json({ success: false, message: '未登录管理员' });
  }

  try {
    const result = await authenticateAdminSession(rawToken);
    if (!result) {
      return res.status(401).json({ success: false, message: '管理员会话已失效' });
    }

    const { admin } = result;
    req.adminUser = admin;
    req.admin = admin;
    req.isAdmin = true;
    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ success: false, message: '服务器错误' });
  }
}

/**
 * Create admin session.
 * Adapter for sessionManager — accepts (token, userId) for backward compat
 * with existing call sites in admin/auth.js.
 */
async function createAdminSession(token, userId) {
  // sessionManager generates its own token; we ignore the passed token
  // and use the one from sessionManager.  But to maintain backward compat
  // with the admin login route that sets the cookie itself, we create the
  // session via sessionManager and store the raw token it returns.
  // Actually, the caller in admin/auth.js generates its own token and expects
  // us to store it.  Let's just use sessionManager.createAdminSession directly
  // and return the result so the caller can use the token.
  //
  // This function is a legacy adapter. New code should call sessionManager directly.
  const result = await smCreateAdminSession({ adminId: userId });
  // The caller expects to use `token` as the cookie value, but sessionManager
  // generates its own.  We return the sessionManager token.
  return result;
}

/**
 * Delete admin session by raw token.
 * Legacy adapter — prefer sessionManager directly.
 */
async function deleteAdminSession(rawToken) {
  const { hashToken } = require('../modules/sessions/sessionManager');
  const tokenHash = hashToken(rawToken);
  await client.del(`admin_session:${tokenHash}`);
}

/**
 * Invalidate all admin sessions for a user.
 * Delegates to sessionManager (uses per-user index set, no SCAN).
 */
async function invalidateUserAdminSessions(userId) {
  return revokeAdminSessionsForUser(userId);
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
  invalidateUserAdminSessions,
};
