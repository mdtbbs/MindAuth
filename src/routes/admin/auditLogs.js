const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');

// GET /audit-logs - View audit logs
router.get('/audit-logs', requireAdmin, requireAdminPermission('audit_logs.read'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;

    const { action, target_type, admin_id, start_date, end_date } = req.query;

    let query = 'SELECT id, admin_id, action, target_type, target_id, details, ip_address, created_at FROM admin_audit_logs WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as count FROM admin_audit_logs WHERE 1=1';
    const params = [];
    const countParams = [];

    if (action) {
      query += ' AND action = ?';
      countQuery += ' AND action = ?';
      params.push(action);
      countParams.push(action);
    }
    if (target_type) {
      query += ' AND target_type = ?';
      countQuery += ' AND target_type = ?';
      params.push(target_type);
      countParams.push(target_type);
    }
    if (admin_id) {
      query += ' AND admin_id = ?';
      countQuery += ' AND admin_id = ?';
      params.push(parseInt(admin_id));
      countParams.push(parseInt(admin_id));
    }
    if (start_date) {
      query += ' AND created_at >= ?';
      countQuery += ' AND created_at >= ?';
      params.push(start_date);
      countParams.push(start_date);
    }
    if (end_date) {
      query += ' AND created_at <= ?';
      countQuery += ' AND created_at <= ?';
      params.push(end_date);
      countParams.push(end_date);
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(`${query} LIMIT ${limit} OFFSET ${offset}`, params);
    const [countRows] = await pool.execute(countQuery, countParams);

    res.json({
      success: true,
      logs: rows,
      pagination: { page, limit, total: countRows[0].count, totalPages: Math.ceil(countRows[0].count / limit) },
    });
  } catch (err) {
    console.error('[Admin] audit logs error:', err);
    res.status(500).json({ success: false, message: '获取审计日志失败' });
  }
});

module.exports = router;
