const { client } = require('../redis');
const { pool } = require('../db');

const ADMIN_SESSION_TTL = 24 * 60 * 60; // 24 hours

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

    if (user.role !== 'admin') {
      // User is no longer admin - invalidate session
      await client.del(`admin_session:${token}`);
      return res.status(403).json({ success: false, message: '权限不足' });
    }

    // Attach user to request for use in routes
    req.adminUser = user;
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
    // Scan for all admin sessions belonging to this user
    const keys = await client.keys('admin_session:*');
    for (const key of keys) {
      const sessionData = await client.get(key);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        if (session.user_id === userId) {
          await client.del(key);
        }
      }
    }
  } catch (err) {
    console.error('Error invalidating admin sessions:', err);
  }
}

module.exports = {
  requireAdmin,
  createAdminSession,
  deleteAdminSession,
  invalidateUserAdminSessions
};