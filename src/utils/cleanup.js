/**
 * Cleanup module for expired data
 * Removes expired auth_codes and admin_sessions from the database
 */

const db = require('../db');

/**
 * Clean up expired auth_codes and admin_sessions
 * @returns {boolean} true if cleanup succeeded, false otherwise
 */
function cleanupExpiredData() {
  const now = new Date().toISOString();

  try {
    // Clean expired auth_codes
    const authCodesResult = db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').run(now);

    // Clean expired admin_sessions
    const adminSessionsResult = db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);

    // Clean expired password reset tokens
    const resetTokensResult = db.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?').run(now);

    // Clean expired email verification tokens
    const verificationTokensResult = db.prepare('DELETE FROM email_verification_tokens WHERE expires_at < ?').run(now);

    // Clean expired refresh tokens
    const refreshTokensResult = db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now);

    console.log(`Cleanup completed: removed ${authCodesResult.changes} auth_codes, ${adminSessionsResult.changes} admin_sessions, ${resetTokensResult.changes} reset_tokens, ${verificationTokensResult.changes} verification_tokens, ${refreshTokensResult.changes} refresh_tokens`);
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