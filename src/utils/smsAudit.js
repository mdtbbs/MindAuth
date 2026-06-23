const { pool } = require('../db');

function maskPhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

async function logSmsAudit(data) {
  try {
    await pool.execute(
      `INSERT INTO sms_audit_logs
       (user_id, action, phone_masked, success, code, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.user_id || null,
        data.action,
        maskPhone(data.phone),
        data.success ? 1 : 0,
        data.code || null,
        data.ip_address || null,
        data.user_agent ? String(data.user_agent).slice(0, 500) : null,
      ]
    );
  } catch (err) {
    console.warn('[SMS Audit] write failed:', err.message);
  }
}

module.exports = { logSmsAudit };
