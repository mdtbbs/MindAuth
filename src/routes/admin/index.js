const express = require('express');
const router = express.Router();
const { client } = require('../../redis');
const { timingSafeCompare } = require('../../utils/crypto');
const config = require('../../config');

// Mount sub-routers
// IMPORTANT: Mount specific paths first to avoid conflicts with '/' mount
router.use('/clients', require('./clients')); // /clients, /clients/:id
router.use('/users', require('./users'));     // /users, /users/:id
router.use('/ip-bans', require('./ipBans'));  // /ip-bans
router.use('/challenges', require('./challenges')); // /challenges
router.use('/user-fields', require('./userFields')); // /user-fields
router.use('/', require('./smsAuditLogs')); // /sms-audit-logs
router.use('/', require('./auditLogs'));    // /audit-logs
router.use('/', require('./auth'));           // /create, /login, /logout, /me
router.use('/', require('./settings'));       // /stats, /email-config, /test-email, /config
router.use('/', require('./logs'));           // /authorizations, /login-logs

// POST /test/clear-rate-limits - Clear all rate limits (for testing)
// Only available in non-production environments
if (process.env.NODE_ENV !== 'production') {
  router.post('/test/clear-rate-limits', async (req, res) => {
    try {
      const { secret } = req.body;

      if (!secret || !timingSafeCompare(secret, config.admin.secret || '')) {
        return res.status(403).json({ success: false, message: '无权限' });
      }

      let cleared = 0;

      // Clear ratelimit:* keys - SCAN cursor must be string '0'
      let cursor = '0';
      do {
        const result = await client.scan(cursor, 'MATCH', 'ratelimit:*', 'COUNT', 100);
        cursor = result.cursor;
        if (result.keys && result.keys.length > 0) {
          await client.del(result.keys);
          cleared += result.keys.length;
        }
      } while (cursor !== '0');

      // Clear admin:* keys
      cursor = '0';
      do {
        const result = await client.scan(cursor, 'MATCH', 'admin:*', 'COUNT', 100);
        cursor = result.cursor;
        if (result.keys && result.keys.length > 0) {
          await client.del(result.keys);
          cleared += result.keys.length;
        }
      } while (cursor !== '0');

      res.json({ success: true, cleared });
    } catch (err) {
      console.error('Clear rate limits error:', err);
      res.status(500).json({ success: false, message: '清除失败' });
    }
  });

  // POST /test/create-reset-token - Insert a password reset token into Redis (testing only)
  // Returns the raw token so tests can call POST /api/password/reset with it.
  router.post('/test/create-reset-token', async (req, res) => {
    try {
      const { secret, user_id } = req.body;

      if (!secret || !timingSafeCompare(secret, config.admin.secret || '')) {
        return res.status(403).json({ success: false, message: '无权限' });
      }

      if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id required' });
      }

      const { generateToken } = require('../../utils/token');
      const token = generateToken();

      await client.setEx(`reset:${token}`, 3600, JSON.stringify({ user_id }));

      res.json({ success: true, token });
    } catch (err) {
      console.error('Create reset token error:', err);
      res.status(500).json({ success: false, message: '创建重置令牌失败' });
    }
  });

  // POST /test/verify-email - Mark a user's email as verified (testing only)
  router.post('/test/verify-email', async (req, res) => {
    try {
      const { secret, user_id } = req.body;

      if (!secret || !timingSafeCompare(secret, config.admin.secret || '')) {
        return res.status(403).json({ success: false, message: '无权限' });
      }

      if (!user_id) {
        return res.status(400).json({ success: false, message: 'user_id required' });
      }

      const { pool } = require('../../db');
      await pool.execute('UPDATE users SET email_verified = 1 WHERE id = ?', [user_id]);

      res.json({ success: true });
    } catch (err) {
      console.error('Verify email error:', err);
      res.status(500).json({ success: false, message: '验证邮箱失败' });
    }
  });

  // POST /test/get-user-id - Look up a user's ID by username (testing only)
  router.post('/test/get-user-id', async (req, res) => {
    try {
      const { secret, username } = req.body;

      if (!secret || !timingSafeCompare(secret, config.admin.secret || '')) {
        return res.status(403).json({ success: false, message: '无权限' });
      }

      if (!username) {
        return res.status(400).json({ success: false, message: 'username required' });
      }

      const { pool } = require('../../db');
      const [rows] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'user not found' });
      }

      res.json({ success: true, user_id: rows[0].id });
    } catch (err) {
      console.error('Get user id error:', err);
      res.status(500).json({ success: false, message: '查询用户失败' });
    }
  });
}

module.exports = router;
