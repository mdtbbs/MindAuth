/**
 * OAuth route adapter — thin HTTP layer over oauthIssuer.
 *
 * This file handles only:
 *   - Parsing HTTP requests (query params, body, headers, cookies)
 *   - Calling oauthIssuer methods
 *   - Formatting HTTP responses (redirects, JSON, error codes)
 *
 * All OAuth business logic lives in src/modules/oauth/oauthIssuer.js.
 */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { getClientIp } = require('../utils/request');
const oauthIssuer = require('../modules/oauth/oauthIssuer');
const oauthMetrics = require('../modules/oauth/oauthMetrics');
const tokenStore = require('../modules/oauth/tokenStore');
const { SCOPE_DESCRIPTIONS } = require('../modules/oauth/scopes');

// Rate limiter for token verification / userinfo / user endpoints.
// These endpoints are CSRF-exempt and accept bearer tokens, so a loose
// per-IP limiter prevents brute-force token enumeration.
const verifyEndpointLimiter = createRateLimiter({
  maxAttempts: 30,
  windowMs: 60 * 1000,
  keyPrefix: 'ratelimit:verify_api'
});

// Per-IP limiters for the OAuth protocol endpoints. Credentials/codes are
// high-entropy so brute force is impractical, but these cap abuse and probing.
const authorizeLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_authorize' });
const tokenLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_token' });
const refreshLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_refresh' });
const introspectLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_introspect' });
const revokeLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_revoke' });

// Device authorization flow limiters (RFC 8628)
const deviceCodeLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_device_code' });
const deviceTokenLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_device_token' });
const deviceApproveLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 60 * 1000, keyPrefix: 'ratelimit:oauth_device_approve' });

// Standard RFC 6749 error response
function oauthError(res, statusCode, error, description) {
  res.locals.oauthErrorCode = error;
  return res.status(statusCode).json({
    error,
    error_description: description
  });
}

// Persist only bounded daily aggregates for registered clients. This records
// status/error codes, never token strings, authorization codes or request data.
router.use((req, res, next) => {
  const metered = new Set(['/authorize', '/authorize/consent', '/token', '/refresh', '/userinfo', '/introspect', '/revoke']);
  if (!metered.has(req.path)) return next();
  res.on('finish', () => {
    void (async () => {
      let clientId = req.body?.client_id || req.query?.client_id;
      if (typeof clientId !== 'string') clientId = null;
      if (!clientId && req.path === '/userinfo') {
        const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
        if (match) clientId = (await tokenStore.getAccessToken(match[1]))?.client_id || null;
      }
      if (!clientId) return;
      const location = String(res.getHeader('Location') || '');
      const isFailure = res.statusCode >= 400 || Boolean(res.locals.oauthErrorCode) || /(?:[?&])error=/.test(location);
      await oauthMetrics.record(clientId, isFailure ? res.locals.oauthErrorCode || (res.statusCode >= 500 ? 'server_error' : 'oauth_error') : null);
    })().catch((error) => console.warn('[OAuth metrics] request classification failed:', error.message));
  });
  next();
});

// Helper to handle OAuthError in route handlers
function handleOAuthError(res, err, context) {
  if (err instanceof oauthIssuer.OAuthError) {
    return oauthError(res, err.status, err.error, err.errorDescription);
  }
  console.error(`${context}:`, err);
  return oauthError(res, 500, 'server_error', '服务器错误');
}

// GET /authorize - Authorization endpoint for third-party redirect
router.get('/authorize', authorizeLimiter, async (req, res) => {
  try {
    const {
      redirect_uri, client_id, state, scope, response_type,
      code_challenge, code_challenge_method
    } = req.query;

    const sessionToken = req.cookies.session || null;
    const ipAddress = getClientIp(req);

    const result = await oauthIssuer.authorize({
      clientId: client_id,
      redirectUri: redirect_uri,
      scope,
      state,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      responseType: response_type,
      sessionToken,
      ipAddress,
    });

    if (result.loginRedirect) {
      const loginParams = new URLSearchParams({ client_id, redirect_uri, response_type: response_type || 'code' });
      if (state) loginParams.set('state', state);
      if (scope) loginParams.set('scope', scope);
      if (code_challenge) loginParams.set('code_challenge', code_challenge);
      if (code_challenge_method) loginParams.set('code_challenge_method', code_challenge_method);
      loginParams.set('client_name', result.client.name);
      return res.redirect(`/login?${loginParams.toString()}`);
    }

    if (result.consentRequired) {
      const consentParams = new URLSearchParams({ client_id, redirect_uri, response_type: response_type || 'code' });
      if (state) consentParams.set('state', state);
      if (scope) consentParams.set('scope', scope);
      if (code_challenge) consentParams.set('code_challenge', code_challenge);
      if (code_challenge_method) consentParams.set('code_challenge_method', code_challenge_method);
      return res.redirect(`/authorize?${consentParams.toString()}`);
    }

    res.redirect(result.redirectTo);
  } catch (err) {
    if (err instanceof oauthIssuer.OAuthError && err.errorPageParams) {
      const { error: e, description: d } = err.errorPageParams;
      return res.redirect(`/oauth-error.html?error=${e}&description=${encodeURIComponent(d)}`);
    }
    console.error('Authorize error:', err);
    res.redirect(`/oauth-error.html?error=server_error&description=${encodeURIComponent('授权失败')}`);
  }
});

// The browser consent page receives only display-safe client and scope data.
router.get('/authorize/consent-info', requireAuth, async (req, res) => {
  try {
    const { redirect_uri, client_id, state, scope, response_type, code_challenge, code_challenge_method } = req.query;
    const result = await oauthIssuer.authorize({
      clientId: client_id, redirectUri: redirect_uri, state, scope,
      responseType: response_type, codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method, sessionToken: req.cookies.session,
      previewOnly: true,
    });
    if (result.loginRedirect) return res.status(401).json({ success: false, message: '请先登录' });
    res.json({
      success: true,
      consent_required: result.consentRequired,
      client: result.client,
      scopes: result.requestedScopes.map((name) => ({ name, ...SCOPE_DESCRIPTIONS[name] })),
      new_scopes: (result.newScopes || []).map((name) => ({ name, ...SCOPE_DESCRIPTIONS[name] })),
      previous_scopes: result.previousScopes || [],
    });
  } catch (err) {
    handleOAuthError(res, err, 'OAuth consent preview error');
  }
});

router.post('/authorize/consent', requireAuth, async (req, res) => {
  try {
    const { decision, redirect_uri, client_id, state, scope, response_type, code_challenge, code_challenge_method } = req.body || {};
    let result;
    if (decision === 'deny') {
      result = await oauthIssuer.denyAuthorization({ clientId: client_id, redirectUri: redirect_uri, state });
    } else if (decision === 'approve') {
      result = await oauthIssuer.authorize({
        clientId: client_id, redirectUri: redirect_uri, state, scope,
        responseType: response_type, codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method, sessionToken: req.cookies.session,
        ipAddress: getClientIp(req), consentGranted: true,
      });
    } else {
      return oauthError(res, 400, 'invalid_request', '授权决定无效');
    }
    if (!result.redirectTo) return oauthError(res, 400, 'invalid_request', '授权流程尚未完成');
    res.json({ success: true, redirect_to: result.redirectTo });
  } catch (err) {
    handleOAuthError(res, err, 'OAuth consent decision error');
  }
});

// POST /token - Token exchange (third-party backend calls this)
router.post('/token', tokenLimiter, async (req, res) => {
  try {
    const { code, client_id, client_secret, grant_type, code_verifier } = req.body;
    let result;
    if (grant_type === 'authorization_code') {
      if (!code || !client_id || !req.body.redirect_uri) return oauthError(res, 400, 'invalid_request', '缺少必需参数');
      result = await oauthIssuer.exchangeCode({ code, clientId: client_id, clientSecret: client_secret,
        redirectUri: req.body.redirect_uri, codeVerifier: code_verifier });
    } else if (grant_type === 'refresh_token') {
      if (!req.body.refresh_token || !client_id) return oauthError(res, 400, 'invalid_request', '缺少必需参数');
      result = await oauthIssuer.refresh({ refreshToken: req.body.refresh_token, clientId: client_id, clientSecret: client_secret });
    } else {
      return oauthError(res, 400, 'unsupported_grant_type', '不支持的 grant_type');
    }

    res.json(result);
  } catch (err) {
    handleOAuthError(res, err, 'Token exchange error');
  }
});

// POST /refresh - Refresh access token
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const { refresh_token, client_id, client_secret, grant_type } = req.body;

    // Validate grant_type
    if (!grant_type || grant_type !== 'refresh_token') {
      return oauthError(res, 400, 'unsupported_grant_type', '不支持的 grant_type');
    }
    if (!refresh_token || !client_id) {
      return oauthError(res, 400, 'invalid_request', '缺少必需参数');
    }

    const result = await oauthIssuer.refresh({
      refreshToken: refresh_token,
      clientId: client_id,
      clientSecret: client_secret,
    });

    res.json(result);
  } catch (err) {
    handleOAuthError(res, err, 'Refresh token error');
  }
});

// POST /introspect - Token introspection endpoint (RFC 7662)
router.post('/introspect', introspectLimiter, async (req, res) => {
  try {
    const { token, client_id, client_secret } = req.body;

    if (!token) {
      return oauthError(res, 400, 'invalid_request', '缺少 token 参数');
    }
    if (!client_id || !client_secret) {
      return oauthError(res, 401, 'invalid_client', '缺少客户端认证');
    }

    const result = await oauthIssuer.introspect({
      token,
      clientId: client_id,
      clientSecret: client_secret,
    });

    res.json(result);
  } catch (err) {
    handleOAuthError(res, err, 'Introspect error');
  }
});

// GET /userinfo - UserInfo endpoint (OIDC Core)
router.get('/userinfo', verifyEndpointLimiter, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return oauthError(res, 401, 'invalid_token', '缺少或无效的 Authorization header');
    }

    const accessToken = authHeader.substring(7);
    const claims = await oauthIssuer.userinfo(accessToken);
    res.json(claims);
  } catch (err) {
    handleOAuthError(res, err, 'UserInfo error');
  }
});

// GET /user - Compatibility endpoint used by older MindFourm builds.
router.get('/user', verifyEndpointLimiter, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return oauthError(res, 401, 'invalid_token', '缺少或无效的 Authorization header');
    }

    const accessToken = authHeader.substring(7);
    const userData = await oauthIssuer.userByAccessToken(accessToken);
    res.json(userData);
  } catch (err) {
    handleOAuthError(res, err, 'User compatibility endpoint error');
  }
});

// POST /revoke - Token revocation endpoint (RFC 7009)
router.post('/revoke', revokeLimiter, async (req, res) => {
  try {
    const { token, token_type_hint, client_id, client_secret } = req.body;

    if (!token) {
      return oauthError(res, 400, 'invalid_request', '缺少 token 参数');
    }
    await oauthIssuer.revoke({
      token,
      tokenTypeHint: token_type_hint,
      clientId: client_id,
      clientSecret: client_secret,
    });

    res.json({ success: true });
  } catch (err) {
    handleOAuthError(res, err, 'Revoke error');
  }
});

// GET /authorizations - Get user's authorized apps
router.get('/authorizations', requireAuth, async (req, res) => {
  try {
    const authorizations = await oauthIssuer.listAuthorizations(req.user.id);
    res.json({ success: true, authorizations });
  } catch (err) {
    console.error('Get authorizations error:', err);
    res.status(500).json({ success: false, message: '获取授权列表失败' });
  }
});

// DELETE /authorizations/:client_id - Revoke authorization
router.delete('/authorizations/:client_id', requireAuth, async (req, res) => {
  try {
    const { client_id } = req.params;
    const result = await oauthIssuer.revokeAuthorization({
      userId: req.user.id,
      clientId: client_id,
    });

    if (!result.revoked) {
      return res.status(404).json({ success: false, message: '授权不存在' });
    }

    res.json({ success: true, message: '授权已撤销' });
  } catch (err) {
    console.error('Revoke authorization error:', err);
    res.status(500).json({ success: false, message: '撤销授权失败' });
  }
});

// POST /verify - Session token verification (for same-domain scenarios)
router.post('/verify', verifyEndpointLimiter, async (req, res) => {
  try {
    const { session_token } = req.body;

    if (!session_token) {
      return oauthError(res, 400, 'invalid_request', '缺少 session_token');
    }

    const result = await oauthIssuer.verify(session_token);
    res.json(result);
  } catch (err) {
    handleOAuthError(res, err, 'Verify error');
  }
});

// ─── Device Authorization Flow (RFC 8628) ─────────────────────

// POST /device/code - Issue device and user codes
router.post('/device/code', deviceCodeLimiter, async (req, res) => {
  try {
    const { client_id, scope } = req.body;

    if (!client_id) {
      return oauthError(res, 400, 'invalid_request', '缺少 client_id');
    }

    const result = await oauthIssuer.issueDeviceCode({
      clientId: client_id,
      scope,
    });

    res.json({
      device_code: result.deviceCode,
      user_code: result.userCode,
      verification_uri: result.verificationUri,
      verification_uri_complete: result.verificationUriComplete,
      expires_in: result.expiresIn,
      interval: result.interval,
    });
  } catch (err) {
    handleOAuthError(res, err, 'Device code issuance error');
  }
});

// Legacy verification links now open the React Identity page.
router.get('/device/verify', (req, res) => {
  const userCode = typeof req.query.user_code === 'string' ? req.query.user_code : '';
  res.redirect(`/device${userCode ? `?user_code=${encodeURIComponent(userCode)}` : ''}`);
});

router.get('/device/info', requireAuth, async (req, res) => {
  try {
    const userCode = typeof req.query.user_code === 'string' ? req.query.user_code.trim().toUpperCase() : '';
    if (!userCode) return res.status(400).json({ success: false, message: '请输入设备页面显示的用户码。' });
    const deviceData = await oauthIssuer.getDeviceCodeByUserCode({ userCode });
    if (!deviceData) return res.status(404).json({ success: false, message: '用户码无效或已过期，请返回设备重新获取。' });
    const client = await oauthIssuer.lookupClient(deviceData.client_id);
    res.json({
      success: true,
      user_code: userCode,
      client: {
        name: client.name,
        client_id: client.client_id,
        client_type: client.client_type,
        party_type: client.party_type,
      },
      scopes: String(deviceData.scope || '').split(/\s+/).filter(Boolean)
        .map(name => ({ name, ...(SCOPE_DESCRIPTIONS[name] || { name, description: '此权限由应用请求。' }) })),
    });
  } catch (err) {
    handleOAuthError(res, err, 'Device verification preview error');
  }
});

// POST /device/approve - Approve or deny device authorization
router.post('/device/approve', requireAuth, deviceApproveLimiter, async (req, res) => {
  try {
    const { user_code, action } = req.body;

    if (!user_code || !action) return res.status(400).json({ success: false, message: '缺少用户码或操作。' });

    let success = false;
    let message = '';

    if (action === 'approve') {
      success = await oauthIssuer.approveDeviceCode({
        userCode: user_code,
        userId: req.user.id,
      });
      message = success ? '授权成功！请返回设备继续操作。' : '授权失败，用户码无效或已过期。';
    } else if (action === 'deny') {
      success = await oauthIssuer.denyDeviceCode({ userCode: user_code });
      message = success ? '已拒绝授权。' : '操作失败，用户码无效或已过期。';
    } else {
      return res.status(400).json({ success: false, message: '操作必须是 approve 或 deny。' });
    }

    if (!success) return res.status(404).json({ success: false, message: '用户码无效或已过期。' });
    res.json({ success: true, approved: action === 'approve', message });
  } catch (err) {
    console.error('Device approve error:', err);
    res.status(500).json({ success: false, message: '提交设备授权失败，请稍后重试。' });
  }
});

// POST /device/token - Exchange device code for tokens
router.post('/device/token', deviceTokenLimiter, async (req, res) => {
  try {
    const { client_id, device_code, grant_type } = req.body;

    // Validate grant_type
    if (!grant_type || grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') {
      return oauthError(res, 400, 'unsupported_grant_type', '不支持的 grant_type');
    }

    if (!client_id || !device_code) {
      return oauthError(res, 400, 'invalid_request', '缺少必需参数');
    }

    const result = await oauthIssuer.exchangeDeviceToken({
      clientId: client_id,
      deviceCode: device_code,
    });

    res.json(result);
  } catch (err) {
    handleOAuthError(res, err, 'Device token exchange error');
  }
});

module.exports = router;
