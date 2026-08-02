/**
 * User audit log utility
 * Records security-relevant actions by regular users: login failures,
 * password changes, session terminations, etc.
 *
 * Design: low-volume by intent. High-frequency events (login success,
 * OAuth authorization grants) live in dedicated tables (login_logs,
 * authorizations) to keep this table focused on security audit.
 */

const { pool } = require('../db');

const VALID_ACTIONS = new Set([
  'login_failed',
  'account_locked',
  'account_unlocked',
  'password_changed',
  'password_reset',
  'email_change_requested',
  'email_changed',
  'username_changed',
  'session_terminated',
  'avatar_changed',
  'account_deleted',
]);

/**
 * Record a user audit event. Failures are logged but never thrown —
 * audit logging must not break the primary request flow.
 *
 * @param {object} params
 * @param {number} params.user_id
 * @param {string} params.action   One of VALID_ACTIONS
 * @param {string} [params.ip_address]
 * @param {string} [params.user_agent]  Truncated to 500 chars
 * @param {object} [params.details]     Arbitrary JSON-serializable payload
 */
async function logUserAudit({ user_id, action, ip_address, user_agent, details }) {
  if (!user_id || !VALID_ACTIONS.has(action)) {
    console.warn('[UserAudit] invalid params:', { user_id, action });
    return;
  }

  try {
    await pool.execute(
      'INSERT INTO user_audit_logs (user_id, action, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?)',
      [
        user_id,
        action,
        ip_address || null,
        user_agent ? String(user_agent).slice(0, 500) : null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    // Non-fatal: log and continue. Audit loss is preferable to request failure.
    console.warn('[UserAudit] insert failed:', err.message);
  }
}

/**
 * Fetch recent audit entries for a user (for dashboard "security log" tab).
 * Returns up to `limit` most recent events.
 */
async function getUserAuditLogs(userId, limit = 50) {
  const [rows] = await pool.execute(
    'SELECT id, action, ip_address, user_agent, details, created_at FROM user_audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit]
  );
  return rows.map((r) => ({
    ...r,
    details: r.details ? (typeof r.details === 'string' ? JSON.parse(r.details) : r.details) : null,
  }));
}

module.exports = { logUserAudit, getUserAuditLogs, VALID_ACTIONS };
