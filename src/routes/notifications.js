const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /notifications - List notifications
router.get('/', requireAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const unreadOnly = req.query.unread === 'true';

    let query = 'SELECT id, type, title, content, is_read, ip_address, user_agent, created_at FROM user_notifications WHERE user_id = ?';
    const params = [req.user.id];

    if (unreadOnly) {
      query += ' AND is_read = 0';
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(`${query} LIMIT ${limit} OFFSET ${offset}`, params);

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as count FROM user_notifications WHERE user_id = ?${unreadOnly ? ' AND is_read = 0' : ''}`,
      [req.user.id]
    );

    res.json({
      success: true,
      notifications: rows,
      pagination: { page, limit, total: countRows[0].count, totalPages: Math.ceil(countRows[0].count / limit) },
    });
  } catch (err) {
    console.error('[Notifications] list error:', err);
    res.status(500).json({ success: false, message: '获取通知失败' });
  }
});

// GET /notifications/unread-count - Get unread count
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as count FROM user_notifications WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    res.json({ success: true, count: rows[0].count });
  } catch (err) {
    console.error('[Notifications] count error:', err);
    res.status(500).json({ success: false, message: '获取未读数失败' });
  }
});

// PATCH /notifications/:id/read - Mark as read
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'UPDATE user_notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '通知不存在' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Notifications] mark read error:', err);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

// PATCH /notifications/read-all - Mark all as read
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    await pool.execute(
      'UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    res.json({ success: true, message: '全部已读' });
  } catch (err) {
    console.error('[Notifications] read all error:', err);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

// DELETE /notifications/:id - Delete a notification
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM user_notifications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '通知不存在' });
    }

    res.json({ success: true, message: '通知已删除' });
  } catch (err) {
    console.error('[Notifications] delete error:', err);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

module.exports = router;
