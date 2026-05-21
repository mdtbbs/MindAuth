const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateToken } = require('../utils/token');
const { isValidEmail, isValidPassword, isValidUsername } = require('../utils/validation');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter, resetRateLimit } = require('../middleware/rateLimit');
const { sendVerificationEmail } = require('../utils/email');

const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
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
    return res.status(400).json({ success: false, message: '密码至少6位' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // Use transaction for atomicity
    const insertUser = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
    const insertToken = db.prepare('INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)');

    const transaction = db.transaction(() => {
      const result = insertUser.run(username, email, passwordHash);
      const userId = result.lastInsertRowid;

      const verifyToken = generateToken();
      const expiresAt = new Date(Date.now() + TOKEN_EXPIRY).toISOString();
      insertToken.run(userId, email, verifyToken, expiresAt);

      return verifyToken;
    });

    const verifyToken = transaction();

    const verifyLink = `${BASE_URL}/#/verify-email?token=${verifyToken}`;
    sendVerificationEmail(email, verifyLink).catch(err =>
      console.error('Failed to send verification email:', err)
    );

    res.status(201).json({ success: true, message: '注册成功，验证邮件已发送到您的邮箱' });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      if (err.message.includes('username')) {
        return res.status(409).json({ success: false, message: '用户名已存在' });
      }
      if (err.message.includes('email')) {
        return res.status(409).json({ success: false, message: '邮箱已被注册' });
      }
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
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    // Reset rate limit on successful login
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    resetRateLimit(ip);

    const token = generateToken();
    db.prepare('UPDATE users SET session_token = ? WHERE id = ?').run(token, user.id);

    // Record login log
    db.prepare('INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)').run(user.id, ip, userAgent.slice(0, 200), 'web');

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
router.get('/login-logs', requireAuth, (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT id, ip, device, login_type, created_at
      FROM login_logs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(req.user.id);

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
router.post('/logout', requireAuth, (req, res) => {
  try {
    db.prepare('UPDATE users SET session_token = NULL WHERE id = ?').run(req.user.id);
    res.clearCookie('session', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, message: '登出失败' });
  }
});

module.exports = router;