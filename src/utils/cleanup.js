/**
 * Cleanup module for expired data
 * With Redis integration, most ephemeral data (auth_codes, admin_sessions,
 * reset_tokens, verification_tokens) is cleaned automatically via Redis TTL.
 * This module only cleans MySQL tables that need explicit cleanup.
 */

const { pool } = require('../db');

/**
 * Clean up expired refresh_tokens from MySQL
 * Other ephemeral data is handled by Redis TTL automatically
 * @returns {boolean} true if cleanup succeeded, false otherwise
 */
async function cleanupExpiredData() {
  // MySQL datetime format: YYYY-MM-DD HH:MM:SS (no 'Z' suffix)
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  try {
    // Clean expired refresh_tokens (MySQL table)
    const [result] = await pool.execute('DELETE FROM refresh_tokens WHERE expires_at < ?', [now]);
    const [configRows] = await pool.execute(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['sms_audit_retention_days']
    );
    const retentionDays = Math.max(parseInt(configRows[0]?.value || '365', 10) || 365, 1);
    const smsCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, '');
    const [smsResult] = await pool.execute('DELETE FROM sms_audit_logs WHERE created_at < ?', [smsCutoff]);

    // Clean user sessions that are past their absolute expiry, plus any
    // legacy rows (expires_at NULL) inactive for 30 days
    const [sessionResult] = await pool.execute(
      `DELETE FROM user_sessions
       WHERE (expires_at IS NOT NULL AND expires_at < NOW())
          OR (expires_at IS NULL AND last_active_at < DATE_SUB(NOW(), INTERVAL 30 DAY))`
    );

    // Clean expired admin audit logs
    const [auditConfigRows] = await pool.execute(
      "SELECT value FROM system_config WHERE `key` = ? LIMIT 1",
      ['audit_retention_days']
    );
    const auditRetentionDays = Math.max(parseInt(auditConfigRows[0]?.value || '365', 10) || 365, 1);
    const auditCutoff = new Date(Date.now() - auditRetentionDays * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    const [auditResult] = await pool.execute('DELETE FROM admin_audit_logs WHERE created_at < ?', [auditCutoff]);

    // Clean expired email verification tokens (Redis fallback table)
    const [emailTokenResult] = await pool.execute(
      'DELETE FROM email_verification_tokens WHERE expires_at < ?',
      [now]
    );

    // Clean expired registration email codes (Redis fallback table)
    const [regCodeResult] = await pool.execute(
      'DELETE FROM registration_email_codes WHERE expires_at < ?',
      [now]
    );

    // Clean expired user audit logs (same retention as admin audit logs)
    const [userAuditResult] = await pool.execute(
      'DELETE FROM user_audit_logs WHERE created_at < ?',
      [auditCutoff]
    );

    console.log(`Cleanup completed: removed ${result.affectedRows} refresh_tokens, ${smsResult.affectedRows} sms_audit_logs, ${sessionResult.affectedRows} expired sessions, ${auditResult.affectedRows} audit_logs, ${emailTokenResult.affectedRows} email_tokens, ${regCodeResult.affectedRows} registration_codes, ${userAuditResult.affectedRows} user_audit_logs from MySQL`);

    // Note: auth_codes, admin_sessions, password_reset_tokens, email_verification_tokens
    // are stored in Redis and cleaned automatically via TTL

    return true;
  } catch (err) {
    console.error('Cleanup error:', err);
    return false;
  }
}

/**
 * Start the cleanup scheduler
 * @param {number} intervalMs - interval in milliseconds (default: 1 hour)
 * @returns {NodeJS.Timeout} interval ID for cleanup
 * @throws {Error} if intervalMs is not a positive number
 */
function startCleanupScheduler(intervalMs = 3600 * 1000) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('startCleanupScheduler: intervalMs must be a positive number');
  }

  // Run immediately on start
  cleanupExpiredData();

  // Schedule periodic cleanup
  const intervalId = setInterval(cleanupExpiredData, intervalMs);

  return intervalId;
}

module.exports = { cleanupExpiredData, startCleanupScheduler };
