const express = require('express');
const { createRateLimiter } = require('../middleware/rateLimit');
const nativeClient = require('../modules/nativeAuth/nativeClientService');
const tokenStore = require('../modules/oauth/tokenStore');

const router = express.Router();
const loginLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 5 * 60 * 1000, keyPrefix: 'ratelimit:native_login' });
const refreshLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:native_refresh' });
const logoutLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 60 * 1000, keyPrefix: 'ratelimit:native_logout' });
const meLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:native_me' });

function sendError(res, err) {
  if (err instanceof nativeClient.NativeClientError) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message });
  }
  if (err?.name === 'OAuthError') {
    return res.status(err.status === 400 ? 401 : err.status).json({
      success: false,
      code: err.error === 'invalid_grant' ? 'INVALID_REFRESH_TOKEN' : 'SESSION_REVOKED',
      message: '凭据无效、已过期或已撤销',
    });
  }
  console.error('[NativeClient] request failed:', err);
  return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: '认证服务暂不可用' });
}

function bearer(req) {
  const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
  return match?.[1] || null;
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const result = await nativeClient.login({
      clientId: req.body?.client_id, login: req.body?.username, password: req.body?.password,
      deviceId: req.body?.device_id, deviceName: req.body?.device_name, req,
    });
    res.json(result);
  } catch (err) { sendError(res, err); }
});

router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const result = await nativeClient.refresh({
      clientId: req.body?.client_id, refreshToken: req.body?.refresh_token, deviceId: req.body?.device_id,
    });
    res.json(result);
  } catch (err) { sendError(res, err); }
});

router.post('/logout', logoutLimiter, async (req, res) => {
  try {
    const accessToken = bearer(req);
    if (!accessToken && !req.body?.refresh_token) return res.status(401).json({ success: false, code: 'INVALID_REQUEST', message: '需要 Bearer access token 或 refresh token' });
    const token = accessToken ? await tokenStore.getAccessToken(accessToken) : null;
    const result = await nativeClient.logout({
      accessToken, userId: token?.user_id, clientId: req.body?.client_id,
      refreshToken: req.body?.refresh_token, deviceId: req.body?.device_id,
    });
    res.json(result);
  } catch (err) { sendError(res, err); }
});

router.get('/me', meLimiter, async (req, res) => {
  try {
    const accessToken = bearer(req);
    if (!accessToken) return res.status(401).json({ success: false, code: 'INVALID_REQUEST', message: '需要 Bearer access token' });
    res.json({ success: true, user: await nativeClient.me({ accessToken }) });
  } catch (err) { sendError(res, err); }
});

module.exports = router;
