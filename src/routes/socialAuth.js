const express = require('express');
const bcrypt = require('bcrypt');

const config = require('../config');
const qq = require('../modules/social/qqProvider');
const stateManager = require('../modules/social/stateManager');
const socialLogin = require('../modules/social/socialLogin');
const { getClientIp } = require('../utils/request');
const { client } = require('../redis');
const { pool, transaction } = require('../db');
const { hashToken } = require('../utils/token');
const { isValidEmail, isValidPassword, isValidUsername } = require('../utils/validation');
const sessionManager = require('../modules/sessions/sessionManager');
const clientRegistry = require('../modules/admin/clientRegistry');
const { logUserAudit } = require('../utils/userAudit');

const router = express.Router();
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};

// ===== 辅助函数 =====

/**
 * 验证 OAuth authorize context
 * 只允许经过验证的 client_id 和 redirect_uri
 */
async function validateAuthorizeContext(query) {
  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  const state = query.state;
  const scope = query.scope;
  const codeChallenge = query.code_challenge;
  const codeChallengeMethod = query.code_challenge_method;

  // 如果没有 OAuth 参数，返回空
  if (!clientId && !redirectUri && !state && !scope && !codeChallenge && !codeChallengeMethod) {
    return null;
  }

  // 如果有 OAuth 参数，client_id 和 redirect_uri 必须都存在
  if (!clientId || !redirectUri) {
    throw new Error('INVALID_OAUTH_CONTEXT');
  }

  // 验证 client_id
  const oauthClient = await clientRegistry.getClient(clientId);
  if (!oauthClient) {
    throw new Error('INVALID_OAUTH_CONTEXT');
  }

  // 验证 redirect_uri 精确匹配
  const registeredRedirectUris = oauthClient.redirect_uri.split('\n').map((uri) => uri.trim());
  if (!registeredRedirectUris.includes(redirectUri)) {
    throw new Error('INVALID_OAUTH_CONTEXT');
  }

  // 验证 scope（如果提供）
  if (scope) {
    const allowedScopes = new Set(['openid', 'profile', 'email']);
    const requestedScopes = scope.split(' ');
    for (const s of requestedScopes) {
      if (!allowedScopes.has(s)) {
        throw new Error('INVALID_OAUTH_CONTEXT');
      }
    }
  }

  // 验证 PKCE（如果提供）
  if (codeChallenge || codeChallengeMethod) {
    if (codeChallengeMethod !== 'S256') {
      throw new Error('INVALID_OAUTH_CONTEXT');
    }
    if (!codeChallenge || codeChallenge.length < 43 || codeChallenge.length > 128) {
      throw new Error('INVALID_OAUTH_CONTEXT');
    }
  }

  return {
    clientId,
    redirectUri,
    state: state ? String(state).slice(0, 255) : undefined,
    scope: scope ? String(scope).slice(0, 255) : undefined,
    codeChallenge: codeChallenge ? String(codeChallenge).slice(0, 128) : undefined,
    codeChallengeMethod: codeChallengeMethod ? String(codeChallengeMethod).slice(0, 32) : undefined,
  };
}

/**
 * 构建成功后的重定向 URL
 * 如果有 OAuth context，恢复到 /api/authorize
 */
function buildSuccessRedirect(authorize) {
  if (!authorize) return '/dashboard';

  const params = new URLSearchParams({
    client_id: authorize.clientId,
    redirect_uri: authorize.redirectUri,
    response_type: 'code',
  });

  if (authorize.state) params.set('state', authorize.state);
  if (authorize.scope) params.set('scope', authorize.scope);
  if (authorize.codeChallenge) params.set('code_challenge', authorize.codeChallenge);
  if (authorize.codeChallengeMethod) params.set('code_challenge_method', authorize.codeChallengeMethod);

  return `/api/authorize?${params.toString()}`;
}

// ===== 路由 =====

/**
 * GET /qq - 启动 QQ 授权
 */
router.get('/qq', async (req, res) => {
  if (!config.qq.enabled) {
    return res.status(404).json({ success: false, message: 'QQ 登录未启用' });
  }

  try {
    // 验证 intent
    const intent = req.query.intent === 'bind' ? 'bind' : 'login';

    // bind 需要当前 session
    if (intent === 'bind') {
      const sessionToken = req.cookies.session;
      if (!sessionToken) {
        return res.status(401).json({ success: false, message: '请先登录' });
      }
      const session = await sessionManager.authenticateUserSession(sessionToken);
      if (!session) {
        return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
      }

      // 创建 bind state
      const state = await stateManager.createState({
        provider: 'qq',
        intent: 'bind',
        sessionToken,
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] || '',
      });
      return res.redirect(qq.getAuthorizationUrl(state));
    }

    // login 流程：验证 OAuth context（如果有）
    let authorize;
    try {
      authorize = await validateAuthorizeContext(req.query);
    } catch {
      // OAuth context 无效，忽略并继续普通登录
      authorize = null;
    }

    const state = await stateManager.createState({
      provider: 'qq',
      intent: 'login',
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      authorize: authorize,
    });

    return res.redirect(qq.getAuthorizationUrl(state));
  } catch (err) {
    console.error('[QQ OAuth] authorize failed:', err.message);
    return res.status(503).json({ success: false, message: 'QQ 登录暂不可用' });
  }
});

/**
 * GET /qq/callback - QQ 回调
 */
router.get('/qq/callback', async (req, res) => {
  const { code, state: stateParam, error: qqError, error_description } = req.query;

  // QQ 返回错误
  if (qqError) {
    console.error('[QQ OAuth] provider error:', qqError, error_description);
    return res.redirect('/login?error=qq_login_failed&message=' + encodeURIComponent('QQ 登录失败'));
  }

  // 验证 QQ 启用
  if (!config.qq.enabled) {
    return res.status(404).json({ success: false, message: 'QQ 登录未启用' });
  }

  // 验证 code 和 state
  if (!code || !stateParam) {
    return res.status(400).json({ success: false, code: 'INVALID_CALLBACK', message: '缺少授权参数' });
  }

  try {
    // 消费 state（原子删除）
    const saved = await stateManager.consumeState(stateParam);
    if (!saved) {
      return res.status(400).json({ success: false, code: 'INVALID_STATE', message: '授权状态无效或已过期' });
    }

    // 交换 code 获取 token
    const token = await qq.exchangeCode(code);
    const openid = await qq.getOpenId(token.access_token);
    const profile = await qq.getProfile(token.access_token, openid);
    const avatarUrl = profile.figureurl_qq_2 || profile.figureurl_qq_1 || null;

    // 根据 intent 分流
    if (saved.intent === 'bind') {
      // 验证当前 session
      const currentSessionToken = req.cookies.session;
      if (!currentSessionToken || !saved.sessionHash || !stateManager.compareSessionHash(saved.sessionHash, currentSessionToken)) {
        return res.redirect('/account-settings?error=session_expired');
      }
      const session = await sessionManager.authenticateUserSession(currentSessionToken);
      if (!session) {
        return res.redirect('/account-settings?error=session_expired');
      }

      // 绑定 QQ
      try {
        await socialLogin.bindQq(session.user.id, { openid, nickname: profile.nickname, avatarUrl });

        logUserAudit({
          user_id: session.user.id,
          action: 'social_bind',
          ip_address: getClientIp(req),
          user_agent: req.headers['user-agent'] || '',
          details: { provider: 'qq' },
        });

        return res.redirect('/account-settings?social=qq_bound');
      } catch (err) {
        if (err.code === 'QQ_ALREADY_BOUND_TO_OTHER') {
          return res.redirect('/account-settings?error=qq_already_bound');
        }
        throw err;
      }
    }

    // login 流程：检查是否已有绑定
    const result = await socialLogin.loginExisting({
      openid,
      nickname: profile.nickname,
      avatarUrl,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });

    if (result) {
      // 已有绑定，创建 session
      res.cookie('session', result.session.token, cookieOptions);
      return res.redirect(buildSuccessRedirect(saved.authorize));
    }

    // 未绑定，创建 register pending state
    const pendingState = await stateManager.createState({
      provider: 'qq',
      intent: 'register',
      openid,
      nickname: profile.nickname,
      avatarUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      authorize: saved.authorize,
    });

    return res.redirect('/qq-register?state=' + encodeURIComponent(pendingState));
  } catch (err) {
    // 封禁/锁定检查
    if (err.code === 'USER_BANNED' || err.code === 'ACCOUNT_LOCKED') {
      return res.redirect('/login?error=' + encodeURIComponent(err.code) + '&message=' + encodeURIComponent(err.message));
    }

    console.error('[QQ OAuth] callback failed:', err.message);
    return res.redirect('/login?error=qq_login_failed&message=' + encodeURIComponent('QQ 登录失败'));
  }
});

/**
 * POST /qq/complete - 注册完成
 */
router.post('/qq/complete', async (req, res) => {
  try {
    const { state, username, email, email_code: emailCode, password } = req.body;

    // 验证必填字段
    if (!state || !username || !email || !emailCode || !password) {
      return res.status(400).json({ success: false, code: 'MISSING_FIELDS', message: '请填写所有字段' });
    }

    // 消费 state
    const pending = await stateManager.consumeState(state);
    if (!pending || pending.intent !== 'register') {
      return res.status(400).json({ success: false, code: 'INVALID_STATE', message: '注册状态无效或已过期' });
    }

    // 验证字段格式
    if (!isValidUsername(username) || !isValidEmail(email) || !isValidPassword(password)) {
      return res.status(400).json({ success: false, code: 'INVALID_FIELDS', message: '用户名、邮箱或密码格式不正确' });
    }

    if (!/^\d{6}$/.test(String(emailCode))) {
      return res.status(400).json({ success: false, code: 'INVALID_EMAIL_CODE', message: '邮箱验证码格式不正确' });
    }

    // 验证邮箱验证码
    const emailLower = email.toLowerCase().trim();
    const emailHash = hashToken(emailLower);
    const codeKey = `register_email_code:${emailHash}`;

    // 从 Redis 读取
    let codePayload = null;
    try {
      const payloadRaw = await client.get(codeKey);
      codePayload = payloadRaw ? JSON.parse(payloadRaw) : null;
    } catch {
      codePayload = null;
    }

    // 如果 Redis 没有，尝试 MySQL fallback
    if (!codePayload) {
      try {
        const [mysqlRows] = await pool.execute(
          'SELECT email, code_hash, expires_at FROM registration_email_codes WHERE email_hash = ? LIMIT 1',
          [emailHash]
        );
        if (mysqlRows.length > 0) {
          const row = mysqlRows[0];
          const expiresAt = new Date(row.expires_at);
          if (expiresAt > new Date()) {
            codePayload = {
              email: row.email,
              codeHash: row.code_hash,
            };
            // 恢复到 Redis
            const ttl = Math.ceil((expiresAt - new Date()) / 1000);
            await client.setEx(codeKey, ttl, JSON.stringify(codePayload));
          }
        }
      } catch (mysqlErr) {
        console.warn('[QQ OAuth] MySQL fallback failed:', mysqlErr.message);
      }
    }

    if (!codePayload || codePayload.email !== emailLower) {
      return res.status(400).json({ success: false, code: 'EMAIL_CODE_INVALID', message: '邮箱验证码无效或已过期' });
    }

    // 比较验证码 hash
    if (codePayload.codeHash !== hashToken(String(emailCode))) {
      // 记录失败次数
      if (codePayload.failures !== undefined) {
        codePayload.failures += 1;
        const ttl = await client.ttl(codeKey);
        if (ttl > 0) {
          await client.setEx(codeKey, ttl, JSON.stringify(codePayload));
        }
        if (codePayload.failures >= 5) {
          await client.del(codeKey).catch(() => {});
          return res.status(429).json({ success: false, code: 'EMAIL_CODE_EXHAUSTED', message: '验证码错误次数过多，请重新获取' });
        }
      }
      return res.status(400).json({ success: false, code: 'EMAIL_CODE_INVALID', message: '邮箱验证码错误' });
    }

    // 验证码正确，消费（删除）
    await client.del(codeKey).catch(() => {});
    try {
      await pool.execute('DELETE FROM registration_email_codes WHERE email_hash = ?', [emailHash]);
    } catch {}

    // 创建用户
    const passwordHash = await bcrypt.hash(password, 12);

    const userId = await transaction(async (conn) => {
      const [result] = await conn.execute(
        'INSERT INTO users (username, email, password_hash, email_verified, avatar_url) VALUES (?, ?, ?, 1, ?)',
        [username.trim(), emailLower, passwordHash, pending.avatarUrl || null]
      );
      const newUserId = result.insertId;

      // 写入社交绑定
      await conn.execute(
        'INSERT INTO social_accounts (user_id, provider, provider_user_id, nickname, avatar_url) VALUES (?, ?, ?, ?, ?)',
        [newUserId, 'qq', pending.openid, pending.nickname || null, pending.avatarUrl || null]
      );

      return newUserId;
    });

    // 创建 session
    const session = await sessionManager.createUserSession({
      userId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });

    // 记录登录日志
    await pool.execute(
      'INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)',
      [userId, getClientIp(req) || '', (req.headers['user-agent'] || '').slice(0, 200), 'social']
    );

    // 审计日志
    logUserAudit({
      user_id: userId,
      action: 'social_register',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'] || '',
      details: { provider: 'qq' },
    });

    res.cookie('session', session.token, cookieOptions);
    return res.status(201).json({
      success: true,
      redirect: buildSuccessRedirect(pending.authorize),
    });
  } catch (err) {
    // 处理唯一约束冲突
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, code: 'DUPLICATE', message: '用户名、邮箱或 QQ 已被使用' });
    }

    console.error('[QQ OAuth] registration failed:', err.message);
    return res.status(500).json({ success: false, message: '注册失败' });
  }
});

module.exports = router;
