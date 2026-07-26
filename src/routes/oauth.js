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

// Standard RFC 6749 error response
function oauthError(res, statusCode, error, description) {
  return res.status(statusCode).json({
    error,
    error_description: description
  });
}

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
      // User not logged in — redirect to login with OAuth params
      const clientData = result.client;
      const encodedClientName = encodeURIComponent(clientData.name);
      return res.redirect(
        `/#/login?redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&client_id=${client_id}` +
        `&client_name=${encodedClientName}` +
        `${state ? '&state=' + encodeURIComponent(state) : ''}` +
        `${scope ? '&scope=' + encodeURIComponent(scope) : ''}` +
        `${code_challenge ? '&code_challenge=' + encodeURIComponent(code_challenge) : ''}` +
        `${code_challenge_method ? '&code_challenge_method=' + encodeURIComponent(code_challenge_method) : ''}`
      );
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

// POST /token - Token exchange (third-party backend calls this)
router.post('/token', tokenLimiter, async (req, res) => {
  try {
    const { code, client_id, client_secret, grant_type, code_verifier } = req.body;

    // Validate grant_type
    if (!grant_type || grant_type !== 'authorization_code') {
      return oauthError(res, 400, 'unsupported_grant_type', '不支持的 grant_type');
    }
    if (!code || !client_id || !client_secret) {
      return oauthError(res, 400, 'invalid_request', '缺少必需参数');
    }

    const result = await oauthIssuer.exchangeCode({
      code,
      clientId: client_id,
      clientSecret: client_secret,
      codeVerifier: code_verifier,
    });

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
    if (!refresh_token || !client_id || !client_secret) {
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
    if (!client_id || !client_secret) {
      return oauthError(res, 401, 'invalid_client', '缺少客户端认证');
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

module.exports = router;
