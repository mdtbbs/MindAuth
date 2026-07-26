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
const sendRateLimiter = createRateLimiter({ maxAttempts: 1, windowMs: 60 * 1000, keyPrefix: 'ratelimit:email_verify_send' }); // 1 per minute

// Helper: persist a verification token to MySQL as a durable fallback in case
// Redis loses data. The verify endpoint checks Redis first and falls back here.
async function persistTokenToMysql(token, userId, email, ttlSeconds) {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
    await pool.execute(
      'INSERT INTO email_verification_tokens (token, user_id, email, expires_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), email = VALUES(email), expires_at = VALUES(expires_at)',
      [token, userId, email, expiresAt]
    );
  } catch (err) {
    console.warn('[EmailVerify] MySQL persist failed:', err.message);
  }
}

async function removeTokenFromMysql(token) {
  try {
    await pool.execute('DELETE FROM email_verification_tokens WHERE token = ?', [token]);
  } catch (err) {
    console.warn('[EmailVerify] MySQL remove failed:', err.message);
  }
}

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

    // Store verification token in Redis (primary) and MySQL (fallback)
    await client.setEx(`verify:${token}`, TOKEN_TTL, JSON.stringify({
      user_id: user.id,
      email: user.email
    }));
    await persistTokenToMysql(token, user.id, user.email, TOKEN_TTL);

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

    // Get token from Redis (primary)
    let record = null;
    const tokenData = await client.get(`verify:${token}`);
    if (tokenData) {
      record = JSON.parse(tokenData);
    } else {
      // Fallback to MySQL — Redis may have lost data after a restart.
      const [rows] = await pool.execute(
        'SELECT user_id, email, expires_at FROM email_verification_tokens WHERE token = ?',
        [token]
      );
      if (rows[0] && new Date(rows[0].expires_at) > new Date()) {
        record = { user_id: rows[0].user_id, email: rows[0].email };
      }
    }

    if (!record) {
      return res.status(400).json({ success: false, message: '验证链接无效或已过期' });
    }

    // Update user email_verified and possibly email
    await pool.execute('UPDATE users SET email_verified = 1, email = ? WHERE id = ?', [record.email, record.user_id]);

    // Delete token (single-use) — from both Redis and MySQL
    await client.del(`verify:${token}`);
    await removeTokenFromMysql(token);

    // Audit: email changed / verified
    const { logUserAudit } = require('../utils/userAudit');
    logUserAudit({
      user_id: record.user_id,
      action: 'email_changed',
      details: { email: record.email },
    });

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