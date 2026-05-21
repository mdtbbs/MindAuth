const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateShortToken, generateToken } = require('../utils/token');
const requireAuth = require('../middleware/requireAuth');

const ACCESS_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

// RFC6749 标准错误响应
function oauthError(res, statusCode, error, description) {
  return res.status(statusCode).json({
    error,
    error_description: description
  });
}

// GET /authorize - Authorization endpoint for third-party redirect
router.get('/authorize', (req, res) => {
  try {
    const { redirect_uri, client_id, state, scope } = req.query;

    if (!redirect_uri || !client_id) {
      return res.redirect(`/oauth-error.html?error=invalid_request&description=${encodeURIComponent('缺少必需参数')}`);
    }

    // Verify client exists
    const client = db.prepare('SELECT * FROM clients WHERE client_id = ?').get(client_id);
    if (!client) {
      return res.redirect(`/oauth-error.html?error=invalid_client&description=${encodeURIComponent('无效的 client_id')}`);
    }

    // Verify redirect_uri matches
    if (client.redirect_uri !== redirect_uri) {
      return res.redirect(`/oauth-error.html?error=invalid_redirect&description=${encodeURIComponent('redirect_uri 不匹配')}`);
    }

    // Check if user is logged in
    const token = req.cookies.session;
    const user = token ? db.prepare('SELECT id, username, email FROM users WHERE session_token = ?').get(token) : null;

    if (!user) {
      // Not logged in - redirect to login page with parameters
      return res.redirect(`/#/login?redirect_uri=${encodeURIComponent(redirect_uri)}&client_id=${client_id}${state ? '&state=' + encodeURIComponent(state) : ''}${scope ? '&scope=' + encodeURIComponent(scope) : ''}`);
    }

    // User is logged in - generate code and record authorization
    const code = generateShortToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    // Upsert authorization record
    db.prepare(`
      INSERT INTO authorizations (user_id, client_id, scope, last_used_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, client_id) DO UPDATE SET last_used_at = CURRENT_TIMESTAMP, scope = ?
    `).run(user.id, client_id, scope || 'default', scope || 'default');

    db.prepare('INSERT INTO auth_codes (code, client_id, user_id, expires_at) VALUES (?, ?, ?, ?)').run(code, client_id, user.id, expiresAt);

    // Record login log for OAuth
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    db.prepare('INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)').run(user.id, ip, client.name, 'oauth');

    // Redirect back to third-party with code and state
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    res.redirect(`${redirect_uri}?code=${code}${stateParam}`);
  } catch (err) {
    console.error('Authorize error:', err);
    res.redirect(`/oauth-error.html?error=server_error&description=${encodeURIComponent('授权失败')}`);
  }
});

// POST /token - Token exchange (third-party backend calls this)
router.post('/token', (req, res) => {
  try {
    const { code, client_id, client_secret } = req.body;

    if (!code || !client_id || !client_secret) {
      return oauthError(res, 400, 'invalid_request', '缺少必需参数');
    }

    // Verify client
    const client = db.prepare('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?').get(client_id, client_secret);
    if (!client) {
      return oauthError(res, 401, 'invalid_client', '无效的 client_id 或 client_secret');
    }

    // Verify code
    const authCode = db.prepare('SELECT * FROM auth_codes WHERE code = ? AND client_id = ? AND used = 0 AND expires_at > ?').get(code, client_id, new Date().toISOString());
    if (!authCode) {
      return oauthError(res, 401, 'invalid_grant', '无效、过期或已使用的授权码');
    }

    // Mark code as used
    db.prepare('UPDATE auth_codes SET used = 1 WHERE id = ?').run(authCode.id);

    // Get user info
    const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?').get(authCode.user_id);

    // Generate tokens
    const accessToken = generateToken();
    const refreshToken = generateToken();
    const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_EXPIRY).toISOString();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY).toISOString();

    // Store refresh token
    db.prepare('INSERT INTO refresh_tokens (user_id, client_id, token, expires_at) VALUES (?, ?, ?, ?)').run(user.id, client_id, refreshToken, refreshExpiresAt);

    res.json({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: ACCESS_TOKEN_EXPIRY / 1000, // seconds
      user
    });
  } catch (err) {
    console.error('Token exchange error:', err);
    oauthError(res, 500, 'server_error', 'Token交换失败');
  }
});

// POST /refresh - Refresh access token
router.post('/refresh', (req, res) => {
  try {
    const { refresh_token, client_id, client_secret } = req.body;

    if (!refresh_token || !client_id || !client_secret) {
      return oauthError(res, 400, 'invalid_request', '缺少必需参数');
    }

    // Verify client
    const client = db.prepare('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?').get(client_id, client_secret);
    if (!client) {
      return oauthError(res, 401, 'invalid_client', '无效的 client_id 或 client_secret');
    }

    // Verify refresh token
    const storedToken = db.prepare(`
      SELECT * FROM refresh_tokens
      WHERE token = ? AND client_id = ? AND revoked = 0 AND expires_at > ?
    `).get(refresh_token, client_id, new Date().toISOString());

    if (!storedToken) {
      return oauthError(res, 401, 'invalid_grant', '无效或已过期的 refresh_token');
    }

    // Get user info
    const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?').get(storedToken.user_id);

    // Generate new access token
    const accessToken = generateToken();

    res.json({
      success: true,
      access_token: accessToken,
      expires_in: ACCESS_TOKEN_EXPIRY / 1000,
      user
    });
  } catch (err) {
    console.error('Refresh token error:', err);
    oauthError(res, 500, 'server_error', '刷新Token失败');
  }
});

// GET /authorizations - Get user's authorized apps
router.get('/authorizations', requireAuth, (req, res) => {
  try {
    const authorizations = db.prepare(`
      SELECT a.client_id, a.scope, a.last_used_at, c.name
      FROM authorizations a
      JOIN clients c ON a.client_id = c.client_id
      WHERE a.user_id = ?
      ORDER BY a.last_used_at DESC
    `).all(req.user.id);

    res.json({ success: true, authorizations });
  } catch (err) {
    console.error('Get authorizations error:', err);
    res.status(500).json({ success: false, message: '获取授权列表失败' });
  }
});

// DELETE /authorizations/:client_id - Revoke authorization
router.delete('/authorizations/:client_id', requireAuth, (req, res) => {
  try {
    const { client_id } = req.params;

    // Delete authorization
    const result = db.prepare('DELETE FROM authorizations WHERE user_id = ? AND client_id = ?').run(req.user.id, client_id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: '授权不存在' });
    }

    // Also revoke all refresh tokens for this client
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?').run(req.user.id, client_id);

    res.json({ success: true, message: '授权已撤销' });
  } catch (err) {
    console.error('Revoke authorization error:', err);
    res.status(500).json({ success: false, message: '撤销授权失败' });
  }
});

// POST /verify - Session token verification (for same-domain scenarios)
router.post('/verify', (req, res) => {
  try {
    const { session_token } = req.body;

    if (!session_token) {
      return oauthError(res, 400, 'invalid_request', '缺少 session_token');
    }

    const user = db.prepare('SELECT id, username, email, created_at FROM users WHERE session_token = ?').get(session_token);

    if (!user) {
      return oauthError(res, 401, 'invalid_grant', '无效的 session_token');
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error('Verify error:', err);
    oauthError(res, 500, 'server_error', '验证失败');
  }
});

module.exports = router;