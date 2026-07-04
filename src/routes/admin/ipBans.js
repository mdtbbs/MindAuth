const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { getClientIp } = require('../../utils/request');
const { logAudit } = require('../../utils/auditLog');
const { invalidateIpBanCache } = require('../../middleware/ipBan');

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

router.get('/', requireAdmin, requireAdminPermission('ip_bans.read'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      'SELECT id, ip_address, cidr_prefix, reason, banned_by, created_at, expires_at FROM ip_bans ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const [countRows] = await pool.execute('SELECT COUNT(*) as count FROM ip_bans');

    res.json({
      success: true,
      bans: rows,
      pagination: { page, limit, total: countRows[0].count, totalPages: Math.ceil(countRows[0].count / limit) },
    });
  } catch (err) {
    console.error('[Admin] IP bans list error:', err);
    res.status(500).json({ success: false, message: '获取 IP 黑名单失败' });
  }
});

router.post('/', requireAdmin, requireAdminPermission('ip_bans.write'), async (req, res) => {
  try {
    const { ip, cidr_prefix, reason, expires_at } = req.body;

    if (!ip || !IPV4_RE.test(ip)) {
      return res.status(400).json({ success: false, message: 'IP 地址格式无效' });
    }
    if (cidr_prefix !== undefined && cidr_prefix !== null) {
      const prefix = parseInt(cidr_prefix);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        return res.status(400).json({ success: false, message: 'CIDR 前缀须为 0-32' });
      }
    }

    const [result] = await pool.execute(
      'INSERT INTO ip_bans (ip_address, cidr_prefix, reason, banned_by, expires_at) VALUES (?, ?, ?, ?, ?)',
      [ip, cidr_prefix ?? null, reason || null, req.adminUser.id, expires_at || null]
    );

    await invalidateIpBanCache();
    await logAudit({
      admin_id: req.adminUser.id,
      action: 'ip_ban.create',
      target_type: 'ip_ban',
      target_id: result.insertId,
      details: { ip, cidr_prefix, reason, expires_at },
      ip_address: getClientIp(req),
    });

    res.json({ success: true, message: 'IP 已加入黑名单', id: result.insertId });
  } catch (err) {
    console.error('[Admin] IP ban create error:', err);
    res.status(500).json({ success: false, message: '添加 IP 黑名单失败' });
  }
});

router.put('/:id', requireAdmin, requireAdminPermission('ip_bans.write'), async (req, res) => {
  try {
    const { reason, expires_at } = req.body;
    const [result] = await pool.execute(
      'UPDATE ip_bans SET reason = ?, expires_at = ? WHERE id = ?',
      [reason || null, expires_at || null, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }

    await invalidateIpBanCache();
    await logAudit({
      admin_id: req.adminUser.id,
      action: 'ip_ban.update',
      target_type: 'ip_ban',
      target_id: parseInt(req.params.id),
      details: { reason, expires_at },
      ip_address: getClientIp(req),
    });

    res.json({ success: true, message: '已更新' });
  } catch (err) {
    console.error('[Admin] IP ban update error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

router.delete('/:id', requireAdmin, requireAdminPermission('ip_bans.write'), async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM ip_bans WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }

    await invalidateIpBanCache();
    await logAudit({
      admin_id: req.adminUser.id,
      action: 'ip_ban.delete',
      target_type: 'ip_ban',
      target_id: parseInt(req.params.id),
      ip_address: getClientIp(req),
    });

    res.json({ success: true, message: '已删除' });
  } catch (err) {
    console.error('[Admin] IP ban delete error:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

module.exports = router;
