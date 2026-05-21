const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateToken } = require('../utils/token');
const { isValidPassword, isValidEmail } = require('../utils/validation');
const { sendPasswordResetEmail } = require('../utils/email');
const { createRateLimiter } = require('../middleware/rateLimit');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const RESET_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
const resetRateLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 60 * 60 * 1000 }); // 3 per hour

// Request password reset
router.post('/reset-request', resetRateLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
  }

  try {
    const user = db.prepare('SELECT id, email, email_verified FROM users WHERE email = ?').get(email);

    // Don't reveal whether user exists (security)
    // If user doesn't exist or email not verified, still return success message
    if (!user || !user.email_verified) {
      return res.json({ success: true, message: '如果邮箱存在且已验证，重置链接已发送' });
    }

    // Generate reset token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY).toISOString();

    db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)
    `).run(user.id, token, expiresAt);

    // Send email
    const resetLink = `${BASE_URL}/#/reset-password?token=${token}`;
    await sendPasswordResetEmail(user.email, resetLink);

    res.json({ success: true, message: '如果邮箱存在，重置链接已发送' });
  } catch (err) {
    console.error('Reset request error:', err);
    res.status(500).json({ success: false, message: '发送重置邮件失败' });
  }
});

// Execute password reset
router.post('/reset', async (req, res) => {
  const { token, new_password } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: '缺少重置令牌' });
  }

  if (!new_password || !isValidPassword(new_password)) {
    return res.status(400).json({ success: false, message: '密码至少6位' });
  }

  try {
    const record = db.prepare(`
      SELECT user_id FROM password_reset_tokens
      WHERE token = ? AND used = 0 AND expires_at > ?
    `).get(token, new Date().toISOString());

    if (!record) {
      return res.status(400).json({ success: false, message: '链接无效或已过期' });
    }

    // Update password
    const passwordHash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, record.user_id);

    // Mark token as used
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?').run(token);

    // Clear all sessions (force re-login)
    db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(record.user_id);

    res.json({ success: true, message: '密码已更新，请重新登录' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ success: false, message: '密码重置失败' });
  }
});

module.exports = router;