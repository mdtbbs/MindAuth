const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { client } = require('../redis');
const { generateToken, hashToken } = require('../utils/token');
const { isValidPassword, isValidEmail, getPasswordValidationError } = require('../utils/validation');
const { sendPasswordResetEmail } = require('../utils/email');
const { createRateLimiter } = require('../middleware/rateLimit');
const { logUserAudit } = require('../utils/userAudit');
const { getClientIp } = require('../utils/request');
const sessionManager = require('../modules/sessions/sessionManager');
const tokenStore = require('../modules/oauth/tokenStore');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const RESET_TOKEN_TTL = 3600; // 1 hour in seconds (Redis TTL)
const resetRateLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:password_reset_request' }); // 3 per hour
const resetExecLimiter = createRateLimiter({ maxAttempts: 10, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:password_reset_exec' }); // 10 per hour

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

    // Generate reset token — only the hash is stored server-side; the raw
    // token goes into the emailed link
    const token = generateToken();

    await client.setEx(`reset:${hashToken(token)}`, RESET_TOKEN_TTL, JSON.stringify({
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
router.post('/reset', resetExecLimiter, async (req, res) => {
  const { token, new_password } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: '缺少重置令牌' });
  }

  if (!new_password || !isValidPassword(new_password)) {
    return res.status(400).json({ success: false, message: getPasswordValidationError(new_password) || '密码不符合要求' });
  }

  try {
    // Look up by hash of the presented token
    const tokenKey = `reset:${hashToken(token)}`;
    const tokenData = await client.get(tokenKey);

    if (!tokenData) {
      return res.status(400).json({ success: false, message: '链接无效或已过期' });
    }

    const parsed = JSON.parse(tokenData);

    // Security: Re-verify email_verified at reset time.
    // If the user's email was unverified between /reset-request and /reset,
    // refuse to honor the token.
    const [userRows] = await pool.execute(
      'SELECT id, email_verified FROM users WHERE id = ?',
      [parsed.user_id]
    );
    if (!userRows[0] || userRows[0].email_verified !== 1) {
      await client.del(tokenKey);
      return res.status(400).json({ success: false, message: '邮箱未验证或用户不存在' });
    }

    // Update password
    const passwordHash = await bcrypt.hash(new_password, 12);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, parsed.user_id]);

    // Delete token (single-use)
    await client.del(tokenKey);

    // Security: Revoke all OAuth refresh tokens for this user.
    // Otherwise an OAuth client holding a refresh token could keep issuing
    // new access tokens even after the password was reset.
    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [parsed.user_id]);

    // Revoke all user sessions via sessionManager (clears MySQL, Redis, index sets)
    await sessionManager.revokeAllUserSessions(parsed.user_id);

    // Best-effort: revoke cached access tokens for this user via the
    // per-user/client index sets maintained by tokenStore (no SCAN).
    try {
      const [clientRows] = await pool.execute(
        'SELECT DISTINCT client_id FROM authorizations WHERE user_id = ?',
        [parsed.user_id]
      );
      await Promise.all(
        clientRows.map(row =>
          tokenStore.revokeAccessTokensForUserClient(parsed.user_id, row.client_id).catch(() => {})
        )
      );
    } catch (revokeErr) {
      console.warn('[Password] access token revocation failed:', revokeErr.message);
    }

    logUserAudit({
      user_id: parsed.user_id,
      action: 'password_reset',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
    });

    res.json({ success: true, message: '密码已更新，请重新登录' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ success: false, message: '密码重置失败' });
  }
});

module.exports = router;