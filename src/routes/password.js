const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { client } = require('../redis');
const { generateToken } = require('../utils/token');
const { isValidPassword, isValidEmail, getPasswordValidationError } = require('../utils/validation');
const { sendPasswordResetEmail } = require('../utils/email');
const { createRateLimiter } = require('../middleware/rateLimit');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const RESET_TOKEN_TTL = 3600; // 1 hour in seconds (Redis TTL)
const resetRateLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 60 * 60 * 1000, keyPrefix: 'reset' }); // 3 per hour

// Request password reset
router.post('/reset-request', resetRateLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
  }

  try {
    const [userRows] = await pool.execute('SELECT id, email, email_verified FROM users WHERE email = ?', [email]);
    const user = userRows[0];

    // Don't reveal whether user exists (security)
    // If user doesn't exist or email not verified, still return success message
    if (!user || !user.email_verified) {
      return res.json({ success: true, message: '如果邮箱存在且已验证，重置链接已发送' });
    }

    // Generate reset token
    const token = generateToken();

    // Store reset token in Redis
    await client.setEx(`reset:${token}`, RESET_TOKEN_TTL, JSON.stringify({
      user_id: user.id
    }));

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
    return res.status(400).json({ success: false, message: getPasswordValidationError(new_password) || '密码不符合要求' });
  }

  try {
    // Get token from Redis
    const tokenData = await client.get(`reset:${token}`);

    if (!tokenData) {
      return res.status(400).json({ success: false, message: '链接无效或已过期' });
    }

    const parsed = JSON.parse(tokenData);

    // Update password
    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, parsed.user_id]);

    // Delete token (single-use)
    await client.del(`reset:${token}`);

    // Clear all sessions (force re-login)
    await pool.execute('UPDATE users SET session_token = NULL WHERE id = ?', [parsed.user_id]);

    res.json({ success: true, message: '密码已更新，请重新登录' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ success: false, message: '密码重置失败' });
  }
});

module.exports = router;