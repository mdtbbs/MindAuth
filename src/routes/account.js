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

// GET /linked-accounts - Get all linked external accounts
router.get('/linked-accounts', requireAuth, async (req, res) => {
  try {
    const [linkedAccounts] = await pool.execute(`
      SELECT provider, external_user_id, external_username, external_email,
             external_avatar_url, external_user_group_id, external_is_admin,
             external_is_moderator, linked_at
      FROM external_identities WHERE user_id = ?
    `, [req.user.id]);

    res.json({
      success: true,
      linked_accounts: linkedAccounts.map(link => ({
        provider: link.provider,
        external_user_id: link.external_user_id,
        external_username: link.external_username,
        external_email: link.external_email,
        external_avatar_url: link.external_avatar_url,
        external_user_group_id: link.external_user_group_id,
        external_is_admin: link.external_is_admin === 1,
        external_is_moderator: link.external_is_moderator === 1,
        linked_at: link.linked_at.toISOString()
      }))
    });
  } catch (err) {
    console.error('Get linked accounts error:', err);
    res.status(500).json({ success: false, message: '获取关联账号失败' });
  }
});

module.exports = router;