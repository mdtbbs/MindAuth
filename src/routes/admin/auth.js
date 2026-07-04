const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../../db');
const { generateToken } = require('../../utils/token');
const { isValidEmail, isValidPassword, isValidUsername, getPasswordValidationError } = require('../../utils/validation');
const { timingSafeCompare } = require('../../utils/crypto');
const { getClientIp } = require('../../utils/request');
const { createAdminSession, deleteAdminSession, requireAdmin, normalizeRole, ROLE_PERMISSIONS } = require('../../middleware/requireAdmin');
const { createRateLimiter, resetRateLimit } = require('../../middleware/rateLimit');
const config = require('../../config');

const adminLoginRateLimiter = createRateLimiter(config.rateLimit.adminLogin);

// POST /create - Create admin account (requires ADMIN_SECRET)
router.post('/create', async (req, res) => {
  try {
    const { secret, username, email, password } = req.body;

    const adminSecret = config.admin.secret;

    // Security: Always check if ADMIN_SECRET is configured
    if (!adminSecret) {
      console.error('ADMIN_SECRET not configured - admin creation rejected');
      return res.status(500).json({ success: false, message: '管理员创建功能未配置' });
    }

    // Security: In production, enforce minimum secret length
    if (config.server.isProduction && adminSecret.length < config.adminSecurity.minSecretLength) {
      console.error('ADMIN_SECRET too short in production - admin creation rejected');
      return res.status(500).json({ success: false, message: '管理员创建密钥配置不符合安全要求' });
    }

    // Security: Validate secret is not empty string
    if (adminSecret.length === 0) {
      console.error('ADMIN_SECRET is empty - admin creation rejected');
      return res.status(500).json({ success: false, message: '管理员创建功能未配置' });
    }

    if (!timingSafeCompare(secret, adminSecret)) {
      return res.status(401).json({ success: false, message: '创建密钥错误' });
    }

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: '用户名、邮箱和密码必填' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ success: false, message: '用户名需2-50字符' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: '邮箱格式不正确' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ success: false, message: getPasswordValidationError(password) || '密码不符合要求' });
    }

    const [existingRows] = await pool.execute('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: '用户名或邮箱已存在' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.execute('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [username, email, passwordHash, 'super_admin']);

    res.status(201).json({ success: true, message: '管理员账号创建成功' });
  } catch (err) {
    console.error('Admin create error:', err);
    res.status(500).json({ success: false, message: '创建管理员失败' });
  }
});

// POST /login - Admin login
router.post('/login', adminLoginRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码必填' });
    }

    const [userRows] = await pool.execute(
      "SELECT * FROM users WHERE username = ? AND role IN ('admin', 'super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin')",
      [username]
    );
    const user = userRows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: '管理员账号不存在或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '管理员账号不存在或密码错误' });
    }

    await resetRateLimit(getClientIp(req), 'admin');

    const token = generateToken();
    await createAdminSession(token, user.id);

    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: config.server.isProduction,
      maxAge: config.admin.sessionMaxAge,
      sameSite: 'Lax',
      path: '/'
    });

    const normalizedRole = normalizeRole(user.role);
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: normalizedRole,
        permissions: ROLE_PERMISSIONS[normalizedRole] || []
      }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// POST /logout - Admin logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies.admin_session;
    if (token) {
      await deleteAdminSession(token);
    }
    res.clearCookie('admin_session', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    console.error('Admin logout error:', err);
    res.status(500).json({ success: false, message: '登出失败' });
  }
});

// GET /me - Get current admin info (requires authentication)
router.get('/me', requireAdmin, (req, res) => {
  const role = req.adminUser.normalized_role || normalizeRole(req.adminUser.role);
  res.json({
    success: true,
    admin: {
      id: req.adminUser.id,
      username: req.adminUser.username,
      email: req.adminUser.email,
      role,
      permissions: ROLE_PERMISSIONS[role] || []
    }
  });
});

module.exports = router;
