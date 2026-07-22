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
const { maskPhone } = require('../utils/phone');
const { logAudit } = require('../utils/auditLog');
const { createNotification } = require('../utils/notify');
const { logUserAudit } = require('../utils/userAudit');
const sessionManager = require('../modules/sessions/sessionManager');

const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds (Redis TTL)
const BASE_URL = process.env.BASE_URL || 'http://localhost:4001';
const loginRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5 * 60 * 1000 });
const registerRateLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60 * 60 * 1000 }); // 5 per hour

// Register
router.post('/register', registerRateLimiter, async (req, res) => {
  const { username, email, password, challenge_id, challenge_answer } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: '所有字段必填' });
  }

  // Check if any challenge questions are enabled; if so, verification is mandatory
  const [challengeEnabledRows] = await pool.execute(
    'SELECT COUNT(*) as count FROM challenge_questions WHERE enabled = 1'
  );
  const challengeRequired = challengeEnabledRows[0].count > 0;

  if (challengeRequired && !challenge_id) {
    return res.status(400).json({
      success: false,
      code: 'CHALLENGE_REQUIRED',
      message: '请先完成验证问答'
    });
  }

  // Verify challenge question if enabled
  if (challenge_id) {
    const csrfToken = req.cookies.csrf_token || 'anonymous';
    const sessionKey = `challenge_session:${csrfToken}`;
    const sessionData = await client.get(sessionKey);

    if (!sessionData) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_EXPIRED', message: '验证已过期，请刷新获取新题' });
    }

    const session = JSON.parse(sessionData);
    if (session.question_id !== parseInt(challenge_id)) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_MISMATCH', message: '题目不匹配' });
    }

    const [qRows] = await pool.execute(
      'SELECT answer_hash FROM challenge_questions WHERE id = ? AND enabled = 1',
      [challenge_id]
    );
    if (qRows.length === 0) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_NOT_FOUND', message: '题目不存在' });
    }
    const match = await bcrypt.compare(String(challenge_answer || '').trim().toLowerCase(), qRows[0].answer_hash);
    if (!match) {
      return res.status(400).json({ success: false, code: 'CHALLENGE_FAILED', message: '问答验证失败' });
    }
    await client.del(sessionKey);
  } else if (challengeRequired) {
    // Should not reach here (already handled above), but guard defensively
    return res.status(400).json({ success: false, code: 'CHALLENGE_REQUIRED', message: '请先完成验证问答' });
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

    // Check ban status
    if (user.ban_status === 'banned') {
      const isExpired = user.ban_expires_at && new Date(user.ban_expires_at) < new Date();
      if (isExpired) {
        await pool.execute(
          "UPDATE users SET ban_status = 'none', ban_reason = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
          [user.id]
        );
      } else {
        return res.status(403).json({
          success: false,
          code: 'USER_BANNED',
          message: user.ban_reason || '账号已被封禁',
          ban_expires_at: user.ban_expires_at,
        });
      }
    }

    // Check account lock status
    if (user.locked_until) {
      const lockExpiry = new Date(user.locked_until);
      if (lockExpiry > new Date()) {
        return res.status(423).json({
          success: false,
          code: 'ACCOUNT_LOCKED',
          message: `账号已锁定，请${Math.ceil((lockExpiry - new Date()) / 60000)}分钟后重试`,
          locked_until: user.locked_until,
          lock_level: user.lock_level,
        });
      }
      // Lock expired, clear it
      await pool.execute('UPDATE users SET locked_until = NULL WHERE id = ?', [user.id]);
    } else if (user.lock_level >= 3) {
      return res.status(423).json({
        success: false,
        code: 'ACCOUNT_PERMANENTLY_LOCKED',
        message: '账号已被永久锁定，请联系管理员解锁',
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      // Audit: login failed
      logUserAudit({
        user_id: user.id,
        action: 'login_failed',
        ip_address: getClientIp(req),
        user_agent: req.headers['user-agent'],
        details: { reason: 'invalid_password' },
      });

      // Increment login failure counter
      const failKey = `login_fail:${username}`;
      const failCount = await client.incr(failKey);
      if (failCount === 1) await client.expire(failKey, 300);

      if (failCount >= 5) {
        const newLevel = (user.lock_level || 0) + 1;
        let lockedUntil = null;
        if (newLevel === 1) lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        else if (newLevel === 2) lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        // newLevel >= 3: lockedUntil stays null (permanent)

        await pool.execute(
          'UPDATE users SET lock_level = ?, locked_until = ? WHERE id = ?',
          [newLevel, lockedUntil, user.id]
        );
        await client.del(failKey);

        const lockMsg = newLevel >= 3 ? '永久锁定' : `锁定${newLevel === 1 ? '30分钟' : '24小时'}`;
        await createNotification({
          user_id: user.id, type: 'account_locked', title: '账号已被锁定',
          content: `连续登录失败次数过多，账号已被${lockMsg}`, sendEmail: true,
        });
        logUserAudit({
          user_id: user.id,
          action: 'account_locked',
          ip_address: getClientIp(req),
          user_agent: req.headers['user-agent'],
          details: { lock_level: newLevel, duration: lockMsg },
        });
      }

      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }

    // Reset rate limit on successful login
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    await resetRateLimit(ip);
    await client.del(`login_fail:${username}`);

    // Reset lock status on successful login
    if (user.lock_level > 0) {
      await pool.execute('UPDATE users SET lock_level = 0 WHERE id = ?', [user.id]);
    }

    // Create session via sessionManager (hash-based, stored in user_sessions)
    const sessionResult = await sessionManager.createUserSession({
      userId: user.id,
      ipAddress: ip,
      userAgent: userAgent,
    });

    // Record login log
    await pool.execute(
      'INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)',
      [user.id, ip, userAgent.slice(0, 200), 'web']
    );

    // New device notification
    try {
      const [prevLog] = await pool.execute(
        'SELECT ip FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET 1',
        [user.id]
      );
      if (prevLog.length > 0 && prevLog[0].ip !== ip) {
        await createNotification({
          user_id: user.id, type: 'login_new_device', title: '新设备登录',
          content: `检测到新设备登录，IP: ${ip}`,
          ip_address: ip, user_agent: userAgent, sendEmail: true,
        });
      }
    } catch (notifyErr) {
      console.warn('[Login] new device notification failed:', notifyErr.message);
    }

    res.cookie('session', sessionResult.token, {
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
  const { id, username, email, email_verified, role, avatar_url, banner_url, phone, phone_verified, phone_verified_at, created_at } = req.user;
  res.json({
    success: true,
    id,
    username,
    email,
    email_verified,
    role,
    avatar_url,
    banner_url,
    phone_masked: maskPhone(phone),
    phone_verified: phone_verified === 1 || phone_verified === true,
    phone_verified_at,
    created_at
  });
});

// Logout
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = req.cookies.session;

    // Revoke session via sessionManager (clears MySQL, Redis cache, and index set)
    await sessionManager.revokeUserSession({ token, userId: req.user.id });

    res.clearCookie('session', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, message: '登出失败' });
  }
});

module.exports = router;
