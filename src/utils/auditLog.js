const { pool } = require('../db');

async function logAudit({ admin_id, action, target_type, target_id, details, ip_address }) {
  try {
    await pool.execute(
      `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        admin_id,
        action,
        target_type || null,
        target_id || null,
        details ? JSON.stringify(details) : null,
        ip_address || null,
      ]
    );
  } catch (err) {
    console.warn('[Audit] write failed:', err.message);
  }
}

module.exports = { logAudit };
