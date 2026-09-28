const express = require('express');
const bcrypt = require('bcrypt');

const providers = require('../modules/social/providerRegistry');
const stateManager = require('../modules/social/stateManager');
const socialLogin = require('../modules/social/socialLogin');
const sessionManager = require('../modules/sessions/sessionManager');
const clientRegistry = require('../modules/admin/clientRegistry');
const { getClientIp } = require('../utils/request');
const { client } = require('../redis');
const { pool, transaction } = require('../db');
const { hashToken } = require('../utils/token');
const { isValidEmail, isValidPassword, isValidUsername } = require('../utils/validation');
const emailPolicy = require('../modules/emailPolicy/emailPolicyService');
const { logUserAudit } = require('../utils/userAudit');
const challengeManager = require('../modules/challenges/challengeManager');
const { createRateLimiter } = require('../middleware/rateLimit');
const config = require('../config');
const { VALID_SCOPES } = require('../modules/oauth/scopes');

const router = express.Router();
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};
const socialRegisterRateLimiter = createRateLimiter({
  ...config.rateLimit.register,
  keyPrefix: 'ratelimit:social_register',
});
const socialStartRateLimiter = createRateLimiter({
  maxAttempts: 30,
  windowMs: 60 * 1000,
  keyPrefix: 'ratelimit:social_oauth_start',
});

function validateProvider(value) {
  return value === 'github' || value === 'discord' ? value : null;
}

async function validateAuthorizeContext(query) {
  const hasOAuthContext = ['client_id', 'redirect_uri', 'state', 'scope', 'code_challenge', 'code_challenge_method']
    .some((key) => query[key] !== undefined);
  if (!hasOAuthContext) return null;

  const clientId = query.client_id;
  const redirectUri = query.redirect_uri;
  if (typeof clientId !== 'string' || typeof redirectUri !== 'string' || !clientId || !redirectUri
    || clientId.length > 255 || redirectUri.length > 2048) throw new Error('INVALID_OAUTH_CONTEXT');
  const oauthClient = await clientRegistry.getClient(clientId);
  const redirects = oauthClient?.redirect_uris?.map((item) => typeof item === 'string' ? item : item.redirect_uri)
    || String(oauthClient?.redirect_uri || '').split('\n').map((uri) => uri.trim());
  if (!oauthClient || !redirects.includes(redirectUri)) {
    throw new Error('INVALID_OAUTH_CONTEXT');
  }
  if (query.scope !== undefined && typeof query.scope !== 'string') throw new Error('INVALID_OAUTH_CONTEXT');
  const scopes = typeof query.scope === 'string' ? query.scope.trim().split(/\s+/).filter(Boolean) : [];
  if (scopes.length > 0 && (query.scope.length > 255 || scopes.some((scope) => !VALID_SCOPES.includes(scope)
    || !(oauthClient.approved_scopes || []).includes(scope)))) throw new Error('INVALID_OAUTH_CONTEXT');
  if (query.state !== undefined && (typeof query.state !== 'string' || query.state.length > 255)) throw new Error('INVALID_OAUTH_CONTEXT');
  if (query.ui_locales !== undefined && (typeof query.ui_locales !== 'string' || query.ui_locales.length > 128)) throw new Error('INVALID_OAUTH_CONTEXT');
  const codeChallenge = query.code_challenge;
  const codeChallengeMethod = query.code_challenge_method;
  if ((codeChallenge || codeChallengeMethod)
    && (codeChallengeMethod !== 'S256' || typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge))) {
    throw new Error('INVALID_OAUTH_CONTEXT');
  }
  return {
    clientId,
    redirectUri,
    state: typeof query.state === 'string' ? query.state : undefined,
    scope: typeof query.scope === 'string' ? query.scope : undefined,
    codeChallenge: typeof codeChallenge === 'string' ? codeChallenge : undefined,
    codeChallengeMethod: typeof codeChallengeMethod === 'string' ? codeChallengeMethod : undefined,
    uiLocales: typeof query.ui_locales === 'string' ? query.ui_locales : undefined,
  };
}

function buildSuccessRedirect(authorize) {
  if (!authorize) return '/dashboard';
  const params = new URLSearchParams({ client_id: authorize.clientId, redirect_uri: authorize.redirectUri, response_type: 'code' });
  for (const key of ['state', 'scope', 'codeChallenge', 'codeChallengeMethod', 'uiLocales']) {
    if (!authorize[key]) continue;
    const queryKey = ({ codeChallenge: 'code_challenge', codeChallengeMethod: 'code_challenge_method', uiLocales: 'ui_locales' })[key] || key;
    params.set(queryKey, authorize[key]);
  }
  return `/api/authorize?${params.toString()}`;
}

router.get('/providers', (_req, res) => {
  const enabled = providers.listEnabled();
  if (config.qq.enabled && config.qq.clientId && config.qq.clientSecret && config.qq.redirectUri) enabled.unshift('qq');
  return res.json({ success: true, providers: enabled });
});

router.get('/:provider/callback', async (req, res) => {
  const providerName = validateProvider(req.params.provider);
  if (!providerName) return res.status(404).json({ success: false, code: 'SOCIAL_PROVIDER_UNAVAILABLE' });
  const state = req.query.state;
  if (req.query.error) {
    if (typeof state === 'string') await stateManager.consumeState(state).catch(() => null);
    return res.redirect('/login?error=social_login_failed');
  }
  if (typeof req.query.code !== 'string' || typeof state !== 'string') {
    return res.redirect('/login?error=social_login_failed');
  }

  try {
    const saved = await stateManager.consumeState(state);
    if (!saved || saved.provider !== providerName || !['login', 'bind'].includes(saved.intent)) {
      return res.redirect('/login?error=social_login_failed');
    }
    const adapter = providers.get(providerName);
    const accessToken = await adapter.exchangeCode(req.query.code);
    const profile = await adapter.getProfile(accessToken);

    if (saved.intent === 'bind') {
      const sessionToken = req.cookies.session;
      if (!sessionToken || !saved.sessionHash || !stateManager.compareSessionHash(saved.sessionHash, sessionToken)) {
        return res.redirect('/security?error=session_expired');
      }
      const session = await sessionManager.authenticateUserSession(sessionToken);
      if (!session) return res.redirect('/security?error=session_expired');
      try {
        await socialLogin.bindProvider(session.user.id, { provider: providerName, ...profile });
      } catch (error) {
        if (error.code === 'SOCIAL_ALREADY_BOUND_TO_OTHER') return res.redirect(`/security?error=${providerName}_already_bound`);
        throw error;
      }
      logUserAudit({
        user_id: session.user.id,
        action: 'social_bind',
        ip_address: getClientIp(req),
        user_agent: req.headers['user-agent'] || '',
        details: { provider: providerName },
      });
      return res.redirect(`/security?social=${providerName}_bound`);
    }

    const result = await socialLogin.loginProvider({
      provider: providerName,
      ...profile,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });
    if (result) {
      res.cookie('session', result.session.token, COOKIE_OPTIONS);
      return res.redirect(buildSuccessRedirect(saved.authorize));
    }

    const pendingState = await stateManager.createState({
      provider: providerName,
      intent: 'register',
      providerUserId: profile.providerUserId,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      authorize: saved.authorize,
    });
    const registerParams = new URLSearchParams({ provider: providerName, state: pendingState });
    if (saved.authorize?.uiLocales) registerParams.set('ui_locales', saved.authorize.uiLocales);
    return res.redirect(`/social-register?${registerParams.toString()}`);
  } catch (error) {
    if (error.code === 'USER_BANNED' || error.code === 'ACCOUNT_LOCKED') {
      return res.redirect(`/login?error=${encodeURIComponent(error.code)}`);
    }
    console.error(`[Social OAuth] ${providerName} callback failed:`, error.message);
    return res.redirect('/login?error=social_login_failed');
  }
});

router.get('/:provider', socialStartRateLimiter, async (req, res) => {
  const providerName = validateProvider(req.params.provider);
  if (!providerName || !providers.isEnabled(providerName)) {
    return res.status(404).json({ success: false, code: 'SOCIAL_PROVIDER_UNAVAILABLE' });
  }
  try {
    const intent = req.query.intent === 'bind' ? 'bind' : 'login';
    let sessionToken;
    if (intent === 'bind') {
      sessionToken = req.cookies.session;
      if (!sessionToken || !await sessionManager.authenticateUserSession(sessionToken)) {
        return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });
      }
    }
    let authorize = null;
    if (intent === 'login') {
      authorize = await validateAuthorizeContext(req.query);
    }
    const state = await stateManager.createState({
      provider: providerName,
      intent,
      sessionToken,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
      authorize,
    });
    return res.redirect(providers.get(providerName).getAuthorizationUrl(state));
  } catch (error) {
    console.error(`[Social OAuth] ${providerName} authorize failed:`, error.message);
    if (error.message === 'INVALID_OAUTH_CONTEXT') return res.status(400).json({ success: false, code: 'INVALID_OAUTH_CONTEXT' });
    return res.status(503).json({ success: false, code: 'SOCIAL_PROVIDER_UNAVAILABLE' });
  }
});

router.post('/complete', socialRegisterRateLimiter, async (req, res) => {
  try {
    const { state, username, email, email_code: emailCode, password, challenge_id: challengeId, challenge_answer: challengeAnswer } = req.body;
    if (!state || !username || !email || !emailCode || !password) {
      return res.status(400).json({ success: false, code: 'MISSING_FIELDS' });
    }
    if (!isValidUsername(username) || !isValidEmail(email) || !isValidPassword(password)) {
      return res.status(400).json({ success: false, code: 'INVALID_FIELDS' });
    }
    const challengeRequired = await challengeManager.isChallengeRequired();
    if (challengeRequired && !challengeId) return res.status(400).json({ success: false, code: 'CHALLENGE_REQUIRED' });
    if (challengeId) {
      const csrfToken = req.cookies.csrf_token || 'anonymous';
      const result = await challengeManager.verifyForRegistration(csrfToken, challengeId, challengeAnswer);
      if (!result.success) return res.status(400).json({ success: false, code: result.code || 'CHALLENGE_FAILED' });
    }
    const emailDecision = await emailPolicy.checkEmail(email, { purpose: 'register', ipAddress: getClientIp(req) });
    if (!emailDecision.allowed) return res.status(400).json({ success: false, code: 'EMAIL_DOMAIN_BLOCKED' });
    if (!/^\d{6}$/.test(String(emailCode))) return res.status(400).json({ success: false, code: 'INVALID_EMAIL_CODE' });

    const emailLower = email.toLowerCase().trim();
    const emailHash = hashToken(emailLower);
    const codeKey = `register_email_code:${emailHash}`;
    let codePayload = null;
    try {
      const payloadRaw = await client.get(codeKey);
      codePayload = payloadRaw ? JSON.parse(payloadRaw) : null;
    } catch { codePayload = null; }
    if (!codePayload) {
      try {
        const [rows] = await pool.execute('SELECT email, code_hash, expires_at FROM registration_email_codes WHERE email_hash = ? LIMIT 1', [emailHash]);
        const row = rows[0];
        if (row && new Date(row.expires_at) > new Date()) {
          codePayload = { email: row.email, codeHash: row.code_hash };
          await client.setEx(codeKey, Math.ceil((new Date(row.expires_at) - new Date()) / 1000), JSON.stringify(codePayload));
        }
      } catch { /* The Redis code remains authoritative when the fallback is unavailable. */ }
    }
    if (!codePayload || codePayload.email !== emailLower) return res.status(400).json({ success: false, code: 'EMAIL_CODE_INVALID' });
    if (codePayload.codeHash !== hashToken(String(emailCode))) {
      if (codePayload.failures !== undefined) {
        codePayload.failures += 1;
        const ttl = await client.ttl(codeKey);
        if (ttl > 0) await client.setEx(codeKey, ttl, JSON.stringify(codePayload));
        if (codePayload.failures >= 5) {
          await client.del(codeKey).catch(() => {});
          return res.status(429).json({ success: false, code: 'EMAIL_CODE_EXHAUSTED' });
        }
      }
      return res.status(400).json({ success: false, code: 'EMAIL_CODE_INVALID' });
    }

    const pending = await stateManager.consumeState(state);
    if (!pending || pending.intent !== 'register' || !validateProvider(pending.provider)
      || !pending.providerUserId || !providers.isEnabled(pending.provider)) {
      return res.status(400).json({ success: false, code: 'INVALID_STATE' });
    }

    await client.del(codeKey).catch(() => {});
    await pool.execute('DELETE FROM registration_email_codes WHERE email_hash = ?', [emailHash]).catch(() => {});
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = await transaction(async (conn) => {
      const [result] = await conn.execute(
        'INSERT INTO users (username, email, password_hash, email_verified, avatar_url) VALUES (?, ?, ?, 1, ?)',
        [username.trim(), emailLower, passwordHash, pending.avatarUrl || null]
      );
      await conn.execute(
        'INSERT INTO social_accounts (user_id, provider, provider_user_id, nickname, avatar_url) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, pending.provider, pending.providerUserId, pending.nickname || null, pending.avatarUrl || null]
      );
      return result.insertId;
    });
    const session = await sessionManager.createUserSession({ userId, ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] || '' });
    await pool.execute('INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)', [
      userId, getClientIp(req) || '', (req.headers['user-agent'] || '').slice(0, 200), 'social',
    ]);
    logUserAudit({
      user_id: userId,
      action: 'social_register',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'] || '',
      details: { provider: pending.provider },
    });
    res.cookie('session', session.token, COOKIE_OPTIONS);
    return res.status(201).json({ success: true, redirect: buildSuccessRedirect(pending.authorize) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, code: 'DUPLICATE' });
    console.error('[Social OAuth] registration failed:', error.message);
    return res.status(500).json({ success: false, code: 'SOCIAL_REGISTRATION_FAILED' });
  }
});

module.exports = router;
