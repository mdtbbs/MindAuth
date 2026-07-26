/**
 * Legacy notification helper — thin wrapper kept for backward compatibility.
 * New code should call modules/notifications/notificationCenter.create() directly.
 */
const notificationCenter = require('../modules/notifications/notificationCenter');

async function createNotification(opts) {
  await notificationCenter.create(opts);
}

module.exports = { createNotification };
