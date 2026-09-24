const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool, transaction, isDuplicateError } = require('../db');
const { client } = require('../redis');
const { hashToken } = require('../utils/token');
const { isValidEmail, isValidPassword, isValidUsername, getPasswordValidationError } = require('../utils/validation');
const { getClientIp } = require('../utils/request');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter, createClientAwareRateLimiter, resetRateLimit } = require('../middleware/rateLimit');
const { maskPhone } = require('../utils/phone');
const sessionManager = require('../modules/sessions/sessionManager');
const passwordLogin = require('../modules/auth/passwordLogin');
const challengeManager = require('../modules/challenges/challengeManager');
const notificationCenter = require('../modules/notifications/notificationCenter');
const config = require('../config');

const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const loginRateLimiter = createClientAwareRateLimiter(config.rateLimit.login);
const registerRateLimiter = createRateLimiter(config.rateLimit.register);

const REGISTER_CODE_MAX_FAILURES = 5;

// ---- 服务间 API：用户名密码验证（供 MindFourm 调用）----

router.post('/service/validate-credentials', async (req, res) => {
  // 验证服务间 API Key
  const serviceApiKey = req.headers['x-service-api-key'];
  const expectedKey = process.env.SERVICE_API_KEY;

  if (!expectedKey || serviceApiKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      code: 'SERVICE_API_KEY_INVALID',
      message: 'Invalid service API key',
    });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_CREDENTIALS',
      message: 'Username and password required',
    });
  }

  try {
    // 查询用户
    const [users] = await pool.execute(
      'SELECT id, username, email, password_hash, avatar_url, phone_verified, phone_verified_at FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (!users || users.length === 0) {
      return res.status(401).json({ valid: false });
    }

    const user = users[0];

    // 验证密码
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ valid: false });
    }

    // 返回用户信息（不包含敏感字段）
    return res.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url || '',
        phone_verified: !!user.phone_verified,
        phone_verified_at: user.phone_verified_at || null,
      }
    });
  } catch (err) {
    console.error('[Service API] validate-credentials error:', err);
    return res.status(500).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
    });
  }
});

function emailKey(email) {
  return hashToken(email.toLowerCase().trim());
}

async function removeCodeFromMysql(emailHash) {
  try {
    await pool.execute('DELETE FROM registration_email_codes WHERE email_hash = ?', [emailHash]);
  } catch (err) {
    console.warn('[Register] MySQL remove failed:', err.message);
  }
}

// Register
//
// Accounts are only created after a successful email-code verification.
// The code is issued by POST /api/register/send-code and stored as
// SHA-256 in Redis (primary) + MySQL fallback. The account is inserted
// with email_verified = 1, so no post-registration verification email
// is sent.
router.post('/register', registerRateLimiter, async (req, res) => {
  const { username, email, password, email_code, challenge_id, challenge_answer } = req.body;

  if (!username || !email || !password || !email_code) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_FIELD',
      message: !email_code ? '请先获取邮箱验证码' : '所有字段必填',
    });
  }

  if (typeof email_code !== 'string' || !/^\d{6}$/.test(email_code)) {
    return res.status(400).json({
      success: false,
      code: 'EMAIL_CODE_INVALID',
      message: '验证码为 6 位数字',
    });
  }

  // Check if any challenge questions are enabled; if so, verification is mandatory
  const challengeRequired = await challengeManager.isChallengeRequired();

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
    const challengeResult = await challengeManager.verifyForRegistration(csrfToken, challenge_id, challenge_answer);
    if (!challengeResult.success) {
      const messageMap = {
        CHALLENGE_EXPIRED: '验证已过期，请刷新获取新题',
        CHALLENGE_MISMATCH: '题目不匹配',
        CHALLENGE_NOT_FOUND: '题目不存在',
        CHALLENGE_FAILED: '问答验证失败',
      };
      return res.status(400).json({
        success: false,
        code: challengeResult.code,
        message: messageMap[challengeResult.code] || '问答验证失败',
      });
    }
  } else if (challengeRequired) {
    return res.status(400).json({ success: false, code: 'CHALLENGE_REQUIRED', message: '请先完成验证问答' });
  }

  if (!isValidUsername(username)) {
    return res.status(400).json({ success: false, message: '用户名需2-50字符' });
  }

  const emailLower = String(email).toLowerCase().trim();
  if (!isValidEmail(emailLower)) {
    return res.status(400).json({ success: false, message: '邮箱格式不正确' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ success: false, message: getPasswordValidationError(password) || '密码不符合要求' });
  }

  // ── Email code verification ───────────────────────────────────
  // Look up the stored code hash by email. Check Redis first, fall back
  // to MySQL in case of a Redis restart. Compare hashes (timing-safe via
  // plain equality — hash length is fixed, and the code itself is short
  // so any leak is bounded to 6 digits with a 5-minute TTL).
  const eHash = emailKey(emailLower);
  const presentedHash = hashToken(email_code);
  let record = null;

  try {
    const redisData = await client.get(`register_email_code:${eHash}`);
    if (redisData) {
      record = JSON.parse(redisData);
    } else {
      const [rows] = await pool.execute(
        'SELECT email, code_hash FROM registration_email_codes WHERE email_hash = ? AND expires_at > NOW() LIMIT 1',
        [eHash]
      );
      if (rows[0]) {
        record = { email: rows[0].email, codeHash: rows[0].code_hash, failures: 0 };
      }
    }
  } catch (err) {
    console.error('[Register] code lookup error:', err);
    return res.status(500).json({ success: false, message: '验证码校验失败' });
  }

  if (!record) {
    return res.status(400).json({
      success: false,
      code: 'EMAIL_CODE_INVALID',
      message: '验证码无效或已过期，请重新获取',
    });
  }

  if (record.codeHash !== presentedHash) {
    // Track failures so brute-forcing a 6-digit code is bounded.
    const failures = (record.failures || 0) + 1;
    if (failures >= REGISTER_CODE_MAX_FAILURES) {
      await client.del(`register_email_code:${eHash}`).catch(() => {});
      await removeCodeFromMysql(eHash);
      return res.status(400).json({
        success: false,
        code: 'EMAIL_CODE_MAX_FAILURES',
        message: '验证码错误次数过多，请重新获取',
      });
    }
    // Persist the incremented failure count.
    try {
      const ttl = await client.ttl(`register_email_code:${eHash}`);
      if (ttl > 0) {
        await client.setEx(
          `register_email_code:${eHash}`,
          ttl,
          JSON.stringify({ ...record, failures })
        );
      }
    } catch {}
    return res.status(400).json({
      success: false,
      code: 'EMAIL_CODE_MISMATCH',
      message: '验证码不正确',
    });
  }

  // ── Code validated. Consume it and create the account. ────────
  // Delete the code BEFORE inserting the user so a concurrent retry
  // cannot reuse the same code.
  await client.del(`register_email_code:${eHash}`).catch(() => {});
  await removeCodeFromMysql(eHash);

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    await transaction(async (conn) => {
      const [userResult] = await conn.execute(
        'INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, 1)',
        [username, emailLower, passwordHash]
      );
      return userResult.insertId;
    });

    res.status(201).json({ success: true, message: '注册成功' });
  } catch (err) {
    if (isDuplicateError(err)) {
      // Generic message — do not reveal WHICH field is taken, to avoid
      // username/email enumeration (consistent with login/reset responses)
      return res.status(409).json({ success: false, message: '用户名或邮箱已被使用' });
    }
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

// Login
router.post('/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名/邮箱和密码必填' });
  }

  try {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const result = await passwordLogin.authenticatePassword({ login: username, password, ipAddress: ip, userAgent });
    if (!result.ok && result.reason === 'banned') {
      return res.status(403).json({ success: false, code: 'USER_BANNED', message: result.user.ban_reason || '账号已被封禁', ban_expires_at: result.user.ban_expires_at });
    }
    if (!result.ok && result.reason === 'locked') {
      return res.status(423).json({ success: false, code: 'ACCOUNT_LOCKED', message: `账号已锁定，请${result.retryMinutes}分钟后重试`, locked_until: result.lockedUntil, lock_level: result.user.lock_level });
    }
    if (!result.ok) return res.status(401).json({ success: false, message: '用户名/邮箱或密码错误' });

    const user = result.user;
    await resetRateLimit(ip, config.rateLimit.login.keyPrefix);
    const sessionResult = await sessionManager.createUserSession({ userId: user.id, ipAddress: ip, userAgent });
    await pool.execute(
      'INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)',
      [user.id, ip, userAgent.slice(0, 200), 'web']
    );

    try {
      const [prevLog] = await pool.execute(
        'SELECT ip FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET 1',
        [user.id]
      );
      if (prevLog.length > 0 && prevLog[0].ip !== ip) {
        await notificationCenter.create({
          user_id: user.id, type: 'login_new_device', title: '新设备登录',
          content: `检测到新设备登录，IP: ${ip}`, ip_address: ip, user_agent: userAgent, sendEmail: true,
        });
      }
    } catch (notifyErr) {
      console.warn('[Login] new device notification failed:', notifyErr.message);
    }

    res.cookie('session', sessionResult.token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: SESSION_MAX_AGE, sameSite: 'Lax', path: '/',
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
    email_verified: email_verified === 1 || email_verified === true,
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
