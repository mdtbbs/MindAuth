const db = require('../db');

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  const user = db.prepare('SELECT id, username, email, email_verified, password_hash, created_at FROM users WHERE session_token = ?').get(token);
  if (!user) {
    return res.status(401).json({ success: false, message: '会话已失效' });
  }

  req.user = user;
  next();
}

module.exports = requireAuth;