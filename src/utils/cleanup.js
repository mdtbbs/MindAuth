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

    console.log(`Cleanup completed: removed ${result.affectedRows} refresh_tokens from MySQL`);

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