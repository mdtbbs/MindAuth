const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { client } = require('../redis');
const { generateToken } = require('../utils/token');
const { sendVerificationEmail } = require('../utils/email');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter } = require('../middleware/rateLimit');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const TOKEN_TTL = 3600; // 1 hour in seconds (Redis TTL)
const sendRateLimiter = createRateLimiter({ maxAttempts: 1, windowMs: 60 * 1000, keyPrefix: 'verify' }); // 1 per minute

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

    // Store verification token in Redis
    await client.setEx(`verify:${token}`, TOKEN_TTL, JSON.stringify({
      user_id: user.id,
      email: user.email
    }));

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

    // Get token from Redis
    const tokenData = await client.get(`verify:${token}`);

    if (!tokenData) {
      return res.status(400).json({ success: false, message: '验证链接无效或已过期' });
    }

    const record = JSON.parse(tokenData);

    // Update user email_verified and possibly email
    await pool.execute('UPDATE users SET email_verified = 1, email = ? WHERE id = ?', [record.email, record.user_id]);

    // Delete token (single-use)
    await client.del(`verify:${token}`);

    res.json({ success: true, message: '邮箱验证成功' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

// GET /status - Get verification status
router.get('/status', requireAuth, (req, res) => {
  res.json({
    success: true,
    email_verified: req.user.email_verified === 1,
    email: req.user.email
  });
});

module.exports = router;