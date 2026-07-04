const { pool } = require('../db');
const { client } = require('../redis');

const SESSION_CACHE_TTL = 86400; // 24 hours cache (session valid for 30 days)

async function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  try {
    // Check Redis cache first
    const cachedUser = await client.get(`session:${token}`);
    if (cachedUser) {
      const parsedUser = JSON.parse(cachedUser);
      if (Object.prototype.hasOwnProperty.call(parsedUser, 'phone_verified')) {
        req.user = parsedUser;
        return next();
      }
    }

    // Fallback to MySQL (exclude password_hash for security)
    const [rows] = await pool.execute(
      'SELECT id, username, email, email_verified, role, avatar_url, banner_url, phone, phone_verified, phone_verified_at, created_at FROM users WHERE session_token = ?',
      [token]
    );

    if (!rows[0]) {
      return res.status(401).json({ success: false, message: '会话已失效' });
    }

    req.user = rows[0];

    // Cache for future requests
    await client.setEx(`session:${token}`, SESSION_CACHE_TTL, JSON.stringify(rows[0]));

    // Throttled update of last_active_at in user_sessions (every 5 minutes)
    const activeKey = `session_active:${token}`;
    const isActive = await client.get(activeKey);
    if (!isActive) {
      await client.setEx(activeKey, 300, '1');
      pool.execute(
        'UPDATE user_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE session_token = ?',
        [token]
      ).catch(err => console.warn('[Session] active update failed:', err.message));
    }

    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    return res.status(500).json({ success: false, message: '服务器错误' });
  }
}

module.exports = requireAuth;
