const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool, transaction } = require('../../db');
const { isValidUsername } = require('../../utils/validation');
const { requireAdmin } = require('../../middleware/requireAdmin');
const { invalidateUserAdminSessions } = require('../../middleware/requireAdmin');

// GET /users - Get all users
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { search, role, page, limit } = req.query;

    // 默认分页限制
    const defaultLimit = 50;
    const effectiveLimit = limit ? parseInt(limit) : defaultLimit;
    const effectivePage = page ? parseInt(page) : 1;

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
      pagination: page && limit ? { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } : undefined
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

// POST /users/:id/reset-password - Reset user password
router.post('/:id/reset-password', requireAdmin, async (req, res) => {
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

    res.json({
      success: true,
      message: '密码已重置，用户需使用临时密码重新登录',
      tempPassword
    });
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
      if (!isValidUsername(username)) {
        return res.status(400).json({ success: false, message: '用户名需2-50字符' });
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

// DELETE /users/:id - Delete user
router.delete('/:id', requireAdmin, async (req, res) => {
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