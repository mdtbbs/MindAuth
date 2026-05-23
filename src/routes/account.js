const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { client } = require('../redis');
const { isValidPassword, isValidEmail, getPasswordValidationError } = require('../utils/validation');
const { generateToken } = require('../utils/token');
const { sendVerificationEmail } = require('../utils/email');
const requireAuth = require('../middleware/requireAuth');

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

    // Verify old password
    const validPassword = await bcrypt.compare(old_password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '旧密码错误' });
    }

    // Update password
    const passwordHash = await bcrypt.hash(new_password, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);

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

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
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

module.exports = router;