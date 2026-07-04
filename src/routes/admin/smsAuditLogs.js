const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');

const ACTIONS = new Set(['send_code', 'verify_code']);
const SUCCESS_VALUES = new Set(['0', '1', 'false', 'true']);

function parsePositiveInt(value, fallback, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseSuccess(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = String(value).toLowerCase();
  if (!SUCCESS_VALUES.has(normalized)) {
    return undefined;
  }
  return normalized === '1' || normalized === 'true' ? 1 : 0;
}

function buildSmsAuditFilters(queryParams) {
  const {
    user_id,
    action,
    success,
    code,
    ip_address,
    phone_last4,
    start_date,
    end_date,
  } = queryParams;

  const conditions = [];
  const params = [];
  const countParams = [];

  function addCondition(sql, value) {
    conditions.push(sql);
    params.push(value);
    countParams.push(value);
  }

  if (user_id !== undefined && user_id !== '') {
    const parsedUserId = parseInt(user_id, 10);
    if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
      return { error: 'INVALID_USER_ID' };
    }
    addCondition('s.user_id = ?', parsedUserId);
  }

  if (action) {
    if (!ACTIONS.has(action)) {
      return { error: 'INVALID_ACTION' };
    }
    addCondition('s.action = ?', action);
  }

  const parsedSuccess = parseSuccess(success);
  if (parsedSuccess === undefined) {
    return { error: 'INVALID_SUCCESS' };
  }
  if (parsedSuccess !== null) {
    addCondition('s.success = ?', parsedSuccess);
  }

  if (code) {
    if (!/^[A-Z0-9_.:-]{2,80}$/i.test(code)) {
      return { error: 'INVALID_CODE' };
    }
    addCondition('s.code = ?', code);
  }

  if (ip_address) {
    if (String(ip_address).length > 45) {
      return { error: 'INVALID_IP' };
    }
    addCondition('s.ip_address = ?', ip_address);
  }

  if (phone_last4) {
    if (!/^\d{4}$/.test(phone_last4)) {
      return { error: 'INVALID_PHONE_LAST4' };
    }
    addCondition('s.phone_masked LIKE ?', `%${phone_last4}`);
  }

  if (start_date) {
    addCondition('s.created_at >= ?', start_date);
  }

  if (end_date) {
    addCondition('s.created_at <= ?', end_date);
  }

  return {
    where: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
    countParams,
  };
}

// GET /sms-audit-logs - View SMS verification audit logs
router.get('/sms-audit-logs', requireAdmin, requireAdminPermission('sms_audit.read'), async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const offset = (page - 1) * limit;

    const filters = buildSmsAuditFilters(req.query);
    if (filters.error) {
      return res.status(400).json({ success: false, code: filters.error, message: '查询参数无效' });
    }

    const selectSql = `
      SELECT
        s.id,
        s.user_id,
        u.username,
        s.action,
        s.phone_masked,
        s.success,
        s.code,
        s.ip_address,
        s.user_agent,
        s.created_at
      FROM sms_audit_logs s
      LEFT JOIN users u ON u.id = s.user_id
      ${filters.where}
      ORDER BY s.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `
      SELECT COUNT(*) as count
      FROM sms_audit_logs s
      ${filters.where}
    `;

    const [rows] = await pool.execute(selectSql, filters.params);
    const [countRows] = await pool.execute(countSql, filters.countParams);
    const total = countRows[0]?.count || 0;

    res.json({
      success: true,
      logs: rows.map((row) => ({
        ...row,
        success: row.success === 1 || row.success === true,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[Admin] SMS audit logs error:', err);
    res.status(500).json({ success: false, message: '获取短信审计日志失败' });
  }
});

module.exports = router;
