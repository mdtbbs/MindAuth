const { authenticateUserSession, touchUserSession } = require('../modules/sessions/sessionManager');

/**
 * Require authentication middleware.
 *
 * Validates the `session` cookie via sessionManager (hash-based lookup).
 * Redis cache → MySQL fallback.
 * Injects `req.user` and `req.session` (with session.id).
 */
async function requireAuth(req, res, next) {
  const rawToken = req.cookies.session;
  if (!rawToken) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  try {
    const result = await authenticateUserSession(rawToken);
    if (!result) {
      return res.status(401).json({ success: false, message: '会话已失效' });
    }

    req.user = result.user;
    req.session = result.session;

    // Fire-and-forget throttled touch of last_active_at
    touchUserSession(result.session.id);

    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    return res.status(500).json({ success: false, message: '服务器错误' });
  }
}

module.exports = requireAuth;
