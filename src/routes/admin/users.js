const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool, transaction } = require('../../db');
const { isValidUsername, getUsernameValidationError, escapeHtml } = require('../../utils/validation');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { invalidateUserAdminSessions } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');
const config = require('../../config');

// Rate limiters for sensitive admin operations
const passwordResetLimiter = createRateLimiter(config.adminSecurity.passwordReset);
const userDeleteLimiter = createRateLimiter(config.adminSecurity.userDelete);

// GET /users - Get all users
router.get('/', requireAdmin, async (req, res) => {
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

    let query = 'SELECT id, username, email, email_verified, role, created_at FROM users';
    let params = [];

    if (search) {
      query += ' WHERE username LIKE ? OR email LIKE ?';
      params = [`%${search}%`, `%${search}%`];
    }

    if (role) {
      if (params.length > 0) {
        query += ' AND role = ?';
      } else {
        query += ' WHERE role = ?';
      }
      params.push(role);
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
        totalQuery += ' AND role = ?';
      } else {
        totalQuery += ' WHERE role = ?';
      }
      totalParams.push(role);
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

// GET /users/:id - Get user details with authorizations
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.execute('SELECT id, username, email, email_verified, role, created_at FROM users WHERE id = ?', [id]);
    const user = userRows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const [authorizations] = await pool.execute(`
      SELECT a.client_id, c.name as client_name, a.last_used_at, a.created_at
      FROM authorizations a
      LEFT JOIN clients c ON a.client_id = c.id
      WHERE a.user_id = ?
      ORDER BY a.last_used_at DESC
    `, [id]);

    res.json({ success: true, user, authorizations });
  } catch (err) {
    console.error('Get user details error:', err);
    res.status(500).json({ success: false, message: '获取用户详情失败' });
  }
});

// POST /users/:id/reset-password - Reset user password (rate limited)
router.post('/:id/reset-password', requireAdmin, passwordResetLimiter, async (req, res) => {
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
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, email_verified, username } = req.body;

    if (role && !['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: '无效的角色' });
    }

    const [currentRows] = await pool.execute('SELECT role FROM users WHERE id = ?', [id]);
    const currentRole = currentRows[0]?.role;

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

    if (role && currentRole === 'admin' && role !== 'admin') {
      await invalidateUserAdminSessions(parseInt(id));
    }

    res.json({ success: true, message: '用户信息已更新' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: '更新用户失败' });
  }
});

// DELETE /users/:id - Delete user (rate limited for security)
router.delete('/:id', requireAdmin, userDeleteLimiter, async (req, res) => {
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

    res.json({ success: true, message: '用户已删除' });
  } catch (err) {
    if (err.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: '删除用户失败' });
  }
});

module.exports = router;