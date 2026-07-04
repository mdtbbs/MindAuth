const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { client } = require('../redis');
const { isValidPassword, isValidEmail, getPasswordValidationError } = require('../utils/validation');
const { generateToken } = require('../utils/token');
const { sendVerificationEmail } = require('../utils/email');
const requireAuth = require('../middleware/requireAuth');
const { avatarUpload, bannerUpload } = require('../middleware/upload');
const { createNotification } = require('../utils/notify');
const { getClientIp } = require('../utils/request');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const TOKEN_TTL = 3600; // 1 hour in seconds (Redis TTL)

// POST /change-password - Change password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    const user = req.user;

    if (!old_password || !new_password) {
      return res.status(400).json({ success: false, message: '旧密码和新密码必填' });
    }

    if (!isValidPassword(new_password)) {
      return res.status(400).json({ success: false, message: getPasswordValidationError(new_password) || '密码不符合要求' });
    }

    // Fetch password_hash separately (not included in req.user for security)
    const [userRows] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const passwordHash = userRows[0].password_hash;

    // Verify old password
    const validPassword = await bcrypt.compare(old_password, passwordHash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '旧密码错误' });
    }

    // Update password
    const newPasswordHash = await bcrypt.hash(new_password, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, user.id]);

    // Clear all sessions (force re-login)
    await pool.execute('UPDATE users SET session_token = NULL WHERE id = ?', [user.id]);
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);

    // Password change notification
    await createNotification({
      user_id: user.id, type: 'password_changed', title: '密码已修改',
      content: '您的登录密码已被修改，请重新登录。',
      ip_address: getClientIp(req), user_agent: req.headers['user-agent'],
      sendEmail: true,
    }).catch(err => console.warn('[Account] password notification failed:', err.message));

    // Clear session cache in Redis
    const token = req.cookies.session;
    if (token) {
      await client.del(`session:${token}`);
    }

    res.clearCookie('session', { path: '/' });

    res.json({ success: true, message: '密码已更新，请重新登录' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: '修改密码失败' });
  }
});

// POST /change-email - Request email change
router.post('/change-email', requireAuth, async (req, res) => {
  try {
    const { new_email } = req.body;
    const user = req.user;

    if (!new_email || !isValidEmail(new_email)) {
      return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
    }

    // Check if email already used by another user
    const [existingRows] = await pool.execute('SELECT id FROM users WHERE email = ? AND id != ?', [new_email, user.id]);
    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: '该邮箱已被其他用户使用' });
    }

    // Generate verification token
    const token = generateToken();

    // Store verification token in Redis (replaces any existing)
    await client.setEx(`verify:${token}`, TOKEN_TTL, JSON.stringify({
      user_id: user.id,
      email: new_email
    }));

    // Send verification email to new address
    const verifyLink = `${BASE_URL}/#/verify-email?token=${token}`;
    await sendVerificationEmail(new_email, verifyLink);

    res.json({ success: true, message: '验证邮件已发送到新邮箱，请点击链接完成更换' });
  } catch (err) {
    console.error('Change email error:', err);
    res.status(500).json({ success: false, message: '更换邮箱失败' });
  }
});

// DELETE / - Delete account
router.delete('/', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = req.user;

    if (!password) {
      return res.status(400).json({ success: false, message: '请输入密码确认删除' });
    }

    // Fetch password_hash separately (not included in req.user for security)
    const [userRows] = await pool.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id]
    );
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    const passwordHash = userRows[0].password_hash;

    // Verify password
    const validPassword = await bcrypt.compare(password, passwordHash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '密码错误' });
    }

    // Delete user's related data from MySQL
    await pool.execute('DELETE FROM authorizations WHERE user_id = ?', [user.id]);
    await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [user.id]);
    await pool.execute('DELETE FROM login_logs WHERE user_id = ?', [user.id]);

    // Delete user
    await pool.execute('DELETE FROM users WHERE id = ?', [user.id]);

    // Clear session cache in Redis
    const token = req.cookies.session;
    if (token) {
      await client.del(`session:${token}`);
    }

    res.clearCookie('session', { path: '/' });
    res.json({ success: true, message: '账号已删除' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ success: false, message: '删除账号失败' });
  }
});

// POST /avatar - Upload avatar
router.post('/avatar', requireAuth, avatarUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' });
    }

    const user = req.user;
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // 删除旧头像文件（如果存在）
    const [oldRows] = await pool.execute('SELECT avatar_url FROM users WHERE id = ?', [user.id]);
    if (oldRows.length > 0 && oldRows[0].avatar_url) {
      const oldPath = path.join(__dirname, '../../public', oldRows[0].avatar_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, user.id]);

    res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: '图片大小不能超过 2MB' });
    }
    res.status(500).json({ success: false, message: '上传头像失败' });
  }
});

// DELETE /avatar - Delete avatar
router.delete('/avatar', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    // 获取旧头像路径
    const [rows] = await pool.execute('SELECT avatar_url FROM users WHERE id = ?', [user.id]);
    if (rows.length > 0 && rows[0].avatar_url) {
      const oldPath = path.join(__dirname, '../../public', rows[0].avatar_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET avatar_url = NULL WHERE id = ?', [user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Avatar delete error:', err);
    res.status(500).json({ success: false, message: '删除头像失败' });
  }
});

// POST /banner - Upload banner
router.post('/banner', requireAuth, bannerUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请选择图片文件' });
    }

    const user = req.user;
    const bannerUrl = `/uploads/banners/${req.file.filename}`;

    // 删除旧背景文件（如果存在）
    const [oldRows] = await pool.execute('SELECT banner_url FROM users WHERE id = ?', [user.id]);
    if (oldRows.length > 0 && oldRows[0].banner_url) {
      const oldPath = path.join(__dirname, '../../public', oldRows[0].banner_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET banner_url = ? WHERE id = ?', [bannerUrl, user.id]);

    res.json({ success: true, banner_url: bannerUrl });
  } catch (err) {
    console.error('Banner upload error:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: '图片大小不能超过 5MB' });
    }
    res.status(500).json({ success: false, message: '上传背景图失败' });
  }
});

// DELETE /banner - Delete banner
router.delete('/banner', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    // 获取旧背景路径
    const [rows] = await pool.execute('SELECT banner_url FROM users WHERE id = ?', [user.id]);
    if (rows.length > 0 && rows[0].banner_url) {
      const oldPath = path.join(__dirname, '../../public', rows[0].banner_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新数据库
    await pool.execute('UPDATE users SET banner_url = NULL WHERE id = ?', [user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Banner delete error:', err);
    res.status(500).json({ success: false, message: '删除背景图失败' });
  }
});

// GET /fields - Get user's custom field values
router.get('/fields', requireAuth, async (req, res) => {
  try {
    const [fields] = await pool.execute(
      'SELECT id, field_key, field_label, field_type, is_required, options FROM user_fields ORDER BY sort_order ASC'
    );
    const [values] = await pool.execute(
      'SELECT field_id, value FROM user_field_values WHERE user_id = ?',
      [req.user.id]
    );
    const valueMap = {};
    for (const v of values) valueMap[v.field_id] = v.value;

    res.json({
      success: true,
      fields: fields.map((f) => ({
        field_key: f.field_key,
        field_label: f.field_label,
        field_type: f.field_type,
        is_required: f.is_required === 1,
        options: f.options ? (typeof f.options === 'string' ? JSON.parse(f.options) : f.options) : null,
        value: valueMap[f.id] || null,
      })),
    });
  } catch (err) {
    console.error('[Account] fields get error:', err);
    res.status(500).json({ success: false, message: '获取字段失败' });
  }
});

// PUT /fields - Update user's custom field values
router.put('/fields', requireAuth, async (req, res) => {
  try {
    const { values } = req.body;
    if (!values || typeof values !== 'object') {
      return res.status(400).json({ success: false, message: 'values 须为对象' });
    }

    const [fields] = await pool.execute('SELECT id, field_key, field_type FROM user_fields');
    const fieldMap = {};
    for (const f of fields) fieldMap[f.field_key] = f;

    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap[key];
      if (!field) continue;

      if (value === null || value === '') {
        await pool.execute('DELETE FROM user_field_values WHERE user_id = ? AND field_id = ?', [req.user.id, field.id]);
      } else {
        await pool.execute(
          'INSERT INTO user_field_values (user_id, field_id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?',
          [req.user.id, field.id, String(value), String(value)]
        );
      }
    }

    res.json({ success: true, message: '字段已更新' });
  } catch (err) {
    console.error('[Account] fields update error:', err);
    res.status(500).json({ success: false, message: '更新字段失败' });
  }
});

module.exports = router;
