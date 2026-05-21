const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateToken } = require('../utils/token');
const { sendVerificationEmail } = require('../utils/email');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter } = require('../middleware/rateLimit');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
const sendRateLimiter = createRateLimiter({ maxAttempts: 1, windowMs: 60 * 1000 }); // 1 per minute

// POST /send - Send verification email (rate limited)
router.post('/send', requireAuth, sendRateLimiter, async (req, res) => {
  try {
    const user = req.user;

    // Check if already verified
    if (user.email_verified === 1) {
      return res.status(400).json({ success: false, message: '邮箱已验证' });
    }

    // Generate verification token
    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY).toISOString();

    // Upsert token (replace existing)
    db.prepare(`
      INSERT INTO email_verification_tokens (user_id, email, token, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET email=?, token=?, expires_at=?, used=0
    `).run(user.id, user.email, token, expiresAt, user.email, token, expiresAt);

    // Send verification email
    const verifyLink = `${BASE_URL}/#/verify-email?token=${token}`;
    await sendVerificationEmail(user.email, verifyLink);

    res.json({ success: true, message: '验证邮件已发送' });
  } catch (err) {
    console.error('Send verification error:', err);
    res.status(500).json({ success: false, message: '发送验证邮件失败' });
  }
});

// POST /verify - Verify email with token
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: '缺少验证令牌' });
    }

    // Find valid token
    const record = db.prepare(`
      SELECT user_id, email FROM email_verification_tokens
      WHERE token = ? AND used = 0 AND expires_at > ?
    `).get(token, new Date().toISOString());

    if (!record) {
      return res.status(400).json({ success: false, message: '验证链接无效或已过期' });
    }

    // Update user email_verified and possibly email
    db.prepare('UPDATE users SET email_verified = 1, email = ? WHERE id = ?').run(record.email, record.user_id);

    // Mark token as used
    db.prepare('UPDATE email_verification_tokens SET used = 1 WHERE token = ?').run(token);

    res.json({ success: true, message: '邮箱验证成功' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

// GET /status - Get verification status
router.get('/status', requireAuth, (req, res) => {
  try {
    res.json({
      success: true,
      email_verified: req.user.email_verified === 1,
      email: req.user.email
    });
  } catch (err) {
    console.error('Get verification status error:', err);
    res.status(500).json({ success: false, message: '获取验证状态失败' });
  }
});

module.exports = router;