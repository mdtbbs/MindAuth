const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { getClientIp } = require('../../utils/request');
const auditWriter = require('../../modules/audit/auditWriter');

const VALID_FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'url'];

// GET /user-fields - List all field definitions
router.get('/', requireAdmin, requireAdminPermission('config.read'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, field_key, field_label, field_type, is_required, is_public, options, sort_order, created_at FROM user_fields ORDER BY sort_order ASC, id ASC'
    );
    res.json({ success: true, fields: rows });
  } catch (err) {
    console.error('[Admin] user fields list error:', err);
    res.status(500).json({ success: false, message: '获取字段列表失败' });
  }
});

// POST /user-fields - Create a field definition
router.post('/', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const { field_key, field_label, field_type, is_required, is_public, options } = req.body;

    if (!field_key || !field_label) {
      return res.status(400).json({ success: false, message: 'field_key 和 field_label 必填' });
    }
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(field_key)) {
      return res.status(400).json({ success: false, message: 'field_key 须为小写字母开头，仅含字母数字下划线' });
    }
    const type = field_type || 'text';
    if (!VALID_FIELD_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `field_type 须为 ${VALID_FIELD_TYPES.join('/')}` });
    }
    if (type === 'select' && (!options || !options.choices || !Array.isArray(options.choices))) {
      return res.status(400).json({ success: false, message: 'select 类型必须提供 options.choices 数组' });
    }

    const [result] = await pool.execute(
      'INSERT INTO user_fields (field_key, field_label, field_type, is_required, is_public, options) VALUES (?, ?, ?, ?, ?, ?)',
      [field_key, field_label, type, is_required ? 1 : 0, is_public !== false ? 1 : 0, options ? JSON.stringify(options) : null]
    );

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'field.create', 'user_field', result.insertId,
      { field_key, field_label, field_type: type }, getClientIp(req),
    );

    res.json({ success: true, message: '字段已创建', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'field_key 已存在' });
    }
    console.error('[Admin] user field create error:', err);
    res.status(500).json({ success: false, message: '创建字段失败' });
  }
});

// PUT /user-fields/:id - Update a field definition
router.put('/:id', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const { field_label, field_type, is_required, is_public, options } = req.body;
    const updates = [];
    const params = [];

    if (field_label !== undefined) { updates.push('field_label = ?'); params.push(field_label); }
    if (field_type !== undefined) {
      if (!VALID_FIELD_TYPES.includes(field_type)) {
        return res.status(400).json({ success: false, message: `field_type 须为 ${VALID_FIELD_TYPES.join('/')}` });
      }
      updates.push('field_type = ?');
      params.push(field_type);
    }
    if (is_required !== undefined) { updates.push('is_required = ?'); params.push(is_required ? 1 : 0); }
    if (is_public !== undefined) { updates.push('is_public = ?'); params.push(is_public ? 1 : 0); }
    if (options !== undefined) { updates.push('options = ?'); params.push(JSON.stringify(options)); }

    if (updates.length === 0) return res.status(400).json({ success: false, message: '无更新内容' });

    params.push(req.params.id);
    const [result] = await pool.execute(`UPDATE user_fields SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '字段不存在' });

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'field.update', 'user_field', parseInt(req.params.id),
      null, getClientIp(req),
    );

    res.json({ success: true, message: '字段已更新' });
  } catch (err) {
    console.error('[Admin] user field update error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// DELETE /user-fields/:id - Delete a field definition (cascades to values)
router.delete('/:id', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM user_fields WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '字段不存在' });

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'field.delete', 'user_field', parseInt(req.params.id),
      null, getClientIp(req),
    );

    res.json({ success: true, message: '字段已删除' });
  } catch (err) {
    console.error('[Admin] user field delete error:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// PATCH /user-fields/sort - Update sort order
router.patch('/sort', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) return res.status(400).json({ success: false, message: 'orders 须为数组' });

    for (const item of orders) {
      await pool.execute('UPDATE user_fields SET sort_order = ? WHERE id = ?', [item.sort_order, item.id]);
    }

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'field.sort', 'user_field', null,
      { orders }, getClientIp(req),
    );

    res.json({ success: true, message: '排序已更新' });
  } catch (err) {
    console.error('[Admin] user field sort error:', err);
    res.status(500).json({ success: false, message: '排序失败' });
  }
});

module.exports = router;
