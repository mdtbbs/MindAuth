const db = require('../db');

function requireAdmin(req, res, next) {
  const token = req.cookies.admin_session;
  if (!token) {
    return res.status(401).json({ success: false, message: '未登录管理员' });
  }

  const session = db.prepare('SELECT * FROM admin_sessions WHERE session_token = ? AND expires_at > ?').get(token, new Date().toISOString());
  if (!session) {
    return res.status(401).json({ success: false, message: '管理员会话已失效' });
  }

  req.isAdmin = true;
  next();
}

module.exports = requireAdmin;