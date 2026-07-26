/**
 * oauthIssuer — Deep module for all OAuth 2.0 / OIDC business logic.
 *
 * Orchestrates:
 *   - Authorization code issuance (GET /authorize logic)
 *   - Token exchange (POST /token)
 *   - Refresh token rotation (POST /refresh) — MySQL transaction + row lock
 *   - Token introspection (POST /introspect — RFC 7662)
 *   - Token revocation (POST /revoke — RFC 7009)
 *   - UserInfo claims (GET /userinfo — OIDC Core)
 *   - User compatibility endpoint (GET /user)
 *   - Authorization management (list / revoke)
 *   - Session verification (POST /verify)
 *
 * Depends on:
 *   - tokenStore (Redis auth codes & access tokens)
 *   - sessionManager (user session authentication)
 *   - MySQL (clients, refresh_tokens, authorizations, users)
 *
 * Invariants:
 *   - PKCE supports S256 only (plain is not accepted)
 *   - Auth codes are single-use; consumption is atomic (GETDEL)
 *   - Refresh rotation uses MySQL transaction with SELECT FOR UPDATE
 *   - Replay of revoked/rotated refresh tokens is detected and contained
 *   - Redis token invalidation uses per-user/client index sets, not SCAN
 *   - /revoke returns { success: true } even for unknown tokens (RFC 7009)
 */

const crypto = require('crypto');
const { pool, transaction } = require('../../db');
const { timingSafeCompare } = require('../../utils/crypto');
const { generateShortToken, generateToken } = require('../../utils/token');
const { formatMySQLDateTime, formatMySQLDateTimeFromMs } = require('../../utils/datetime');
const { maskPhone } = require('../../utils/phone');
const sessionManager = require('../sessions/sessionManager');
const tokenStore = require('./tokenStore');

// ─── Constants ────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000;   // 1 hour
const ACCESS_TOKEN_TTL_S = 3600;                  // 1 hour (Redis TTL)
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_S = 300;                      // 5 minutes
const VALID_SCOPES = ['openid', 'profile', 'email'];

// ─── Error helper ─────────────────────────────────────────────

/**
 * OAuth error thrown by issuer methods and caught by the route adapter.
 *
 * For authorize-related validation errors that need a redirect to the
 * oauth-error page, set `errorPageParams` to { error, description }.
 * For all other endpoints, `status`, `error`, and `errorDescription`
 * produce the standard RFC 6749 JSON error response.
 */
class OAuthError extends Error {
  /**
   * @param {number} status - HTTP status code
   * @param {string} error - RFC 6749 error code (e.g. 'invalid_client')
   * @param {string} description - Human-readable description
   * @param {{ error: string, description: string }} [errorPageParams] - For /authorize redirects
   */
  constructor(status, error, description, errorPageParams) {
    super(description);
    this.name = 'OAuthError';
    this.status = status;
    this.error = error;
    this.errorDescription = description;
    this.errorPageParams = errorPageParams || null;
  }
}

// ─── PKCE helpers (RFC 7636) ──────────────────────────────────

function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function verifyPkce(codeVerifier, codeChallenge) {
  const computed = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  if (computed.length !== codeChallenge.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
}

/**
 * Refresh tokens are stored in MySQL as SHA-256 hashes — a database dump
 * never exposes usable tokens. All refresh_tokens.token reads/writes must
 * go through this helper.
 */
function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

// ─── Client verification ──────────────────────────────────────

/**
 * Verify client credentials against the MySQL clients table.
 * Throws OAuthError if invalid.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Promise<object>} The client row
 */
async function verifyClient(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new OAuthError(401, 'invalid_client', '缺少客户端认证');
  }
  // Fetch by client_id only, then compare the secret in constant time —
  // a SQL equality comparison can leak secret prefixes via timing
  const [rows] = await pool.execute(
    'SELECT * FROM clients WHERE client_id = ?',
    [clientId]
  );
  const row = rows[0];
  if (!row || !timingSafeCompare(String(clientSecret), String(row.client_secret))) {
    throw new OAuthError(401, 'invalid_client', '无效的 client_id 或 client_secret');
  }
  return row;
}

/**
 * Look up a client by client_id only (no secret).
 * Throws OAuthError with redirect params if not found.
 *
 * @param {string} clientId
 * @returns {Promise<object>} The client row
 */
async function lookupClient(clientId) {
  const [rows] = await pool.execute('SELECT * FROM clients WHERE client_id = ?', [clientId]);
  if (!rows[0]) {
    throw new OAuthError(400, 'invalid_client', '无效的 client_id', {
      error: 'invalid_client',
      description: '无效的 client_id'
    });
  }
  return rows[0];
}

// ─── Authorize ────────────────────────────────────────────────

/**
 * Validate OAuth authorize parameters and generate an authorization code.
 *
 * This method does NOT check if the user is logged in — the route adapter
 * handles that by passing a non-null `sessionToken` only when authenticated.
 *
 * @param {object} params
 * @param {string} params.clientId
 * @param {string} params.redirectUri
 * @param {string} [params.scope]
 * @param {string} [params.state]
 * @param {string} [params.codeChallenge]
 * @param {string} [params.codeChallengeMethod]
 * @param {string} [params.responseType]
 * @param {string|null} params.sessionToken - raw session cookie value, or null if not logged in
 * @param {string} params.ipAddress - client IP for login_logs
 * @returns {Promise<{ redirectTo?: string, loginRedirect?: string, client?: object, code?: string }>}
 */
async function authorize({ clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, responseType, sessionToken, ipAddress }) {
  // 1. Validate required parameters
  if (!redirectUri || !clientId) {
    throw new OAuthError(400, 'invalid_request', '缺少必需参数', {
      error: 'invalid_request',
      description: '缺少必需参数'
    });
  }

  // 2. Validate response_type
  if (responseType && responseType !== 'code') {
    throw new OAuthError(400, 'unsupported_response_type', '不支持的 response_type', {
      error: 'unsupported_response_type',
      description: '不支持的 response_type'
    });
  }

  // 3. Look up client
  const clientData = await lookupClient(clientId);

  // 4. Verify redirect_uri matches registered client
  if (clientData.redirect_uri !== redirectUri) {
    throw new OAuthError(400, 'invalid_redirect', 'redirect_uri 不匹配', {
      error: 'invalid_redirect',
      description: 'redirect_uri 不匹配'
    });
  }

  // 5. PKCE validation (RFC 7636)
  const clientRequiresPkce = clientData.require_pkce === 1;
  if (clientRequiresPkce) {
    if (!codeChallenge) {
      throw new OAuthError(400, 'invalid_request', '该客户端要求 PKCE，缺少 code_challenge', {
        error: 'invalid_request',
        description: '该客户端要求 PKCE，缺少 code_challenge'
      });
    }
    if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
      throw new OAuthError(400, 'invalid_request', '仅支持 S256 code_challenge_method', {
        error: 'invalid_request',
        description: '仅支持 S256 code_challenge_method'
      });
    }
  } else if (codeChallenge) {
    if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
      throw new OAuthError(400, 'invalid_request', '仅支持 S256 code_challenge_method', {
        error: 'invalid_request',
        description: '仅支持 S256 code_challenge_method'
      });
    }
  }
  const effectivePkceMethod = (codeChallenge && codeChallengeMethod) ? codeChallengeMethod : 'S256';

  // 6. Validate scope
  if (scope) {
    const requestedScopes = scope.split(' ').filter(s => s);
    const invalidScopes = requestedScopes.filter(s => !VALID_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
      throw new OAuthError(400, 'invalid_scope', '无效的 scope: ' + invalidScopes.join(', '), {
        error: 'invalid_scope',
        description: '无效的 scope: ' + invalidScopes.join(', ')
      });
    }
  }

  // 7. Check if user is logged in via sessionManager
  let user = null;
  if (sessionToken) {
    const authResult = await sessionManager.authenticateUserSession(sessionToken);
    if (authResult) {
      user = authResult.user;
    }
  }

  if (!user) {
    // Return info for login redirect — route adapter builds the URL
    return { loginRedirect: true, client: clientData };
  }

  // 8. Generate authorization code
  const code = generateShortToken();
  const effectiveScope = scope || 'openid profile email';

  const authCodePayload = {
    client_id: clientId,
    user_id: user.id,
    scope: effectiveScope,
    redirect_uri: redirectUri,
  };
  if (codeChallenge) {
    authCodePayload.code_challenge = codeChallenge;
    authCodePayload.code_challenge_method = effectivePkceMethod;
  }

  // 9. Store auth code in Redis (atomic, 5 min TTL)
  await tokenStore.storeAuthCode(code, authCodePayload, AUTH_CODE_TTL_S);

  // 10. Upsert authorization record
  await pool.execute(`
    INSERT INTO authorizations (user_id, client_id, scope, last_used_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE last_used_at = CURRENT_TIMESTAMP, scope = ?
  `, [user.id, clientId, effectiveScope, effectiveScope]);

  // 11. Record login log for OAuth
  await pool.execute(
    'INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)',
    [user.id, ipAddress, clientData.name, 'oauth']
  );

  // 12. Build redirect URL (URL API keeps any query string the registered
  // redirect_uri already carries intact)
  const redirectTo = new URL(redirectUri);
  redirectTo.searchParams.set('code', code);
  if (state) redirectTo.searchParams.set('state', state);
  return { redirectTo: redirectTo.toString() };
}

// ─── Token Exchange ───────────────────────────────────────────

/**
 * Exchange an authorization code for access + refresh tokens.
 *
 * @param {object} params
 * @param {string} params.code - Authorization code
 * @param {string} params.clientId
 * @param {string} params.clientSecret
 * @param {string} [params.redirectUri]
 * @param {string} [params.codeVerifier] - PKCE code_verifier
 * @returns {Promise<{ access_token: string, refresh_token: string, token_type: string, expires_in: number, scope: string }>}
 */
async function exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
  // 1. Verify client credentials
  const clientData = await verifyClient(clientId, clientSecret);

  // 2. Atomically consume auth code (single-use via GETDEL)
  const codeData = await tokenStore.consumeAuthCode(code);
  if (!codeData) {
    throw new OAuthError(401, 'invalid_grant', '无效、过期或已使用的授权码');
  }

  // 3. Verify code belongs to this client
  if (codeData.client_id !== clientId) {
    throw new OAuthError(401, 'invalid_grant', '授权码与 client_id 不匹配');
  }

  // 4. Verify redirect_uri matches
  if (codeData.redirect_uri && clientData.redirect_uri !== codeData.redirect_uri) {
    throw new OAuthError(401, 'invalid_grant', 'redirect_uri 不匹配');
  }

  // 5. PKCE verification (if the code was issued with a challenge)
  if (codeData.code_challenge) {
    if (!codeVerifier) {
      throw new OAuthError(400, 'invalid_request', '该授权码使用了 PKCE，必须提供 code_verifier');
    }
    if (codeData.code_challenge_method !== 'S256') {
      throw new OAuthError(400, 'unsupported_grant_type', '不支持的 code_challenge_method');
    }
    if (!verifyPkce(codeVerifier, codeData.code_challenge)) {
      throw new OAuthError(401, 'invalid_grant', 'code_verifier 校验失败');
    }
  }

  // 6. Get user info
  const [userRows] = await pool.execute(
    'SELECT id, username, email, phone_verified, phone_verified_at, created_at FROM users WHERE id = ?',
    [codeData.user_id]
  );
  const user = userRows[0];
  if (!user) {
    throw new OAuthError(401, 'invalid_grant', '授权用户不存在');
  }

  // 7. Generate tokens
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const refreshExpiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  const effectiveScope = codeData.scope || 'openid profile email';

  // 8. Store access token in Redis (with per-user/client index)
  await tokenStore.storeAccessToken(accessToken, {
    user_id: user.id,
    client_id: clientId,
    scope: effectiveScope,
    token_type: 'Bearer',
  }, ACCESS_TOKEN_TTL_S);

  // 9. Store refresh token in MySQL (hashed)
  await pool.execute(
    'INSERT INTO refresh_tokens (user_id, client_id, token, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, clientId, hashRefreshToken(refreshToken), effectiveScope, refreshExpiresAt]
  );

  // 10. Return RFC 6749 compliant response
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_EXPIRY_MS / 1000,
    scope: effectiveScope,
  };
}

// ─── Refresh Token Rotation ───────────────────────────────────

/**
 * Rotate a refresh token and issue a new access token.
 *
 * Uses MySQL transaction with SELECT FOR UPDATE to prevent concurrent
 * redemption of the same refresh token (replay attack protection).
 *
 * @param {object} params
 * @param {string} params.refreshToken
 * @param {string} params.clientId
 * @param {string} params.clientSecret
 * @returns {Promise<{ access_token: string, refresh_token: string, token_type: string, expires_in: number, scope: string }>}
 */
async function refresh({ refreshToken, clientId, clientSecret }) {
  // 1. Verify client credentials
  await verifyClient(clientId, clientSecret);

  // 2. Atomically rotate the refresh token via MySQL transaction
  let storedToken;
  let user;
  let newRefreshToken;
  let newRefreshExpiresAt;

  try {
    await transaction(async (conn) => {
      // SELECT FOR UPDATE prevents concurrent requests from redeeming the same token
      const [tokenRows] = await conn.execute(`
        SELECT * FROM refresh_tokens
        WHERE token = ? AND client_id = ?
        FOR UPDATE
      `, [hashRefreshToken(refreshToken), clientId]);
      const row = tokenRows[0];

      if (!row) {
        throw new Error('TOKEN_NOT_FOUND');
      }

      // Replay attack detection: if already revoked, flag the user/client pair
      if (row.revoked === 1) {
        console.warn(`Replay attack detected for user ${row.user_id}, client ${clientId}`);
        await conn.execute(
          'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?',
          [row.user_id, clientId]
        );
        throw new Error('TOKEN_REVOKED');
      }

      // Check expiry
      if (new Date(row.expires_at) <= new Date()) {
        throw new Error('TOKEN_EXPIRED');
      }

      storedToken = row;

      // Get user info (within transaction for consistency)
      const [userRows] = await conn.execute(
        'SELECT id, username, email, phone_verified, phone_verified_at, created_at FROM users WHERE id = ?',
        [row.user_id]
      );
      user = userRows[0];
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      // Generate new tokens (rotation)
      newRefreshToken = generateToken();
      newRefreshExpiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

      // Revoke old refresh token and create new one atomically
      await conn.execute('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id]);
      await conn.execute(
        'INSERT INTO refresh_tokens (user_id, client_id, token, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
        [user.id, clientId, hashRefreshToken(newRefreshToken), storedToken.scope || 'openid profile email', newRefreshExpiresAt]
      );
    });
  } catch (txErr) {
    if (txErr.message === 'TOKEN_NOT_FOUND' || txErr.message === 'TOKEN_REVOKED' || txErr.message === 'TOKEN_EXPIRED') {
      throw new OAuthError(401, 'invalid_grant', '无效或已过期的 refresh_token');
    }
    if (txErr.message === 'USER_NOT_FOUND') {
      throw new OAuthError(401, 'invalid_grant', '用户不存在');
    }
    throw txErr;
  }

  // 3. Store access token in Redis (outside transaction — Redis is not transactional with MySQL)
  const accessToken = generateToken();
  const effectiveScope = storedToken.scope || 'openid profile email';

  await tokenStore.storeAccessToken(accessToken, {
    user_id: user.id,
    client_id: clientId,
    scope: effectiveScope,
    token_type: 'Bearer',
  }, ACCESS_TOKEN_TTL_S);

  // 4. Return RFC 6749 compliant response
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    refresh_token: newRefreshToken,
    expires_in: ACCESS_TOKEN_EXPIRY_MS / 1000,
    scope: effectiveScope,
  };
}

// ─── Token Introspection (RFC 7662) ──────────────────────────

/**
 * Introspect a token (access or refresh) per RFC 7662.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.clientId
 * @param {string} params.clientSecret
 * @returns {Promise<object>} RFC 7662 introspection response
 */
async function introspect({ token, clientId, clientSecret }) {
  // 1. Verify client credentials (constant-time, shared with all endpoints)
  await verifyClient(clientId, clientSecret);

  // 2. Check if it's an access token (Redis)
  const tokenData = await tokenStore.getAccessToken(token);
  if (tokenData) {
    const ttl = await tokenStore.getAccessTokenTtl(token);
    return {
      active: true,
      token_type: 'Bearer',
      scope: tokenData.scope,
      client_id: tokenData.client_id,
      sub: String(tokenData.user_id),
      exp: Math.floor(Date.now() / 1000) + Math.max(ttl, 0),
    };
  }

  // 3. Check if it's a refresh token (MySQL, stored hashed)
  const [refreshRows] = await pool.execute(
    'SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0 AND expires_at > ?',
    [hashRefreshToken(token), formatMySQLDateTime()]
  );
  const refreshToken = refreshRows[0];
  if (refreshToken) {
    return {
      active: true,
      token_type: 'refresh_token',
      scope: refreshToken.scope || 'openid profile email',
      client_id: refreshToken.client_id,
      sub: String(refreshToken.user_id),
    };
  }

  // 4. Token not found or inactive
  return { active: false };
}

// ─── Token Revocation (RFC 7009) ──────────────────────────────

/**
 * Revoke a token (access or refresh) per RFC 7009.
 * Always returns { success: true }, even for unknown tokens.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {string} [params.tokenTypeHint]
 * @param {string} params.clientId
 * @param {string} params.clientSecret
 * @returns {Promise<{ success: boolean }>}
 */
async function revoke({ token, tokenTypeHint, clientId, clientSecret }) {
  // 1. Verify client credentials (constant-time, shared with all endpoints)
  await verifyClient(clientId, clientSecret);

  // 2. Try to revoke access token (Redis)
  const accessTokenData = await tokenStore.getAccessToken(token);
  if (accessTokenData) {
    await tokenStore.revokeAccessToken(token);
    return { success: true };
  }

  // 3. Try to revoke refresh token (MySQL, stored hashed)
  await pool.execute(
    'UPDATE refresh_tokens SET revoked = 1 WHERE token = ? AND client_id = ?',
    [hashRefreshToken(token), clientId]
  );

  // 4. RFC 7009: always return success
  return { success: true };
}

// ─── UserInfo (OIDC Core) ─────────────────────────────────────

/**
 * Return OIDC-style claims for the given access token, filtered by scope.
 *
 * @param {string} accessToken
 * @returns {Promise<object>} OIDC claims object
 */
async function userinfo(accessToken) {
  // 1. Validate access token
  const tokenData = await tokenStore.getAccessToken(accessToken);
  if (!tokenData) {
    throw new OAuthError(401, 'invalid_token', '无效或过期的 access token');
  }

  const scope = tokenData.scope || 'openid profile email';

  // 2. Get user info
  const [userRows] = await pool.execute(
    'SELECT id, username, email, email_verified, phone, phone_verified, phone_verified_at, avatar_url, ban_status, created_at FROM users WHERE id = ?',
    [tokenData.user_id]
  );
  const user = userRows[0];
  if (!user) {
    throw new OAuthError(401, 'invalid_token', '用户不存在');
  }

  // 3. Build claims based on scope
  const claims = { sub: String(user.id) };

  if (scope.includes('profile')) {
    claims.name = user.username;
    claims.id = user.id;
    claims.username = user.username;
    claims.avatar_url = user.avatar_url;
    claims.phone_verified = user.phone_verified === 1 || user.phone_verified === true;
    claims.phone_verified_at = user.phone_verified_at;
    claims.phone_masked = maskPhone(user.phone);
    claims.ban_status = user.ban_status || 'none';
    claims.is_muted = user.ban_status === 'muted';
    claims.updated_at = Math.floor(new Date(user.created_at).getTime() / 1000);

    // Include public custom fields
    const [customFieldRows] = await pool.execute(`
      SELECT f.field_key, v.value FROM user_fields f
      JOIN user_field_values v ON v.field_id = f.id
      WHERE v.user_id = ? AND f.is_public = 1 AND v.value IS NOT NULL
    `, [user.id]);

    if (customFieldRows.length > 0) {
      claims.custom_fields = {};
      for (const f of customFieldRows) {
        claims.custom_fields[f.field_key] = f.value;
      }
    }
  }

  if (scope.includes('email')) {
    claims.email = user.email;
    claims.email_verified = user.email_verified === 1;
  }

  return claims;
}

// ─── User Compatibility Endpoint ──────────────────────────────

/**
 * Return flat user data for the /user compatibility endpoint (MindFourm).
 *
 * @param {string} accessToken
 * @returns {Promise<object>}
 */
async function userByAccessToken(accessToken) {
  const tokenData = await tokenStore.getAccessToken(accessToken);
  if (!tokenData) {
    throw new OAuthError(401, 'invalid_token', '无效或过期的 access token');
  }

  const [userRows] = await pool.execute(
    'SELECT id, username, email, phone, phone_verified, phone_verified_at, avatar_url, created_at FROM users WHERE id = ?',
    [tokenData.user_id]
  );
  const user = userRows[0];
  if (!user) {
    throw new OAuthError(401, 'invalid_token', '用户不存在');
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatar_url: user.avatar_url,
    phone_masked: maskPhone(user.phone),
    phone_verified: user.phone_verified === 1 || user.phone_verified === true,
    phone_verified_at: user.phone_verified_at,
    created_at: user.created_at,
  };
}

// ─── Authorization Management ─────────────────────────────────

/**
 * List authorized clients for a given user.
 *
 * @param {number} userId
 * @returns {Promise<Array>}
 */
async function listAuthorizations(userId) {
  const [authorizations] = await pool.execute(`
    SELECT a.client_id, a.scope, a.last_used_at, c.name
    FROM authorizations a
    JOIN clients c ON a.client_id = c.client_id
    WHERE a.user_id = ?
    ORDER BY a.last_used_at DESC
  `, [userId]);
  return authorizations;
}

/**
 * Revoke an authorization: delete the authorization record, revoke all
 * refresh tokens, and invalidate all access tokens for that user/client pair.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.clientId
 * @returns {Promise<{ revoked: boolean }>}
 */
async function revokeAuthorization({ userId, clientId }) {
  // 1. Delete authorization record
  const [result] = await pool.execute(
    'DELETE FROM authorizations WHERE user_id = ? AND client_id = ?',
    [userId, clientId]
  );
  if (result.affectedRows === 0) {
    return { revoked: false };
  }

  // 2. Revoke all refresh tokens for this client
  await pool.execute(
    'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?',
    [userId, clientId]
  );

  // 3. Invalidate all access tokens using the per-user/client index set
  await tokenStore.revokeAccessTokensForUserClient(userId, clientId);

  return { revoked: true };
}

// ─── Session Verification ─────────────────────────────────────

/**
 * Verify a session token and return user info.
 *
 * @param {string} sessionToken
 * @returns {Promise<object>}
 */
async function verify(sessionToken) {
  const authResult = await sessionManager.authenticateUserSession(sessionToken);
  if (!authResult) {
    throw new OAuthError(401, 'invalid_grant', '无效的 session_token');
  }

  const user = authResult.user;
  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      phone_verified: user.phone_verified === 1 || user.phone_verified === true,
      phone_verified_at: user.phone_verified_at,
      created_at: user.created_at,
    },
  };
}

// ─── Exports ──────────────────────────────────────────────────

module.exports = {
  OAuthError,
  authorize,
  exchangeCode,
  refresh,
  introspect,
  revoke,
  userinfo,
  userByAccessToken,
  listAuthorizations,
  revokeAuthorization,
  verify,
};
