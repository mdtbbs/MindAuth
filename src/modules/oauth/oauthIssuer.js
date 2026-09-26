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
const { hashClientSecret, isHashedClientSecret } = require('../../utils/secrets');
const { formatMySQLDateTime, formatMySQLDateTimeFromMs } = require('../../utils/datetime');
const { maskPhone } = require('../../utils/phone');
const { forumProfileUrl } = require('../../utils/forumProfileUrl');
const sessionManager = require('../sessions/sessionManager');
const tokenStore = require('./tokenStore');
const { VALID_SCOPES, LEGACY_NATIVE_SCOPES, normalizeScopes } = require('./scopes');

// ─── Constants ────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000;   // 1 hour
const ACCESS_TOKEN_TTL_S = 3600;                  // 1 hour (Redis TTL)
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_S = 300;                      // 5 minutes
const LEGACY_DEFAULT_SCOPES = ['openid', 'profile', 'email'];

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

async function assertUserNotBanned(userId) {
  const [rows] = await pool.execute('SELECT ban_status FROM users WHERE id = ?', [userId]);
  if (!rows[0] || rows[0].ban_status === 'banned') {
    throw new OAuthError(401, 'invalid_token', rows[0] ? '用户已被封禁' : '用户不存在');
  }
}

async function assertClientActive(clientId) {
  const [rows] = await pool.execute('SELECT status FROM clients WHERE client_id = ? LIMIT 1', [clientId]);
  if (!rows[0] || (rows[0].status && rows[0].status !== 'approved')) {
    throw new OAuthError(401, 'invalid_token', '客户端未批准或已停用');
  }
}

async function assertNativeSessionActive(sessionId) {
  if (!sessionId) return;
  const [rows] = await pool.execute('SELECT revoked_at FROM native_client_sessions WHERE id = ? LIMIT 1', [sessionId]);
  if (!rows[0] || rows[0].revoked_at) throw new OAuthError(401, 'invalid_token', '会话已撤销');
}

function issueNativeTokens({ userId, clientId, accessClientId = clientId, nativeSessionId, scope = 'openid profile game_content' }) {
  return (async () => {
    const accessToken = generateToken();
    const refreshToken = generateToken();
    const expiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    const [refreshResult] = await pool.execute(
      'INSERT INTO refresh_tokens (user_id, client_id, token, scope, expires_at, native_session_id) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, clientId, hashRefreshToken(refreshToken), scope, expiresAt, nativeSessionId]
    );
    try {
      await tokenStore.storeAccessToken(accessToken, {
        user_id: userId, client_id: accessClientId, scope, token_type: 'Bearer', native_session_id: nativeSessionId,
      }, ACCESS_TOKEN_TTL_S);
    } catch (err) {
      await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [refreshResult.insertId]).catch(() => {});
      await tokenStore.revokeAccessToken(accessToken).catch(() => {});
      throw err;
    }
    return { access_token: accessToken, token_type: 'Bearer', refresh_token: refreshToken, expires_in: ACCESS_TOKEN_TTL_S, scope };
  })();
}

async function refreshNative({ refreshToken, clientId, accessClientId = clientId, deviceId }) {
  let outcome;
  await transaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM refresh_tokens WHERE token = ? FOR UPDATE', [hashRefreshToken(refreshToken)]);
    const row = rows[0];
    if (!row || row.client_id !== clientId || !row.native_session_id) { outcome = { error: 'INVALID' }; return; }
    const [sessions] = await conn.execute('SELECT * FROM native_client_sessions WHERE id = ? FOR UPDATE', [row.native_session_id]);
    const session = sessions[0];
    if (!session || session.client_id !== clientId || session.device_id !== deviceId || session.revoked_at) { outcome = { error: 'INVALID' }; return; }
    if (row.revoked) { outcome = { replaySessionId: session.id }; return; }
    if (new Date(row.expires_at) <= new Date()) { outcome = { error: 'INVALID' }; return; }
    const [users] = await conn.execute('SELECT id, ban_status FROM users WHERE id = ? LIMIT 1', [row.user_id]);
    const user = users[0];
    if (!user || user.ban_status === 'banned') { outcome = { error: 'INVALID' }; return; }
    const nextRefresh = generateToken();
    const expiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    await conn.execute('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id]);
    await conn.execute(
      'INSERT INTO refresh_tokens (user_id, client_id, token, scope, expires_at, native_session_id) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, clientId, hashRefreshToken(nextRefresh), row.scope || 'openid profile game_content', expiresAt, session.id]
    );
    await conn.execute('UPDATE native_client_sessions SET last_active_at = NOW() WHERE id = ?', [session.id]);
    outcome = { userId: user.id, sessionId: session.id, scope: row.scope || 'openid profile game_content', refreshToken: nextRefresh };
  });

  if (outcome?.replaySessionId) {
    await revokeNativeSession(outcome.replaySessionId);
    throw new OAuthError(401, 'invalid_grant', '无效或已撤销的 refresh_token');
  }
  if (!outcome?.userId) throw new OAuthError(401, 'invalid_grant', '无效或已过期的 refresh_token');
  const accessToken = generateToken();
  try {
    await tokenStore.storeAccessToken(accessToken, {
      user_id: outcome.userId, client_id: accessClientId, scope: outcome.scope, token_type: 'Bearer', native_session_id: outcome.sessionId,
    }, ACCESS_TOKEN_TTL_S);
  } catch (err) {
    await revokeNativeSession(outcome.sessionId).catch(() => {});
    throw new OAuthError(503, 'temporarily_unavailable', '认证服务暂不可用');
  }
  return { access_token: accessToken, token_type: 'Bearer', refresh_token: outcome.refreshToken, expires_in: ACCESS_TOKEN_TTL_S, scope: outcome.scope };
}

async function revokeNativeSession(sessionId) {
  await pool.execute('UPDATE native_client_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ?', [sessionId]);
  await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE native_session_id = ?', [sessionId]);
  await tokenStore.revokeAccessTokensForNativeSession(sessionId);
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
async function verifyClient(clientId, clientSecret, { allowPublic = false } = {}) {
  if (!clientId) {
    throw new OAuthError(401, 'invalid_client', '缺少客户端认证');
  }
  // Fetch by client_id only, then compare the secret in constant time —
  // a SQL equality comparison can leak secret prefixes via timing
  const [rows] = await pool.execute(
    'SELECT * FROM clients WHERE client_id = ?',
    [clientId]
  );
  const row = rows[0];
  if (!row || row.status && row.status !== 'approved') {
    throw new OAuthError(401, 'invalid_client', '客户端未批准或已停用');
  }
  if (row.client_type === 'public') {
    if (allowPublic && !clientSecret && !row.client_secret && row.require_pkce) return row;
    throw new OAuthError(401, 'invalid_client', 'Public Client 不使用客户端密钥');
  }
  if (!clientSecret) throw new OAuthError(401, 'invalid_client', '缺少客户端认证');
  const storedSecret = row && String(row.client_secret || '');
  const presentedSecret = isHashedClientSecret(storedSecret) ? hashClientSecret(clientSecret) : String(clientSecret);
  if (!row || !timingSafeCompare(presentedSecret, storedSecret)) {
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
  if (!rows[0] || (rows[0].status && rows[0].status !== 'approved')) {
    throw new OAuthError(400, 'invalid_client', '无效的 client_id', {
      error: 'invalid_client',
      description: '无效的 client_id'
    });
  }
  return rows[0];
}

async function getRedirectUris(client) {
  const [rows] = await pool.execute(
    'SELECT redirect_uri, redirect_type FROM oauth_client_redirect_uris WHERE oauth_client_id = ? ORDER BY id',
    [client.id],
  );
  return rows.length ? rows : (client.redirect_uri ? [{ redirect_uri: client.redirect_uri, redirect_type: 'web' }] : []);
}

function redirectUriMatches(requested, registered) {
  if (requested === registered) return true;
  try {
    const requestedUrl = new URL(requested);
    const registeredUrl = new URL(registered);
    const loopback = (url) => url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname.toLowerCase());
    if (!loopback(requestedUrl) || !loopback(registeredUrl)) return false;
    if (requestedUrl.hostname.toLowerCase() !== registeredUrl.hostname.toLowerCase()) return false;
    if (requestedUrl.pathname !== registeredUrl.pathname || requestedUrl.search !== registeredUrl.search) return false;
    const requestedPort = requestedUrl.port ? Number(requestedUrl.port) : 80;
    const registeredPort = registeredUrl.port ? Number(registeredUrl.port) : 80;
    // RFC 8252 permits dynamically allocated loopback ports. Register port 0
    // to authorize any non-privileged runtime port for this exact callback.
    return (registeredPort === 0 && requestedPort >= 1 && requestedPort <= 65535) || requestedPort === registeredPort;
  } catch {
    return false;
  }
}

function requestedScopes(scope, client) {
  const approved = normalizeScopes(client.approved_scopes, LEGACY_DEFAULT_SCOPES);
  const requested = typeof scope === 'string' && scope.trim()
    ? [...new Set(scope.trim().split(/\s+/))]
    : approved;
  const invalid = requested.filter(value => !VALID_SCOPES.includes(value));
  if (invalid.length) {
    throw new OAuthError(400, 'invalid_scope', `无效的 scope: ${invalid.join(', ')}`, {
      error: 'invalid_scope', description: `无效的 scope: ${invalid.join(', ')}`,
    });
  }
  if (requested.some(value => !approved.includes(value))) {
    throw new OAuthError(400, 'invalid_scope', '请求的 scope 未包含在此应用的权限配置中', {
      error: 'invalid_scope', description: '请求的 scope 未包含在此应用的权限配置中',
    });
  }
  return requested;
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
async function authorize({ clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, responseType, sessionToken, ipAddress, consentGranted = false, previewOnly = false }) {
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

  if (clientData.client_type === 'public' && (typeof state !== 'string' || !state || state.length > 1024)) {
    throw new OAuthError(400, 'invalid_request', 'Public Client 请求必须提供有效的 state', {
      error: 'invalid_request', description: 'Public Client 请求必须提供有效的 state',
    });
  }

  // 4. Verify redirect_uri matches a registered URI. Loopback clients may
  // register port 0 and bind a random runtime port on 127.0.0.1 or [::1].
  const redirectUris = await getRedirectUris(clientData);
  if (!redirectUris.some(entry => redirectUriMatches(redirectUri, entry.redirect_uri))) {
    throw new OAuthError(400, 'invalid_redirect', 'redirect_uri 不匹配', {
      error: 'invalid_redirect',
      description: 'redirect_uri 不匹配'
    });
  }

  // 5. PKCE validation (RFC 7636)
  const clientRequiresPkce = clientData.require_pkce === 1 || clientData.require_pkce === true || clientData.client_type === 'public';
  if (clientRequiresPkce) {
    if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      throw new OAuthError(400, 'invalid_request', '该客户端要求 PKCE，缺少 code_challenge', {
        error: 'invalid_request',
        description: '该客户端要求 PKCE，缺少 code_challenge'
      });
    }
    if (codeChallengeMethod !== 'S256') {
      throw new OAuthError(400, 'invalid_request', '仅支持 S256 code_challenge_method', {
        error: 'invalid_request',
        description: '仅支持 S256 code_challenge_method'
      });
    }
  } else if (codeChallenge) {
    if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      throw new OAuthError(400, 'invalid_request', '仅支持 S256 code_challenge_method', {
        error: 'invalid_request',
        description: '仅支持 S256 code_challenge_method'
      });
    }
  }
  const effectivePkceMethod = 'S256';

  // 6. Validate scope
  const requested = requestedScopes(scope, clientData);
  const requestedScope = requested.join(' ');

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

  const [authorizationRows] = await pool.execute(
    'SELECT scope FROM authorizations WHERE user_id = ? AND client_id = ? LIMIT 1',
    [user.id, clientId],
  );
  const previouslyGranted = new Set(String(authorizationRows[0]?.scope || '').split(/\s+/).filter(Boolean));
  const newScopes = requested.filter(item => !previouslyGranted.has(item));
  const missingConsent = newScopes.length > 0;
  let developerName = null;
  if (clientData.owner_user_id) {
    const [ownerRows] = await pool.execute('SELECT username FROM users WHERE id = ? LIMIT 1', [clientData.owner_user_id]);
    developerName = ownerRows[0]?.username || null;
  }
  if (previewOnly) {
    return {
      consentRequired: missingConsent,
      client: { client_id: clientData.client_id, name: clientData.name, description: clientData.description || null,
        website_url: clientData.website_url || null, client_type: clientData.client_type, party_type: clientData.party_type,
        developer_name: developerName, owner_user_id: clientData.owner_user_id || null,
        developer_url: clientData.owner_user_id ? forumProfileUrl(clientData.owner_user_id) : null },
      requestedScopes: requested,
      newScopes,
      previousScopes: [...previouslyGranted],
    };
  }
  if (missingConsent && !consentGranted) {
    return {
      consentRequired: true,
      client: { client_id: clientData.client_id, name: clientData.name, description: clientData.description || null,
        website_url: clientData.website_url || null, client_type: clientData.client_type, party_type: clientData.party_type,
        developer_name: developerName, owner_user_id: clientData.owner_user_id || null,
        developer_url: clientData.owner_user_id ? forumProfileUrl(clientData.owner_user_id) : null },
      requestedScopes: requested,
      newScopes,
    };
  }

  // 8. Generate authorization code
  const code = generateShortToken();
  const effectiveScope = requestedScope;

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

async function denyAuthorization({ clientId, redirectUri, state }) {
  if (!clientId || !redirectUri) throw new OAuthError(400, 'invalid_request', '缺少必需参数');
  const client = await lookupClient(clientId);
  const redirectUris = await getRedirectUris(client);
  if (!redirectUris.some(entry => redirectUriMatches(redirectUri, entry.redirect_uri))) {
    throw new OAuthError(400, 'invalid_redirect', 'redirect_uri 不匹配');
  }
  const destination = new URL(redirectUri);
  destination.searchParams.set('error', 'access_denied');
  destination.searchParams.set('error_description', '用户拒绝了授权请求');
  if (state) destination.searchParams.set('state', state);
  return { redirectTo: destination.toString() };
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
  const clientData = await verifyClient(clientId, clientSecret, { allowPublic: true });

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
  if (!redirectUri || redirectUri !== codeData.redirect_uri) {
    throw new OAuthError(401, 'invalid_grant', 'redirect_uri 不匹配');
  }
  const registeredUris = await getRedirectUris(clientData);
  if (!registeredUris.some(entry => redirectUriMatches(redirectUri, entry.redirect_uri))) {
    throw new OAuthError(401, 'invalid_grant', 'redirect_uri 已不再注册');
  }

  // 5. PKCE verification (if the code was issued with a challenge)
  if (clientData.client_type === 'public' && !codeData.code_challenge) {
    throw new OAuthError(401, 'invalid_grant', 'Public Client 授权码必须使用 PKCE S256');
  }
  if (codeData.code_challenge) {
    if (typeof codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
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
    'SELECT id, username, email, phone_verified, phone_verified_at, created_at, ban_status FROM users WHERE id = ?',
    [codeData.user_id]
  );
  const user = userRows[0];
  if (!user) {
    throw new OAuthError(401, 'invalid_grant', '授权用户不存在');
  }
  if (user.ban_status === 'banned') {
    throw new OAuthError(401, 'invalid_grant', '用户已被封禁');
  }

  // 7. Generate tokens
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const refreshExpiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  const effectiveScope = codeData.scope || 'openid profile email';
  const approved = new Set(normalizeScopes(clientData.approved_scopes, LEGACY_DEFAULT_SCOPES));
  if (effectiveScope.split(/\s+/).some(value => !approved.has(value))) {
    throw new OAuthError(401, 'invalid_grant', '授权码包含未批准的 scope');
  }

  // 8. Store access token in Redis (with per-user/client index)
  await tokenStore.storeAccessToken(accessToken, {
    user_id: user.id,
    client_id: clientId,
    scope: effectiveScope,
    token_type: 'Bearer',
    client_type: clientData.client_type || 'confidential',
    party_type: clientData.party_type || 'first_party',
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
  const clientData = await verifyClient(clientId, clientSecret, { allowPublic: true });

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
      if (row.revoked === 1 || row.revoked === true) {
        console.warn(`Replay attack detected for user ${row.user_id}, client ${clientId}`);
        await conn.execute(
          'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?',
          [row.user_id, clientId]
        );
        storedToken = { replay: true };
        return;
      }

      // Check expiry
      if (new Date(row.expires_at) <= new Date()) {
        throw new Error('TOKEN_EXPIRED');
      }

      storedToken = row;

      // Get user info (within transaction for consistency)
      const [userRows] = await conn.execute(
        'SELECT id, username, email, phone_verified, phone_verified_at, created_at, ban_status FROM users WHERE id = ?',
        [row.user_id]
      );
      user = userRows[0];
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }
      if (user.ban_status === 'banned') {
        throw new Error('USER_BANNED');
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
    if (txErr.message === 'USER_NOT_FOUND' || txErr.message === 'USER_BANNED') {
      throw new OAuthError(401, 'invalid_grant', txErr.message === 'USER_BANNED' ? '用户已被封禁' : '用户不存在');
    }
    throw txErr;
  }

  if (storedToken?.replay) throw new OAuthError(401, 'invalid_grant', '无效或已过期的 refresh_token');
  if (storedToken?.scope && storedToken.scope.split(/\s+/).some(value => !normalizeScopes(clientData.approved_scopes, LEGACY_DEFAULT_SCOPES).includes(value))) {
    throw new OAuthError(401, 'invalid_grant', '此客户端的授权 scope 已变更');
  }

  // 3. Store access token in Redis (outside transaction — Redis is not transactional with MySQL)
  const accessToken = generateToken();
  const effectiveScope = storedToken.scope || 'openid profile email';

  await tokenStore.storeAccessToken(accessToken, {
    user_id: user.id,
    client_id: clientId,
    scope: effectiveScope,
    token_type: 'Bearer',
    client_type: clientData.client_type || 'confidential',
    party_type: clientData.party_type || 'first_party',
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
  const requester = await verifyClient(clientId, clientSecret);
  const trustedResourceServer = requester.client_type === 'confidential' && requester.party_type === 'first_party';

  // 2. Check if it's an access token (Redis). RFC 7662: only reveal tokens
  // that belong to the requesting client — otherwise a client could probe
  // other clients' tokens.
  const tokenData = await tokenStore.getAccessToken(token);
  if (tokenData && (tokenData.client_id === clientId || trustedResourceServer)) {
    try {
      await assertClientActive(tokenData.client_id);
      await assertUserNotBanned(tokenData.user_id);
      await assertNativeSessionActive(tokenData.native_session_id);
    } catch (err) {
      if (err instanceof OAuthError) return { active: false };
      throw err;
    }
    const ttl = await tokenStore.getAccessTokenTtl(token);
    return {
      active: true,
      token_type: 'Bearer',
      scope: tokenData.scope,
      client_id: tokenData.client_id,
      sub: String(tokenData.user_id),
      client_type: tokenData.client_type || 'confidential',
      party_type: tokenData.party_type || 'first_party',
      exp: Math.floor(Date.now() / 1000) + Math.max(ttl, 0),
    };
  }

  // 3. Check if it's a refresh token belonging to this client (MySQL, hashed)
  const [refreshRows] = await pool.execute(
    `SELECT * FROM refresh_tokens WHERE token = ? ${trustedResourceServer ? '' : 'AND client_id = ?'}
      AND revoked = 0 AND expires_at > ?`,
    trustedResourceServer
      ? [hashRefreshToken(token), formatMySQLDateTime()]
      : [hashRefreshToken(token), clientId, formatMySQLDateTime()],
  );
  const refreshToken = refreshRows[0];
  if (refreshToken && (refreshToken.client_id === clientId || trustedResourceServer)) {
    try {
      await assertClientActive(refreshToken.client_id);
      await assertUserNotBanned(refreshToken.user_id);
      await assertNativeSessionActive(refreshToken.native_session_id);
    } catch (err) {
      if (err instanceof OAuthError) return { active: false };
      throw err;
    }
    const resourceClient = await lookupClient(refreshToken.client_id);
    return {
      active: true,
      token_type: 'refresh_token',
      scope: refreshToken.scope || 'openid profile email',
      client_id: refreshToken.client_id,
      sub: String(refreshToken.user_id),
      client_type: resourceClient.client_type || 'confidential',
      party_type: resourceClient.party_type || 'first_party',
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
  await verifyClient(clientId, clientSecret, { allowPublic: true });

  // 2. Try to revoke access token (Redis) — only if it belongs to this client,
  // so a client cannot revoke another client's tokens (RFC 7009 §2.1)
  const accessTokenData = await tokenStore.getAccessToken(token);
  if (accessTokenData) {
    if (accessTokenData.client_id === clientId) {
      await tokenStore.revokeAccessToken(token);
    }
    // Per RFC 7009 always return success, even when we decline to revoke
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
  await assertClientActive(tokenData.client_id);
  await assertUserNotBanned(tokenData.user_id);
  await assertNativeSessionActive(tokenData.native_session_id);

  const scope = new Set(String(tokenData.scope || 'openid profile email').split(/\s+/).filter(Boolean));

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

  if (scope.has('profile')) {
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

  if (scope.has('email')) {
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
  await assertClientActive(tokenData.client_id);
  await assertUserNotBanned(tokenData.user_id);
  await assertNativeSessionActive(tokenData.native_session_id);

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
    SELECT a.client_id, a.scope, a.last_used_at, a.created_at, c.name, c.name AS client_name,
           c.client_type, c.party_type
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

// ─── Device Authorization (RFC 8628) ──────────────────────────

const DEVICE_CODE_TTL_S = parseInt(process.env.MINDAUTH_DEVICE_CODE_TTL_SECONDS) || 900; // 15 minutes
const DEVICE_POLL_INTERVAL_S = parseInt(process.env.MINDAUTH_DEVICE_POLL_INTERVAL_SECONDS) || 5;
const VERIFICATION_URI = process.env.MINDAUTH_VERIFICATION_URI || process.env.BASE_URL || 'http://localhost:4001';

// User code character set: excludes 0, O, 1, I to avoid confusion
const USER_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const USER_CODE_MAX_RETRIES = 10;

/**
 * Generate a user code in the format LL-XXXX-XXXX.
 *
 * @returns {string}
 */
function generateUserCode() {
  const bytes = crypto.randomBytes(8);
  let code = 'LL-';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += USER_CODE_CHARSET[bytes[i] % USER_CODE_CHARSET.length];
  }
  return code;
}

/**
 * Issue a device authorization code (RFC 8628 §3.1).
 *
 * @param {object} params
 * @param {string} params.clientId
 * @param {string} [params.scope]
 * @returns {Promise<{ deviceCode: string, userCode: string, verificationUri: string, verificationUriComplete: string, expiresIn: number, interval: number }>}
 */
async function issueDeviceCode({ clientId, scope }) {
  // 1. Validate client
  const clientData = await lookupClient(clientId);

  // Device Flow obeys the same registered scope ceiling as Authorization Code.
  const effectiveScope = requestedScopes(scope, clientData).join(' ');

  // 3. Generate device code (32 bytes hex)
  const deviceCode = crypto.randomBytes(32).toString('hex');

  // 4. Generate user code with collision retry
  let userCode;
  for (let i = 0; i < USER_CODE_MAX_RETRIES; i++) {
    userCode = generateUserCode();
    const existing = await tokenStore.getDeviceCodeByUserCode(userCode);
    if (!existing) break;
    if (i === USER_CODE_MAX_RETRIES - 1) {
      throw new OAuthError(500, 'server_error', '无法生成用户码，请重试');
    }
  }

  // 5. Store device code in Redis
  const deviceData = {
    client_id: clientId,
    user_code: userCode,
    scope: effectiveScope,
    user_id: null,
    approved: false,
    created_at: Date.now(),
  };
  await tokenStore.storeDeviceCode(deviceCode, deviceData, DEVICE_CODE_TTL_S);

  // 6. Store user code mapping
  await tokenStore.storeUserCode(userCode, deviceCode, DEVICE_CODE_TTL_S);

  // 7. Build response
  const verificationUri = `${VERIFICATION_URI.replace(/\/+$/, '')}/device`;
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn: DEVICE_CODE_TTL_S,
    interval: DEVICE_POLL_INTERVAL_S,
  };
}

/**
 * Look up a device code by user code (for the verify page).
 *
 * @param {object} params
 * @param {string} params.userCode
 * @returns {Promise<object|null>} Device code data or null.
 */
async function getDeviceCodeByUserCode({ userCode }) {
  const deviceCode = await tokenStore.getDeviceCodeByUserCode(userCode);
  if (!deviceCode) return null;

  const deviceData = await tokenStore.getDeviceCode(deviceCode);
  if (!deviceData) return null;

  return { deviceCode, ...deviceData };
}

/**
 * Approve a device authorization request.
 *
 * @param {object} params
 * @param {string} params.userCode
 * @param {number} params.userId
 * @returns {Promise<boolean>}
 */
async function approveDeviceCode({ userCode, userId }) {
  const deviceCode = await tokenStore.getDeviceCodeByUserCode(userCode);
  if (!deviceCode) return false;

  const deviceData = await tokenStore.getDeviceCode(deviceCode);
  if (!deviceData) return false;

  // Calculate remaining TTL
  const elapsed = Math.floor((Date.now() - deviceData.created_at) / 1000);
  const remainingTtl = Math.max(0, DEVICE_CODE_TTL_S - elapsed);

  // Update device code with user_id and approved flag
  deviceData.user_id = userId;
  deviceData.approved = true;
  await tokenStore.updateDeviceCode(deviceCode, deviceData, remainingTtl);

  return true;
}

/**
 * Deny a device authorization request.
 *
 * @param {object} params
 * @param {string} params.userCode
 * @returns {Promise<boolean>}
 */
async function denyDeviceCode({ userCode }) {
  const deviceCode = await tokenStore.getDeviceCodeByUserCode(userCode);
  if (!deviceCode) return false;

  await tokenStore.deleteDeviceCode(deviceCode);
  await tokenStore.deleteUserCode(userCode);

  return true;
}

/**
 * Exchange a device code for tokens (RFC 8628 §3.4).
 *
 * @param {object} params
 * @param {string} params.clientId
 * @param {string} params.deviceCode
 * @returns {Promise<{ access_token: string, refresh_token: string, token_type: string, expires_in: number, scope: string }>}
 */
async function exchangeDeviceToken({ clientId, deviceCode }) {
  // 1. Verify client exists (no secret required for public clients)
  const clientData = await lookupClient(clientId);

  // 2. Look up device code
  const deviceData = await tokenStore.getDeviceCode(deviceCode);
  if (!deviceData) {
    throw new OAuthError(400, 'expired_token', '设备码已过期');
  }

  // 3. Verify client_id matches
  if (deviceData.client_id !== clientId) {
    throw new OAuthError(400, 'invalid_grant', '设备码与 client_id 不匹配');
  }

  // 4. Check if approved
  if (!deviceData.approved) {
    throw new OAuthError(400, 'authorization_pending', '等待用户授权');
  }

  // Consume only after approval checks, atomically with the Redis delete.
  // This prevents concurrent polls from redeeming the same device code.
  const consumedData = await tokenStore.consumeApprovedDeviceCode(deviceCode, clientId);
  if (!consumedData) {
    throw new OAuthError(400, 'expired_token', '设备码已过期或已使用');
  }
  const effectiveDeviceData = consumedData;

  // 5. Check if denied (approved but no user_id means denied)
  if (!effectiveDeviceData.user_id) {
    await tokenStore.deleteUserCode(effectiveDeviceData.user_code);
    throw new OAuthError(400, 'access_denied', '用户拒绝授权');
  }

  // 6. Get user info
  const [userRows] = await pool.execute(
    'SELECT id, username, email, phone_verified, phone_verified_at, created_at FROM users WHERE id = ?',
    [effectiveDeviceData.user_id]
  );
  const user = userRows[0];
  if (!user) {
    throw new OAuthError(400, 'access_denied', '用户不存在');
  }

  // 7. Generate tokens (reuse existing token issuance logic)
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const refreshExpiresAt = formatMySQLDateTimeFromMs(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  const effectiveScope = effectiveDeviceData.scope || 'openid profile email';

  // 8. Store access token in Redis
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

  // 10. Delete the user-code mapping after successful token issuance.
  await tokenStore.deleteUserCode(effectiveDeviceData.user_code);

  // 11. Upsert authorization record
  await pool.execute(`
    INSERT INTO authorizations (user_id, client_id, scope, last_used_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE last_used_at = CURRENT_TIMESTAMP, scope = ?
  `, [user.id, clientId, effectiveScope, effectiveScope]);

  // 12. Return RFC 6749 compliant response
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_EXPIRY_MS / 1000,
    scope: effectiveScope,
  };
}

// ─── Exports ──────────────────────────────────────────────────

module.exports = {
  OAuthError,
  issueNativeTokens,
  refreshNative,
  revokeNativeSession,
  authorize,
  denyAuthorization,
  exchangeCode,
  refresh,
  introspect,
  revoke,
  userinfo,
  userByAccessToken,
  listAuthorizations,
  revokeAuthorization,
  verify,
  issueDeviceCode,
  getDeviceCodeByUserCode,
  approveDeviceCode,
  denyDeviceCode,
  exchangeDeviceToken,
  // Exposed for cross-route use (e.g. SLO logout endpoint)
  lookupClient,
  // Pure contract helpers are exported so security boundaries stay unit-testable.
  _verifyPkce: verifyPkce,
  _redirectUriMatches: redirectUriMatches,
  _requestedScopes: requestedScopes,
};
