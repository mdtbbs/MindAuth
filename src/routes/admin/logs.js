const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const oauthIssuer = require('../../modules/oauth/oauthIssuer');

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

    // pool.query (not execute): MySQL 8 rejects numeric LIMIT/OFFSET as
    // prepared-statement params (ER_WRONG_ARGUMENTS); same pattern as ipBans.js
    const [authorizations] = await pool.query(query, params);

    res.json({ success: true, authorizations });
  } catch (err) {
    console.error('Get authorizations error:', err);
    res.status(500).json({ success: false, message: '获取授权记录失败' });
  }
});

// DELETE /authorizations/:id - Revoke authorization
// Also revokes all issued access tokens (Redis) and refresh tokens (MySQL)
// for the user/client pair, via oauthIssuer.revokeAuthorization.
router.delete('/authorizations/:id', requireAdmin, requireAdminPermission('users.write'), async (req, res) => {
  try {
    const { id } = req.params;

    // authorizations.client_id stores the public client_id string (see 001 schema)
    const [rows] = await pool.execute(
      'SELECT user_id, client_id FROM authorizations WHERE id = ?',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '授权记录不存在' });
    }

    await oauthIssuer.revokeAuthorization({
      userId: rows[0].user_id,
      clientId: rows[0].client_id,
    });

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

    // pool.query (not execute): MySQL 8 rejects numeric LIMIT/OFFSET as
    // prepared-statement params (ER_WRONG_ARGUMENTS); same pattern as ipBans.js
    const [logs] = await pool.query(query, params);

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Get login logs error:', err);
    res.status(500).json({ success: false, message: '获取登录日志失败' });
  }
});

module.exports = router;
