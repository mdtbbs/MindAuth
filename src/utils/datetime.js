/**
 * Format date for MySQL DATETIME column
 * MySQL expects: YYYY-MM-DD HH:MM:SS (no T, no Z)
 */

function formatMySQLDateTime(date) {
  if (!date) date = new Date();
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function formatMySQLDateTimeFromMs(ms) {
  return formatMySQLDateTime(new Date(ms));
}

module.exports = {
  formatMySQLDateTime,
  formatMySQLDateTimeFromMs
};