const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool, transaction } = require('../../db');
const { isValidUsername, getUsernameValidationError, escapeHtml } = require('../../utils/validation');
const { requireAdmin, requireAdminPermission, invalidateUserAdminSessions, isAdminRole } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');
const { logAudit } = require('../../utils/auditLog');
const { createNotification } = require('../../utils/notify');
const config = require('../../config');

const BAN_DURATIONS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'permanent': null,
};

function calcBanExpiry(duration, expires_at) {
  if (expires_at) return new Date(expires_at);
  if (duration === 'permanent' || duration === undefined) return null;
  const ms = BAN_DURATIONS[duration];
  if (ms === undefined) return null;
  return new Date(Date.now() + ms);
}

// Rate limiters for sensitive admin operations
const passwordResetLimiter = createRateLimiter(config.adminSecurity.passwordReset);
const userDeleteLimiter = createRateLimiter(config.adminSecurity.userDelete);
const USER_ROLES = ['user', 'moderator', 'admin', 'super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin'];

function isSuperAdmin(req) {
  return req.adminUser?.normalized_role === 'super_admin' || req.adminUser?.role === 'admin';
}

// GET /users - Get all users
router.get('/', requireAdmin, requireAdminPermission('users.read'), async (req, res) => {
  try {
    const { search, role, page, limit } = req.query;

    // Security: Validate pagination parameters are positive integers
    const defaultLimit = 50;
    const maxLimit = 100;

    let effectiveLimit = defaultLimit;
    if (limit) {
      const parsedLimit = parseInt(limit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > maxLimit) {
        return res.status(400).json({ success: false, message: '分页参数无效' });
      }
      effectiveLimit = parsedLimit;
    }

    let effectivePage = 1;
    if (page) {
      const parsedPage = parseInt(page);
      if (!Number.isInteger(parsedPage) || parsedPage < 1) {
        return res.status(400).json({ success: false, message: '分页参数无效' });
      }
      effectivePage = parsedPage;
    }

    let query = 'SELECT id, username, email, email_verified, role, phone, phone_verified, ban_status, lock_level, created_at FROM users';
    let params = [];

    if (search) {
      query += ' WHERE username LIKE ? OR email LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }

    if (role) {
      if (params.length > 0) {
        query += role === 'admin' ? " AND role IN ('admin', 'super_admin')" : ' AND role = ?';
      } else {
        query += role === 'admin' ? " WHERE role IN ('admin', 'super_admin')" : ' WHERE role = ?';
      }
      if (role !== 'admin') params.push(role);
    }

    query += ' ORDER BY created_at DESC';

    // 添加默认分页 - use query() instead of execute() for LIMIT/OFFSET
    // MySQL prepared statements have issues with LIMIT/OFFSET parameters
    // Values are validated above to be positive integers within bounds
    const offset = (effectivePage - 1) * effectiveLimit;
    query += ` LIMIT ${effectiveLimit} OFFSET ${offset}`;

    const [users] = await pool.query(query, params);

    // Get total count
    let totalQuery = 'SELECT COUNT(*) as count FROM users';
    let totalParams = [];
    if (search) {
      totalQuery += ' WHERE username LIKE ? OR email LIKE ?';
      totalParams = [`%${search}%`, `%${search}%`];
    }
    if (role) {
      if (totalParams.length > 0) {
        totalQuery += role === 'admin' ? " AND role IN ('admin', 'super_admin')" : ' AND role = ?';
      } else {
        totalQuery += role === 'admin' ? " WHERE role IN ('admin', 'super_admin')" : ' WHERE role = ?';
      }
      if (role !== 'admin') totalParams.push(role);
    }
    const [totalRows] = await pool.execute(totalQuery, totalParams);
    const total = totalRows[0].count;

    res.json({
      success: true,
      users,
      pagination: page && limit ? { page: effectivePage, limit: effectiveLimit, total, totalPages: Math.ceil(total / effectiveLimit) } : undefined
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

// GET /users/:id - Get user details with related activity
router.get('/:id', requireAdmin, requireAdminPermission('users.read'), async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.execute(
      `SELECT id, username, email, email_verified, role, avatar_url, banner_url, phone, phone_verified,
              phone_verified_at, ban_status, ban_reason, banned_by, ban_expires_at, lock_level, locked_until, created_at
       FROM users WHERE id = ?`,
      [id]
    );
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const [authorizations] = await pool.execute(`
      SELECT a.id, a.client_id, c.name as client_name, a.scope, a.last_used_at, a.created_at
      FROM authorizations a
      LEFT JOIN clients c ON a.client_id = c.id
      WHERE a.user_id = ?
      ORDER BY a.last_used_at DESC
      LIMIT 20
    `, [id]);

    const [loginLogs] = await pool.execute(`
      SELECT id, ip, device, login_type, created_at
      FROM login_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const [smsLogs] = await pool.execute(`
      SELECT id, action, phone_masked, success, code, ip_address, created_at
      FROM sms_audit_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const [notifications] = await pool.execute(`
      SELECT id, type, title, content, is_read, created_at
      FROM user_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const [auditLogs] = await pool.execute(`
      SELECT id, admin_id, action, target_type, target_id, details, ip_address, created_at
      FROM admin_audit_logs
      WHERE target_type = 'user' AND target_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    const [sessions] = await pool.execute(`
      SELECT id, ip_address, device_info, created_at, last_active_at
      FROM user_sessions
      WHERE user_id = ?
      ORDER BY last_active_at DESC
      LIMIT 20
    `, [id]);

    res.json({
      success: true,
      user,
      authorizations,
      login_logs: loginLogs,
      sms_logs: smsLogs.map((log) => ({ ...log, success: log.success === 1 || log.success === true })),
      notifications: notifications.map((notification) => ({ ...notification, is_read: notification.is_read === 1 || notification.is_read === true })),
      audit_logs: auditLogs,
      sessions,
    });
  } catch (err) {
    console.error('Get user details error:', err);
    res.status(500).json({ success: false, message: '获取用户详情失败' });
  }
});

// POST /users/:id/reset-password - Reset user password (rate limited)
router.post('/:id/reset-password', requireAdmin, requireAdminPermission('users.reset_password'), passwordResetLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [id]);
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, id]);
    await pool.execute('UPDATE users SET session_token = NULL WHERE id = ?', [id]);
    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);

    // Try to send temporary password via email
    // Security: Escape all dynamic content in HTML email
    const { sendEmail } = require('../../utils/email');
    const escapedUsername = escapeHtml(user.username);
    const escapedEmail = escapeHtml(user.email);
    const emailSent = await sendEmail(
      user.email,
      '密码已重置',
      `<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #3b82f6;">密码已重置</h2>
        <p>您好 ${escapedUsername}，您的密码已被管理员重置。</p>
        <p>临时密码：<strong style="font-size: 18px; background: #f3f4f6; padding: 8px 12px; border-radius: 4px;">${tempPassword}</strong></p>
        <p>请使用此临时密码登录，并尽快修改密码。</p>
        <p style="color: #666; font-size: 12px;">如果您没有请求重置密码，请联系管理员。</p>
      </div>`
    );

    // Security: In production, NEVER return temporary password in API response
    // In development mode without email config, log to console instead
    if (config.server.isProduction) {
      // Production: Never expose password, even if email failed
      if (emailSent.mode === 'console') {
        console.warn(`[SECURITY] Password reset for user ${user.username} (${id}) - email failed. Temp password logged separately.`);
        console.warn(`[SECURITY] Temp password for ${user.username}: ${tempPassword}`);
      }
      res.json({
        success: true,
        message: '密码已重置，临时密码已发送到用户邮箱'
      });
    } else {
      // Development: Allow returning password only when email not configured
      if (emailSent.mode === 'console') {
        res.json({
          success: true,
          message: '密码已重置（邮件未配置，临时密码仅在开发环境显示）',
          tempPassword,
          emailMode: 'development'
        });
      } else {
        res.json({
          success: true,
          message: '密码已重置，临时密码已发送到用户邮箱'
        });
      }
    }
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: '重置密码失败' });
  }
});

// PUT /users/:id - Update user
router.put('/:id', requireAdmin, requireAdminPermission('users.write'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, email_verified, username } = req.body;

    if (role && !USER_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
    }

    const [currentRows] = await pool.execute('SELECT role FROM users WHERE id = ?', [id]);
    const currentRole = currentRows[0]?.role;

    if (!currentRows[0]) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (role && (isAdminRole(role) || isAdminRole(currentRole)) && !isSuperAdmin(req)) {
      return res.status(403).json({ success: false, message: '只有超级管理员可以调整管理员角色' });
    }

    const updates = [];
    const params = [];

    if (role) {
      updates.push('role = ?');
      params.push(role);
    }

    if (email_verified !== undefined) {
      updates.push('email_verified = ?');
      params.push(email_verified ? 1 : 0);
    }

    if (username) {
      const usernameError = getUsernameValidationError(username);
      if (usernameError) {
        return res.status(400).json({ success: false, message: usernameError });
      }
      updates.push('username = ?');
      params.push(username.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: '无更新内容' });
    }

    params.push(id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    if (role && isAdminRole(currentRole) && !isAdminRole(role)) {
      await invalidateUserAdminSessions(parseInt(id));
    }

    await logAudit({
      admin_id: req.adminUser.id, action: 'user.update', target_type: 'user', target_id: parseInt(id),
      details: req.body, ip_address: getClientIp(req),
    });

    res.json({ success: true, message: '用户信息已更新' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: '更新用户失败' });
  }
});

// DELETE /users/:id - Delete user (rate limited for security)
router.delete('/:id', requireAdmin, requireAdminPermission('users.delete'), userDeleteLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    await transaction(async (conn) => {
      await conn.execute('DELETE FROM authorizations WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [id]);
      await conn.execute('DELETE FROM login_logs WHERE user_id = ?', [id]);
      const [result] = await conn.execute('DELETE FROM users WHERE id = ?', [id]);

      if (result.affectedRows === 0) {
        throw new Error('USER_NOT_FOUND');
      }
    });

    await logAudit({
      admin_id: req.adminUser.id, action: 'user.delete', target_type: 'user', target_id: parseInt(id),
      ip_address: getClientIp(req),
    });

    res.json({ success: true, message: '用户已删除' });
  } catch (err) {
    if (err.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: '删除用户失败' });
  }
});

// POST /users/:id/ban - Ban user
router.post('/:id/ban', requireAdmin, requireAdminPermission('users.ban'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, duration, expires_at } = req.body;
    const banExpires = calcBanExpiry(duration, expires_at);

    const [result] = await pool.execute(
      'UPDATE users SET ban_status = ?, ban_reason = ?, banned_by = ?, ban_expires_at = ? WHERE id = ?',
      ['banned', reason || null, req.adminUser.id, banExpires, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    await createNotification({
      user_id: parseInt(id), type: 'account_banned', title: '账号已被封禁',
      content: reason ? `原因：${reason}` : '您的账号已被封禁',
      sendEmail: true,
    });
    await logAudit({ admin_id: req.adminUser.id, action: 'user.ban', target_type: 'user', target_id: parseInt(id), details: { reason, duration, expires_at }, ip_address: getClientIp(req) });
    res.json({ success: true, message: '用户已被封禁', ban_expires_at: banExpires });
  } catch (err) {
    console.error('Ban user error:', err);
    res.status(500).json({ success: false, message: '封禁失败' });
  }
});

// POST /users/:id/mute - Mute user
router.post('/:id/mute', requireAdmin, requireAdminPermission('users.ban'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, duration, expires_at } = req.body;
    const banExpires = calcBanExpiry(duration, expires_at);

    const [result] = await pool.execute(
      'UPDATE users SET ban_status = ?, ban_reason = ?, banned_by = ?, ban_expires_at = ? WHERE id = ?',
      ['muted', reason || null, req.adminUser.id, banExpires, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    await logAudit({ admin_id: req.adminUser.id, action: 'user.mute', target_type: 'user', target_id: parseInt(id), details: { reason, duration, expires_at }, ip_address: getClientIp(req) });
    res.json({ success: true, message: '用户已被禁言', ban_expires_at: banExpires });
  } catch (err) {
    console.error('Mute user error:', err);
    res.status(500).json({ success: false, message: '禁言失败' });
  }
});

// DELETE /users/:id/ban - Unban/unmute user
router.delete('/:id/ban', requireAdmin, requireAdminPermission('users.ban'), async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      "UPDATE users SET ban_status = 'none', ban_reason = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
      [id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    await createNotification({
      user_id: parseInt(id), type: 'account_unbanned', title: '账号已解封',
      content: '您的账号已被解封', sendEmail: true,
    });
    await logAudit({ admin_id: req.adminUser.id, action: 'user.unban', target_type: 'user', target_id: parseInt(id), ip_address: getClientIp(req) });
    res.json({ success: true, message: '用户已解封' });
  } catch (err) {
    console.error('Unban user error:', err);
    res.status(500).json({ success: false, message: '解封失败' });
  }
});

// POST /users/:id/unlock - Unlock account (reset lock_level)
router.post('/:id/unlock', requireAdmin, requireAdminPermission('users.unlock'), async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE users SET lock_level = 0, locked_until = NULL WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: '用户不存在' });

    await logAudit({ admin_id: req.adminUser.id, action: 'user.unlock', target_type: 'user', target_id: parseInt(id), ip_address: getClientIp(req) });
    res.json({ success: true, message: '账号已解锁' });
  } catch (err) {
    console.error('Unlock user error:', err);
    res.status(500).json({ success: false, message: '解锁失败' });
  }
});

module.exports = router;
