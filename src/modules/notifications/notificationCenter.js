/**
 * notificationCenter — Centralized notification lifecycle module.
 *
 * This is the ONLY seam for creating, listing, counting, and marking
 * user notifications.  Route adapters and background tasks should call
 * this module instead of writing to user_notifications directly.
 *
 * Design invariants:
 *   - All notification writes go through this module
 *   - Email sending is optional and delegated to utils/email.js
 *   - Pagination is consistent (page, limit, offset)
 *   - The legacy utils/notify.js createNotification() is preserved as a
 *     thin wrapper for backward compatibility, but new code should use
 *     notificationCenter.create() directly.
 */

const { pool } = require('../../db');
const { sendEmail } = require('../../utils/email');
const { escapeHtml } = require('../../utils/validation');

// ─── Helpers ─────────────────────────────────────────────────

async function getUserEmail(userId) {
  const [rows] = await pool.execute('SELECT email FROM users WHERE id = ?', [userId]);
  return rows[0]?.email || null;
}

// ─── Public interface ────────────────────────────────────────

/**
 * Create a notification for a user.
 *
 * @param {{ user_id: number, type: string, title: string, content?: string, ip_address?: string, user_agent?: string, sendEmail?: boolean }} opts
 * @returns {Promise<{ id?: number }>}
 */
async function create({ user_id, type, title, content, ip_address, user_agent, sendEmail: shouldSendEmail = false }) {
  let insertId;
  try {
    const [result] = await pool.execute(
      `INSERT INTO user_notifications (user_id, type, title, content, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        type,
        title,
        content || null,
        ip_address || null,
        user_agent ? String(user_agent).slice(0, 200) : null,
      ]
    );
    insertId = result.insertId;
  } catch (err) {
    console.warn('[NotificationCenter] DB write failed:', err.message);
  }

  if (shouldSendEmail) {
    try {
      const email = await getUserEmail(user_id);
      if (email) {
        await sendEmail(
          email,
          `[MindAuth] ${title}`,
          `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ff6b35;">${escapeHtml(title)}</h2>
              <p>${escapeHtml(content || '')}</p>
              ${ip_address ? `<p style="color: #666; font-size: 12px;">IP: ${escapeHtml(ip_address)}</p>` : ''}
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="color: #999; font-size: 12px;">此邮件由 MindAuth 自动发送，请勿回复。</p>
            </div>
          `
        );
      }
    } catch (err) {
      console.warn('[NotificationCenter] email send failed:', err.message);
    }
  }

  return { id: insertId };
}

/**
 * List notifications for a user with pagination.
 *
 * @param {number} userId
 * @param {{ page?: number, limit?: number, unreadOnly?: boolean }} options
 * @returns {Promise<{ notifications: Array, pagination: object }>}
 */
async function list(userId, options = {}) {
  const page = Math.max(options.page || 1, 1);
  const limit = Math.min(Math.max(options.limit || 20, 1), 100);
  const offset = (page - 1) * limit;
  const unreadOnly = options.unreadOnly || false;

  let query = 'SELECT id, type, title, content, is_read, ip_address, user_agent, created_at FROM user_notifications WHERE user_id = ?';
  const params = [userId];

  if (unreadOnly) {
    query += ' AND is_read = 0';
  }

  query += ' ORDER BY created_at DESC';
  const [rows] = await pool.query(`${query} LIMIT ${limit} OFFSET ${offset}`, params);

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) as count FROM user_notifications WHERE user_id = ?${unreadOnly ? ' AND is_read = 0' : ''}`,
    [userId]
  );

  return {
    notifications: rows,
    pagination: {
      page,
      limit,
      total: countRows[0].count,
      totalPages: Math.ceil(countRows[0].count / limit),
    },
  };
}

/**
 * Get the unread notification count for a user.
 *
 * @param {number} userId
 * @returns {Promise<number>}
 */
async function getUnreadCount(userId) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as count FROM user_notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return rows[0].count;
}

/**
 * Mark a single notification as read.
 *
 * @param {number} userId
 * @param {number} notificationId
 * @returns {Promise<{ updated: boolean }>}
 */
async function markRead(userId, notificationId) {
  const [result] = await pool.execute(
    'UPDATE user_notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
  return { updated: result.affectedRows > 0 };
}

/**
 * Mark all notifications as read for a user.
 *
 * @param {number} userId
 * @returns {Promise<{ updatedCount: number }>}
 */
async function markAllRead(userId) {
  const [result] = await pool.execute(
    'UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return { updatedCount: result.affectedRows };
}

/**
 * Delete a single notification.
 *
 * @param {number} userId
 * @param {number} notificationId
 * @returns {Promise<{ deleted: boolean }>}
 */
async function remove(userId, notificationId) {
  const [result] = await pool.execute(
    'DELETE FROM user_notifications WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
  return { deleted: result.affectedRows > 0 };
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  create,
  list,
  getUnreadCount,
  markRead,
  markAllRead,
  remove,
};
