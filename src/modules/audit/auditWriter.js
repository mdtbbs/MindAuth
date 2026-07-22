/**
 * auditWriter — Centralized audit logging module.
 *
 * Single seam for writing admin and user audit records. All admin route
 * mutations and security-relevant user actions flow through here.
 *
 * Design invariants:
 *   - Failures are logged but never thrown — audit loss is preferable
 *     to breaking the primary request flow.
 *   - Admin audit records capture: who, what, which target, extra details, IP.
 *   - User audit records capture: which user, what action, IP, extra details.
 *   - Both delegates to the underlying pool writers; the module adds a
 *     stable interface so callers don't import low-level utilities directly.
 */

const { logAudit } = require('../../utils/auditLog');
const { logUserAudit } = require('../../utils/userAudit');

// ─── Public interface ────────────────────────────────────────

/**
 * Record an admin audit event.
 *
 * @param {number} adminId       ID of the admin performing the action
 * @param {string} action        Action label (e.g. 'client.create', 'user.ban')
 * @param {string} targetType    Type of target (e.g. 'client', 'user', 'config')
 * @param {number} [targetId]    Optional target record ID
 * @param {object} [details]     Optional JSON-serializable details
 * @param {string} [ipAddress]   Client IP address
 * @returns {Promise<void>}
 */
async function writeAdminAudit(adminId, action, targetType, targetId, details, ipAddress) {
  await logAudit({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId || null,
    details: details || null,
    ip_address: ipAddress || null,
  });
}

/**
 * Record a user audit event.
 *
 * @param {number} userId        ID of the affected user
 * @param {string} action        Action label (e.g. 'account_unlocked')
 * @param {string} [ipAddress]   Client IP address
 * @param {object} [details]     Optional JSON-serializable details
 * @returns {Promise<void>}
 */
async function writeUserAudit(userId, action, ipAddress, details) {
  await logUserAudit({
    user_id: userId,
    action,
    ip_address: ipAddress || null,
    details: details || null,
  });
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  writeAdminAudit,
  writeUserAudit,
};
