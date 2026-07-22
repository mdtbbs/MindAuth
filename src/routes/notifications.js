const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const notificationCenter = require('../modules/notifications/notificationCenter');

// GET /notifications - List notifications
router.get('/', requireAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const unreadOnly = req.query.unread === 'true';

    const result = await notificationCenter.list(req.user.id, { page, limit, unreadOnly });

    res.json({
      success: true,
      notifications: result.notifications,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error('[Notifications] list error:', err);
    res.status(500).json({ success: false, message: '获取通知失败' });
  }
});

// GET /notifications/unread-count - Get unread count
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await notificationCenter.getUnreadCount(req.user.id);
    res.json({ success: true, count });
  } catch (err) {
    console.error('[Notifications] count error:', err);
    res.status(500).json({ success: false, message: '获取未读数失败' });
  }
});

// PATCH /notifications/:id/read - Mark as read
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const result = await notificationCenter.markRead(req.user.id, parseInt(req.params.id));
    if (!result.updated) {
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
    await notificationCenter.markAllRead(req.user.id);
    res.json({ success: true, message: '全部已读' });
  } catch (err) {
    console.error('[Notifications] read all error:', err);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

// DELETE /notifications/:id - Delete a notification
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await notificationCenter.remove(req.user.id, parseInt(req.params.id));
    if (!result.deleted) {
      return res.status(404).json({ success: false, message: '通知不存在' });
    }
    res.json({ success: true, message: '通知已删除' });
  } catch (err) {
    console.error('[Notifications] delete error:', err);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

module.exports = router;
