const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { client } = require('../redis');
const { generateShortToken, generateToken } = require('../utils/token');
const { formatMySQLDateTime, formatMySQLDateTimeFromMs } = require('../utils/datetime');
const { getClientIp } = require('../utils/request');
const requireAuth = require('../middleware/requireAuth');

const ACCESS_TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour in milliseconds
const ACCESS_TOKEN_TTL = 3600; // 1 hour in seconds (Redis TTL)
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL = 300; // 5 minutes in seconds (Redis TTL)

// Standard scopes
const VALID_SCOPES = ['openid', 'profile', 'email'];

function maskPhone(phone) {
  if (!phone) return null;
  return String(phone).replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

// RFC6749 standard error response
function oauthError(res, statusCode, error, description) {
  return res.status(statusCode).json({
    error,
    error_description: description
  });
}

// GET /authorize - Authorization endpoint for third-party redirect
router.get('/authorize', async (req, res) => {
  try {
    const { redirect_uri, client_id, state, scope, response_type } = req.query;

    // Validate required parameters
    if (!redirect_uri || !client_id) {
      return res.redirect(`/oauth-error.html?error=invalid_request&description=${encodeURIComponent('缺少必需参数')}`);
    }

    // Validate response_type (RFC 6749 Section 3.1.1)
    if (response_type && response_type !== 'code') {
      return res.redirect(`/oauth-error.html?error=unsupported_response_type&description=${encodeURIComponent('不支持的 response_type')}`);
    }

    // Verify client exists
    const [clientRows] = await pool.execute('SELECT * FROM clients WHERE client_id = ?', [client_id]);
    const clientData = clientRows[0];
    if (!clientData) {
      return res.redirect(`/oauth-error.html?error=invalid_client&description=${encodeURIComponent('无效的 client_id')}`);
    }

    // Verify redirect_uri matches
    if (clientData.redirect_uri !== redirect_uri) {
      return res.redirect(`/oauth-error.html?error=invalid_redirect&description=${encodeURIComponent('redirect_uri 不匹配')}`);
    }

    // Validate scope if provided
    if (scope) {
      const requestedScopes = scope.split(' ').filter(s => s);
      const invalidScopes = requestedScopes.filter(s => !VALID_SCOPES.includes(s));
      if (invalidScopes.length > 0) {
        return res.redirect(`/oauth-error.html?error=invalid_scope&description=${encodeURIComponent('无效的 scope: ' + invalidScopes.join(', '))}`);
      }
    }

    // Check if user is logged in
    const token = req.cookies.session;
    let user = null;

    if (token) {
      // Check Redis cache first
      const cachedUser = await client.get(`session:${token}`);
      if (cachedUser) {
        user = JSON.parse(cachedUser);
      } else {
        // Fallback to MySQL
        const [userRows] = await pool.execute('SELECT id, username, email, phone_verified FROM users WHERE session_token = ?', [token]);
        user = userRows[0];
      }
    }

    if (!user) {
      // Not logged in - redirect to login page with parameters
      // Security: redirect_uri is already validated against registered client
      // Include client name for user awareness of which app they're logging into
      const encodedClientName = encodeURIComponent(clientData.name);
      return res.redirect(`/#/login?redirect_uri=${encodeURIComponent(redirect_uri)}&client_id=${client_id}&client_name=${encodedClientName}${state ? '&state=' + encodeURIComponent(state) : ''}${scope ? '&scope=' + encodeURIComponent(scope) : ''}`);
    }

    // User is logged in - generate code and store in Redis
    const code = generateShortToken();

    // Store auth code in Redis (5 min TTL) with scope
    await client.setEx(`authcode:${code}`, AUTH_CODE_TTL, JSON.stringify({
      client_id,
      user_id: user.id,
      scope: scope || 'openid profile email',
      redirect_uri
    }));

    // Upsert authorization record
    await pool.execute(`
      INSERT INTO authorizations (user_id, client_id, scope, last_used_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE last_used_at = CURRENT_TIMESTAMP, scope = ?
    `, [user.id, client_id, scope || 'openid profile email', scope || 'openid profile email']);

    // Record login log for OAuth
    await pool.execute(
      'INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)',
      [user.id, getClientIp(req), clientData.name, 'oauth']
    );

    // Redirect back to third-party with code and state
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    res.redirect(`${redirect_uri}?code=${code}${stateParam}`);
  } catch (err) {
    console.error('Authorize error:', err);
    res.redirect(`/oauth-error.html?error=server_error&description=${encodeURIComponent('授权失败')}`);
  }
});

// POST /token - Token exchange (third-party backend calls this)
router.post('/token', async (req, res) => {
  try {
    const { code, client_id, client_secret, grant_type } = req.body;

    // Validate grant_type (RFC 6749 Section 4.1.3)
    if (!grant_type || grant_type !== 'authorization_code') {
      return oauthError(res, 400, 'unsupported_grant_type', '不支持的 grant_type');
    }

    if (!code || !client_id || !client_secret) {
      return oauthError(res, 400, 'invalid_request', '缺少必需参数');
    }

    // Verify client
    const [clientRows] = await pool.execute('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?', [client_id, client_secret]);
    const clientData = clientRows[0];
    if (!clientData) {
      return oauthError(res, 401, 'invalid_client', '无效的 client_id 或 client_secret');
    }

    // Verify code from Redis
    const codeData = await client.get(`authcode:${code}`);
    if (!codeData) {
      return oauthError(res, 401, 'invalid_grant', '无效、过期或已使用的授权码');
    }

    const parsedCode = JSON.parse(codeData);
    if (parsedCode.client_id !== client_id) {
      return oauthError(res, 401, 'invalid_grant', '授权码与 client_id 不匹配');
    }

    // Verify redirect_uri matches (stored in auth code)
    if (parsedCode.redirect_uri && clientData.redirect_uri !== parsedCode.redirect_uri) {
      return oauthError(res, 401, 'invalid_grant', 'redirect_uri 不匹配');
    }

    // Delete code (single-use)
    await client.del(`authcode:${code}`);

    // Get user info
    const [userRows] = await pool.execute('SELECT id, username, email, phone_verified, phone_verified_at, created_at FROM users WHERE id = ?', [parsedCode.user_id]);
    const user = userRows[0];

    // Generate tokens
    const accessToken = generateToken();
    const refreshToken = generateToken();
    const refreshExpiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY);

    // Store access token in Redis (1 hour TTL)
    await client.setEx(`accesstoken:${accessToken}`, ACCESS_TOKEN_TTL, JSON.stringify({
      user_id: user.id,
      client_id,
      scope: parsedCode.scope,
      token_type: 'Bearer'
    }));

    // Store refresh token in MySQL
    await pool.execute(
      'INSERT INTO refresh_tokens (user_id, client_id, token, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, client_id, refreshToken, parsedCode.scope || 'openid profile email', refreshExpiresAt]
    );

    // RFC 6749 compliant response
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      refresh_token: refreshToken,
      expires_in: ACCESS_TOKEN_EXPIRY / 1000,
      scope: parsedCode.scope
    });
  } catch (err) {
    console.error('Token exchange error:', err);
    oauthError(res, 500, 'server_error', 'Token交换失败');
  }
});

// POST /refresh - Refresh access token
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token, client_id, client_secret, grant_type } = req.body;

    // Validate grant_type
    if (!grant_type || grant_type !== 'refresh_token') {
      return oauthError(res, 400, 'unsupported_grant_type', '不支持的 grant_type');
    }

    if (!refresh_token || !client_id || !client_secret) {
      return oauthError(res, 400, 'invalid_request', '缺少必需参数');
    }

    // Verify client
    const [clientRows] = await pool.execute('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?', [client_id, client_secret]);
    const clientData = clientRows[0];
    if (!clientData) {
      return oauthError(res, 401, 'invalid_client', '无效的 client_id 或 client_secret');
    }

    // Verify refresh token
    const [tokenRows] = await pool.execute(`
      SELECT * FROM refresh_tokens
      WHERE token = ? AND client_id = ? AND revoked = 0 AND expires_at > ?
    `, [refresh_token, client_id, formatMySQLDateTime()]);
    const storedToken = tokenRows[0];

    if (!storedToken) {
      // Check if token was recently revoked (replay attack detection)
      const [revokedRows] = await pool.execute(`
        SELECT * FROM refresh_tokens
        WHERE token = ? AND client_id = ? AND revoked = 1
      `, [refresh_token, client_id]);

      if (revokedRows.length > 0) {
        // Replay attack detected - revoke all tokens for this user/client
        console.warn(`Replay attack detected for user ${revokedRows[0].user_id}, client ${client_id}`);
        await pool.execute(
          'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?',
          [revokedRows[0].user_id, client_id]
        );
        // Also invalidate all access tokens for this client (scan Redis)
        // Note: This is best-effort; access tokens expire in 1 hour anyway
      }

      return oauthError(res, 401, 'invalid_grant', '无效或已过期的 refresh_token');
    }

    // Get user info
    const [userRows] = await pool.execute('SELECT id, username, email, phone_verified, phone_verified_at, created_at FROM users WHERE id = ?', [storedToken.user_id]);
    const user = userRows[0];

    // Generate new tokens (rotation)
    const accessToken = generateToken();
    const newRefreshToken = generateToken();
    const newRefreshExpiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY);

    // Store access token in Redis
    await client.setEx(`accesstoken:${accessToken}`, ACCESS_TOKEN_TTL, JSON.stringify({
      user_id: user.id,
      client_id,
      scope: storedToken.scope || 'openid profile email',
      token_type: 'Bearer'
    }));

    // Revoke old refresh token and create new one
    await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [storedToken.id]);
    await pool.execute(
      'INSERT INTO refresh_tokens (user_id, client_id, token, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, client_id, newRefreshToken, storedToken.scope || 'openid profile email', newRefreshExpiresAt]
    );

    // RFC 6749 compliant response with new refresh token
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      refresh_token: newRefreshToken,
      expires_in: ACCESS_TOKEN_EXPIRY / 1000,
      scope: storedToken.scope || 'openid profile email'
    });
  } catch (err) {
    console.error('Refresh token error:', err);
    oauthError(res, 500, 'server_error', '刷新Token失败');
  }
});

// POST /introspect - Token introspection endpoint (RFC 7662)
router.post('/introspect', async (req, res) => {
  try {
    const { token, client_id, client_secret } = req.body;

    if (!token) {
      return oauthError(res, 400, 'invalid_request', '缺少 token 参数');
    }

    // Verify client credentials (required for introspection)
    if (!client_id || !client_secret) {
      return oauthError(res, 401, 'invalid_client', '缺少客户端认证');
    }

    const [clientRows] = await pool.execute('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?', [client_id, client_secret]);
    if (!clientRows[0]) {
      return oauthError(res, 401, 'invalid_client', '无效的客户端认证');
    }

    // Check if it's an access token (stored in Redis)
    const tokenData = await client.get(`accesstoken:${token}`);
    if (tokenData) {
      const parsed = JSON.parse(tokenData);
      return res.json({
        active: true,
        token_type: 'Bearer',
        scope: parsed.scope,
        client_id: parsed.client_id,
        sub: String(parsed.user_id), // Subject (user ID)
        exp: Math.floor(Date.now() / 1000) + await client.ttl(`accesstoken:${token}`)
      });
    }

    // Check if it's a refresh token (stored in MySQL)
    const [refreshRows] = await pool.execute(
      'SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0 AND expires_at > ?',
      [token, formatMySQLDateTime()]
    );
    const refreshToken = refreshRows[0];
    if (refreshToken) {
      return res.json({
        active: true,
        token_type: 'refresh_token',
        scope: refreshToken.scope || 'openid profile email',
        client_id: refreshToken.client_id,
        sub: String(refreshToken.user_id)
      });
    }

    // Token not found or inactive
    res.json({ active: false });
  } catch (err) {
    console.error('Introspect error:', err);
    oauthError(res, 500, 'server_error', 'Token验证失败');
  }
});

// GET /userinfo - UserInfo endpoint (OIDC Core)
router.get('/userinfo', async (req, res) => {
  try {
    // Get access token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return oauthError(res, 401, 'invalid_token', '缺少或无效的 Authorization header');
    }

    const accessToken = authHeader.substring(7);

    // Validate access token from Redis
    const tokenData = await client.get(`accesstoken:${accessToken}`);
    if (!tokenData) {
      return oauthError(res, 401, 'invalid_token', '无效或过期的 access token');
    }

    const parsed = JSON.parse(tokenData);
    const scope = parsed.scope || 'openid profile email';

    // Get user info
    const [userRows] = await pool.execute('SELECT id, username, email, email_verified, phone, phone_verified, phone_verified_at, avatar_url, created_at FROM users WHERE id = ?', [parsed.user_id]);
    const user = userRows[0];

    if (!user) {
      return oauthError(res, 401, 'invalid_token', '用户不存在');
    }

    // Return claims based on scope
    const claims = { sub: String(user.id) };

    if (scope.includes('profile')) {
      claims.name = user.username;
      claims.id = user.id;
      claims.username = user.username;
      claims.avatar_url = user.avatar_url;
      claims.phone_verified = user.phone_verified === 1 || user.phone_verified === true;
      claims.phone_verified_at = user.phone_verified_at;
      claims.phone_masked = maskPhone(user.phone);
      claims.updated_at = Math.floor(new Date(user.created_at).getTime() / 1000);

      // Include linked accounts in profile scope
      const [linkedAccounts] = await pool.execute(`
        SELECT provider, external_user_id, external_username, external_avatar_url,
               external_user_group_id, external_is_admin, external_is_moderator, linked_at
        FROM external_identities WHERE user_id = ?
      `, [user.id]);

      if (linkedAccounts.length > 0) {
        claims.linked_accounts = linkedAccounts.map(link => ({
          provider: link.provider,
          external_user_id: link.external_user_id,
          external_username: link.external_username,
          external_avatar_url: link.external_avatar_url,
          external_user_group_id: link.external_user_group_id,
          external_is_admin: link.external_is_admin === 1,
          external_is_moderator: link.external_is_moderator === 1,
          linked_at: link.linked_at.toISOString()
        }));
      }
    }

    if (scope.includes('email')) {
      claims.email = user.email;
      claims.email_verified = user.email_verified === 1;
    }

    res.json(claims);
  } catch (err) {
    console.error('UserInfo error:', err);
    oauthError(res, 500, 'server_error', '获取用户信息失败');
  }
});

// GET /user - Compatibility endpoint used by older MindFourm builds.
router.get('/user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return oauthError(res, 401, 'invalid_token', '缺少或无效的 Authorization header');
    }

    const accessToken = authHeader.substring(7);
    const tokenData = await client.get(`accesstoken:${accessToken}`);
    if (!tokenData) {
      return oauthError(res, 401, 'invalid_token', '无效或过期的 access token');
    }

    const parsed = JSON.parse(tokenData);
    const [userRows] = await pool.execute(
      'SELECT id, username, email, phone, phone_verified, phone_verified_at, avatar_url, created_at FROM users WHERE id = ?',
      [parsed.user_id]
    );
    const user = userRows[0];

    if (!user) {
      return oauthError(res, 401, 'invalid_token', '用户不存在');
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url,
      phone_masked: maskPhone(user.phone),
      phone_verified: user.phone_verified === 1 || user.phone_verified === true,
      phone_verified_at: user.phone_verified_at,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error('User compatibility endpoint error:', err);
    oauthError(res, 500, 'server_error', '获取用户信息失败');
  }
});

// POST /revoke - Token revocation endpoint (RFC 7009)
router.post('/revoke', async (req, res) => {
  try {
    const { token, token_type_hint, client_id, client_secret } = req.body;

    if (!token) {
      return oauthError(res, 400, 'invalid_request', '缺少 token 参数');
    }

    // Verify client credentials
    if (!client_id || !client_secret) {
      return oauthError(res, 401, 'invalid_client', '缺少客户端认证');
    }

    const [clientRows] = await pool.execute('SELECT * FROM clients WHERE client_id = ? AND client_secret = ?', [client_id, client_secret]);
    if (!clientRows[0]) {
      return oauthError(res, 401, 'invalid_client', '无效的客户端认证');
    }

    // Try to revoke access token first
    const accessTokenData = await client.get(`accesstoken:${token}`);
    if (accessTokenData) {
      await client.del(`accesstoken:${token}`);
      return res.json({ success: true });
    }

    // Try to revoke refresh token
    const [result] = await pool.execute(
      'UPDATE refresh_tokens SET revoked = 1 WHERE token = ? AND client_id = ?',
      [token, client_id]
    );

    // RFC 7009: return success even if token doesn't exist
    res.json({ success: true });
  } catch (err) {
    console.error('Revoke error:', err);
    oauthError(res, 500, 'server_error', '撤销Token失败');
  }
});

// GET /authorizations - Get user's authorized apps
router.get('/authorizations', requireAuth, async (req, res) => {
  try {
    const [authorizations] = await pool.execute(`
      SELECT a.client_id, a.scope, a.last_used_at, c.name
      FROM authorizations a
      JOIN clients c ON a.client_id = c.client_id
      WHERE a.user_id = ?
      ORDER BY a.last_used_at DESC
    `, [req.user.id]);

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

    // Delete authorization
    const [result] = await pool.execute('DELETE FROM authorizations WHERE user_id = ? AND client_id = ?', [req.user.id, client_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '授权不存在' });
    }

    // Also revoke all refresh tokens for this client
    await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?', [req.user.id, client_id]);

    // Also invalidate any access tokens for this client (need to scan Redis)
    // Note: This is a best-effort cleanup, access tokens expire in 1 hour anyway

    res.json({ success: true, message: '授权已撤销' });
  } catch (err) {
    console.error('Revoke authorization error:', err);
    res.status(500).json({ success: false, message: '撤销授权失败' });
  }
});

// POST /verify - Session token verification (for same-domain scenarios)
router.post('/verify', async (req, res) => {
  try {
    const { session_token } = req.body;

    if (!session_token) {
      return oauthError(res, 400, 'invalid_request', '缺少 session_token');
    }

    // Check Redis cache first
    const cachedUser = await client.get(`session:${session_token}`);
    if (cachedUser) {
      const user = JSON.parse(cachedUser);
      return res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone_verified: user.phone_verified === 1 || user.phone_verified === true,
          phone_verified_at: user.phone_verified_at,
          created_at: user.created_at
        }
      });
    }

    // Fallback to MySQL
    const [userRows] = await pool.execute('SELECT id, username, email, phone_verified, phone_verified_at, created_at FROM users WHERE session_token = ?', [session_token]);
    const user = userRows[0];

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
