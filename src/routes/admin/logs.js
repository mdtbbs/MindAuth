const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');

// GET /authorizations - Get all authorization records
router.get('/authorizations', requireAdmin, requireAdminPermission('authorizations.read'), async (req, res) => {
  try {
    const { page, limit, user_id } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT a.id, a.user_id, u.username, a.client_id, c.name as client_name, a.last_used_at, a.created_at
      FROM authorizations a
      JOIN users u ON a.user_id = u.id
      JOIN clients c ON a.client_id = c.client_id
    `;
    let params = [];

    if (user_id) {
      query += ' WHERE a.user_id = ?';
      params.push(parseInt(user_id));
    }

    query += ' ORDER BY a.last_used_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const [authorizations] = await pool.execute(query, params);

    res.json({ success: true, authorizations });
  } catch (err) {
    console.error('Get authorizations error:', err);
    res.status(500).json({ success: false, message: '获取授权记录失败' });
  }
});

// DELETE /authorizations/:id - Revoke authorization
router.delete('/authorizations/:id', requireAdmin, requireAdminPermission('users.write'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM authorizations WHERE id = ?', [id]);
    res.json({ success: true, message: '授权已撤销' });
  } catch (err) {
    console.error('Delete authorization error:', err);
    res.status(500).json({ success: false, message: '撤销授权失败' });
  }
});

// GET /login-logs - Get login history
router.get('/login-logs', requireAdmin, requireAdminPermission('login_logs.read'), async (req, res) => {
  try {
    const { page, limit, user_id, login_type } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 100;
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT l.id, l.user_id, u.username, l.ip, l.device, l.login_type, l.created_at
      FROM login_logs l
      JOIN users u ON l.user_id = u.id
    `;
    let params = [];

    const conditions = [];
    if (user_id) {
      conditions.push('l.user_id = ?');
      params.push(parseInt(user_id));
    }
    if (login_type) {
      conditions.push('l.login_type = ?');
      params.push(login_type);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const [logs] = await pool.execute(query, params);

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Get login logs error:', err);
    res.status(500).json({ success: false, message: '获取登录日志失败' });
  }
});

module.exports = router;
