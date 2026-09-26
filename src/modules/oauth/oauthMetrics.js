const { pool } = require('../../db');

const RETENTION_DAYS = 180;
let lastPrunedDate = '';

async function record(clientId, errorCode = null) {
  if (typeof clientId !== 'string' || !clientId || clientId.length > 255) return;
  const failed = typeof errorCode === 'string' && errorCode.length > 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [result] = await pool.execute(
      `INSERT INTO oauth_client_daily_metrics
         (client_id, metric_date, request_count, error_count, last_used_at, last_error_at, last_error_code)
       SELECT client_id, CURRENT_DATE(), 1, ?, CURRENT_TIMESTAMP, IF(? = 1, CURRENT_TIMESTAMP, NULL), ?
       FROM clients WHERE client_id = ?
       ON DUPLICATE KEY UPDATE
         request_count = request_count + 1,
         error_count = error_count + VALUES(error_count),
         last_used_at = CURRENT_TIMESTAMP,
         last_error_at = COALESCE(VALUES(last_error_at), last_error_at),
         last_error_code = COALESCE(VALUES(last_error_code), last_error_code)`,
      [failed ? 1 : 0, failed ? 1 : 0, failed ? errorCode.slice(0, 64) : null, clientId],
    );
    if (result.affectedRows && lastPrunedDate !== today) {
      lastPrunedDate = today;
      await pool.execute('DELETE FROM oauth_client_daily_metrics WHERE metric_date < DATE_SUB(CURRENT_DATE(), INTERVAL ? DAY)', [RETENTION_DAYS]);
    }
  } catch (error) {
    // Metrics must never change the OAuth result. Do not include credentials or
    // request payloads in operational logs.
    console.warn('[OAuth metrics] aggregate write failed:', error.message);
  }
}

module.exports = { record };
