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
}

module.exports = router;
