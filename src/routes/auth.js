const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool, transaction, isDuplicateError, getDuplicateField } = require('../db');
const { client } = require('../redis');
const { generateToken } = require('../utils/token');
const { isValidEmail, isValidPassword, isValidUsername, getPasswordValidationError } = require('../utils/validation');
const { getClientIp } = require('../utils/request');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter, resetRateLimit } = require('../middleware/rateLimit');
const { sendVerificationEmail } = require('../utils/email');

const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds (Redis TTL)
const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const loginRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60 * 1000 });
const registerRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60 * 60 * 1000 }); // 5 per hour

// Register
router.post('/register', registerRateLimiter, async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: '所有字段必填' });
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

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const verifyToken = generateToken();

    // Use transaction for atomicity
    await transaction(async (conn) => {
      const [userResult] = await conn.execute(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        [username, email, passwordHash]
      );
      const userId = userResult.insertId;

      // Store verification token in Redis
      await client.setEx(`verify:${verifyToken}`, TOKEN_EXPIRY, JSON.stringify({
        user_id: userId,
        email: email
      }));
    });

    const verifyLink = `${BASE_URL}/#/verify-email?token=${verifyToken}`;
    sendVerificationEmail(email, verifyLink).catch(err =>
      console.error('Failed to send verification email:', err)
    );

    res.status(201).json({ success: true, message: '注册成功，验证邮件已发送到您的邮箱' });
  } catch (err) {
    if (isDuplicateError(err)) {
      const field = getDuplicateField(err);
      if (field === 'username') {
        return res.status(409).json({ success: false, message: '用户名已存在' });
      }
      if (field === 'email') {
        return res.status(409).json({ success: false, message: '邮箱已被注册' });
      }
      return res.status(409).json({ success: false, message: '用户名或邮箱已存在' });
    }
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

// Login
router.post('/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码必填' });
  }

  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    // Reset rate limit on successful login
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    await resetRateLimit(ip);

    const token = generateToken();
    await pool.execute('UPDATE users SET session_token = ? WHERE id = ?', [token, user.id]);

    // Cache session in Redis
    await client.setEx(`session:${token}`, 300, JSON.stringify({
      id: user.id,
      username: user.username,
      email: user.email,
      email_verified: user.email_verified,
      password_hash: user.password_hash,
      created_at: user.created_at
    }));

    // Record login log
    await pool.execute(
      'INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)',
      [user.id, ip, userAgent.slice(0, 200), 'web']
    );

    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE,
      sameSite: 'Lax',
      path: '/'
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// GET /login-logs - Get login history
router.get('/login-logs', requireAuth, async (req, res) => {
  try {
    const [logs] = await pool.execute(`
      SELECT id, ip, device, login_type, created_at
      FROM login_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [req.user.id]);

    res.json({ success: true, logs });
  } catch (err) {
    console.error('Get login logs error:', err);
    res.status(500).json({ success: false, message: '获取登录记录失败' });
  }
});

// Get current user
router.get('/me', requireAuth, (req, res) => {
  const { id, username, email, email_verified, created_at } = req.user;
  res.json({ success: true, id, username, email, email_verified, created_at });
});

// Logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = req.cookies.session;

    // Clear session in MySQL
    await pool.execute('UPDATE users SET session_token = NULL WHERE id = ?', [req.user.id]);

    // Clear session cache in Redis
    await client.del(`session:${token}`);

    res.clearCookie('session', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, message: '登出失败' });
  }
});

module.exports = router;