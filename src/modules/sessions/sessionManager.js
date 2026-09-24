/**
 * sessionManager — Centralized session lifecycle module.
 *
 * This is the ONLY seam for creating, authenticating, touching, and revoking
 * both user and admin sessions.  No other code should read/write session data
 * directly from MySQL or Redis.
 *
 * Design invariants:
 *   - user_sessions (MySQL) is the durable user-session source of truth
 *   - users.session_token is NOT read or written
 *   - Token hashes (SHA-256) stored in DB; raw tokens only in cookies
 *   - Redis is cache + index, not the sole durable state
 *   - Admin sessions re-check DB role/ban/lock on every request
 */

const crypto = require('crypto');
const { pool } = require('../../db');
const { client } = require('../../redis');
const { parseDeviceInfo } = require('../../utils/deviceInfo');
const tokenStore = require('../oauth/tokenStore');

// ─── Constants ────────────────────────────────────────────────

const SESSION_CACHE_TTL = 86400;           // 24 h Redis cache
const SESSION_LIFETIME_MS = 30 * 86400000; // 30 days
const ADMIN_SESSION_TTL = 86400;           // 24 h Redis cache
const ADMIN_SESSION_LIFETIME_MS = 86400000; // 1 day
const TOUCH_THROTTLE_S = 300;              // 5 min between last_active_at updates

// Admin roles (must match ROLE_PERMISSIONS keys in requireAdmin)
const ADMIN_ROLES = ['admin', 'super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin'];

// ─── Token utilities ──────────────────────────────────────────

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ─── User sessions ────────────────────────────────────────────

/**
 * Create a new user session.
 *
 * @param {{ userId: number, ipAddress?: string, userAgent?: string, remember?: boolean }} opts
 * @returns {Promise<{ token: string, expiresAt: Date, sessionId: number }>}
 *   `token` is the raw value to set as a cookie.
 */
async function createUserSession({ userId, ipAddress, userAgent, remember }) {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const deviceInfo = parseDeviceInfo(userAgent);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

  // 1. Insert into MySQL (durable store) — token_hash stored, never raw token.
  // expires_at uses DB time (NOW()) so SQL-side expiry checks are consistent
  // regardless of the app server's timezone.
  const [result] = await pool.execute(
    `INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, device_info, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [userId, tokenHash, ipAddress || null, (userAgent || '').slice(0, 500), deviceInfo, Math.floor(SESSION_LIFETIME_MS / 1000)]
  );
  const sessionId = result.insertId;

  // 2. Fetch user data for Redis cache (exclude password_hash)
  const [userRows] = await pool.execute(
    `SELECT id, username, email, email_verified, role, avatar_url, banner_url,
            phone, phone_verified, phone_verified_at, created_at
     FROM users WHERE id = ?`,
    [userId]
  );
  if (!userRows[0]) {
    throw new Error(`createUserSession: user ${userId} not found`);
  }

  // 3. Cache in Redis by hashed token (expiry travels with the payload so
  // cache hits still enforce the absolute session lifetime)
  const cachePayload = { ...userRows[0], session_id: sessionId, session_expires_at: expiresAt.toISOString() };
  await client.setEx(`session:${tokenHash}`, SESSION_CACHE_TTL, JSON.stringify(cachePayload));

  // 4. Add to per-user index set (for bulk invalidation without SCAN)
  await client.sAdd(`sessions_by_user:${userId}`, String(sessionId));

  return { token: rawToken, expiresAt, sessionId };
}

/**
 * Authenticate a user session by raw token.
 *
 * Lookup order: Redis cache → MySQL fallback.
 * Returns `null` when the session is invalid or expired.
 *
 * @param {string} rawToken - raw token from cookie
 * @returns {Promise<{ user: object, session: { id: number } } | null>}
 */
async function authenticateUserSession(rawToken) {
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);

  // 1. Check Redis cache. A Redis outage must not 500 every authenticated
  // request — degrade to the MySQL lookup below (same path as a cache miss).
  let cached = null;
  try {
    cached = await client.get(`session:${tokenHash}`);
  } catch (err) {
    console.warn('[SessionManager] Redis unavailable, falling back to MySQL:', err.message);
  }
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Enforce absolute lifetime even on cache hits
      if (parsed.session_expires_at && new Date(parsed.session_expires_at) <= new Date()) {
        await client.del(`session:${tokenHash}`).catch(() => {});
        return null;
      }
      // Sanity check: must have phone_verified field (guards against stale/malformed cache)
      if (Object.prototype.hasOwnProperty.call(parsed, 'phone_verified')) {
        return {
          user: parsed,
          session: { id: parsed.session_id },
        };
      }
    } catch { /* fall through to MySQL */ }
  }

  // 2. Fallback to MySQL — lookup by hash, rejecting expired sessions.
  // (expires_at IS NULL tolerates rows created before the 002 migration ran.)
  const [rows] = await pool.execute(
    `SELECT id, user_id, expires_at FROM user_sessions
     WHERE session_token = ? AND (expires_at IS NULL OR expires_at > NOW())`,
    [tokenHash]
  );
  if (!rows[0]) return null;

  const sessionRow = rows[0];

  // 3. Fetch user data
  const [userRows] = await pool.execute(
    `SELECT id, username, email, email_verified, role, avatar_url, banner_url,
            phone, phone_verified, phone_verified_at, created_at
     FROM users WHERE id = ?`,
    [sessionRow.user_id]
  );
  if (!userRows[0]) return null;

  // 4. Re-populate Redis cache (best effort — MySQL already authenticated us)
  const cachePayload = {
    ...userRows[0],
    session_id: sessionRow.id,
    session_expires_at: sessionRow.expires_at ? new Date(sessionRow.expires_at).toISOString() : null,
  };
  await client.setEx(`session:${tokenHash}`, SESSION_CACHE_TTL, JSON.stringify(cachePayload))
    .catch(err => console.warn('[SessionManager] session cache write failed:', err.message));

  return {
    user: userRows[0],
    session: { id: sessionRow.id },
  };
}

/**
 * Throttled update of last_active_at.
 * Fire-and-forget — safe to call on every authenticated request.
 *
 * @param {number} sessionId
 */
async function touchUserSession(sessionId) {
  if (!sessionId) return;
  try {
    const throttleKey = `session_active:${sessionId}`;
    const exists = await client.get(throttleKey);
    if (exists) return;

    await client.setEx(throttleKey, TOUCH_THROTTLE_S, '1');
    pool.execute(
      'UPDATE user_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?',
      [sessionId]
    ).catch(err => console.warn('[SessionManager] touch update failed:', err.message));
  } catch (err) {
    console.warn('[SessionManager] touch error:', err.message);
  }
}

/**
 * Revoke a single user session.
 *
 * Identifies the session by either `token` (raw cookie value) or `sessionId`.
 *
 * @param {{ token?: string, userId: number, sessionId?: number }} opts
 * @returns {Promise<{ revoked: boolean }>}
 */
async function revokeUserSession({ token, userId, sessionId }) {
  if (typeof sessionId === 'string' && sessionId.startsWith('native:')) {
    return revokeNativeClientSession({ sessionId: Number(sessionId.slice(7)), userId });
  }
  let tokenHash = null;
  let resolvedSessionId = sessionId || null;

  // Resolve token → hash, and/or sessionId from the other identifier
  if (token) {
    tokenHash = hashToken(token);
  }

  if (tokenHash && !resolvedSessionId) {
    // Look up sessionId by hash before deleting
    const [idRows] = await pool.execute(
      'SELECT id FROM user_sessions WHERE session_token = ? AND user_id = ?',
      [tokenHash, userId]
    );
    if (idRows[0]) resolvedSessionId = idRows[0].id;
  }

  if (!tokenHash && resolvedSessionId) {
    // Look up hash by sessionId before deleting
    const [hashRows] = await pool.execute(
      'SELECT session_token FROM user_sessions WHERE id = ? AND user_id = ?',
      [resolvedSessionId, userId]
    );
    if (hashRows[0]) tokenHash = hashRows[0].session_token;
  }

  if (!tokenHash && !resolvedSessionId) {
    return { revoked: false };
  }

  // 1. Delete from MySQL (durable store)
  let mysqlDeleted = 0;
  if (resolvedSessionId) {
    const [result] = await pool.execute(
      'DELETE FROM user_sessions WHERE id = ? AND user_id = ?',
      [resolvedSessionId, userId]
    );
    mysqlDeleted = result.affectedRows;
  } else if (tokenHash) {
    const [result] = await pool.execute(
      'DELETE FROM user_sessions WHERE session_token = ? AND user_id = ?',
      [tokenHash, userId]
    );
    mysqlDeleted = result.affectedRows;
  }

  if (mysqlDeleted === 0) {
    return { revoked: false };
  }

  // 2. Delete from Redis cache
  if (tokenHash) {
    await client.del(`session:${tokenHash}`).catch(() => {});
  }

  // 3. Remove from per-user index set
  if (resolvedSessionId) {
    await client.sRem(`sessions_by_user:${userId}`, String(resolvedSessionId)).catch(() => {});
  }

  return { revoked: true };
}

/**
 * Revoke ALL user sessions for a given userId.
 *
 * @param {number} userId
 * @param {{ exceptToken?: string }} [options]
 * @returns {Promise<{ revokedCount: number }>}
 */
async function revokeAllUserSessions(userId, options = {}) {
  const { exceptToken } = options;
  const exceptHash = exceptToken ? hashToken(exceptToken) : null;

  // 1. Get all session hashes + IDs from MySQL for Redis cleanup
  const [sessionRows] = await pool.execute(
    'SELECT id, session_token FROM user_sessions WHERE user_id = ?',
    [userId]
  );

  // 2. Delete all Redis cache keys (parallel, skip exceptToken if set)
  if (sessionRows.length > 0) {
    const deletions = sessionRows
      .filter(r => r.session_token !== exceptHash)
      .map(r => client.del(`session:${r.session_token}`).catch(() => {}));
    if (deletions.length > 0) await Promise.all(deletions);
  }

  // 3. Delete from MySQL
  let revokedCount = 0;
  if (exceptHash) {
    const [result] = await pool.execute(
      'DELETE FROM user_sessions WHERE user_id = ? AND session_token != ?',
      [userId, exceptHash]
    );
    revokedCount = result.affectedRows;
  } else {
    const [result] = await pool.execute(
      'DELETE FROM user_sessions WHERE user_id = ?',
      [userId]
    );
    revokedCount = result.affectedRows;
  }

  // 4. Delete the per-user index set
  await client.del(`sessions_by_user:${userId}`).catch(() => {});

  // Native client credentials are separate device sessions backed by the
  // shared OAuth token store. Password/security revocation must include them.
  const [nativeRows] = await pool.execute('SELECT id FROM native_client_sessions WHERE user_id = ? AND revoked_at IS NULL', [userId]);
  if (nativeRows.length) {
    await pool.execute('UPDATE native_client_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
    await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND native_session_id IS NOT NULL', [userId]);
    await Promise.all(nativeRows.map(({ id }) => tokenStore.revokeAccessTokensForNativeSession(id)));
  }

  return { revokedCount };
}

/**
 * List all active sessions for a user.
 *
 * @param {number} userId
 * @param {string} [currentTokenHash] - hash of the current session token, for is_current flag
 * @returns {Promise<Array<{id, ip_address, device_info, is_current, created_at, last_active_at}>>}
 */
async function listUserSessions(userId, currentTokenHash) {
  const [rows] = await pool.execute(
    `SELECT id, session_token, ip_address, device_info, created_at, last_active_at
     FROM user_sessions WHERE user_id = ? ORDER BY last_active_at DESC`,
    [userId]
  );

  const webSessions = rows.map(s => ({
    id: s.id,
    session_type: 'web',
    ip_address: s.ip_address,
    device_info: s.device_info,
    is_current: currentTokenHash ? s.session_token === currentTokenHash : false,
    created_at: s.created_at,
    last_active_at: s.last_active_at,
  }));
  const [nativeRows] = await pool.execute(
    `SELECT id, client_id, device_name, ip_address, created_at, last_active_at
     FROM native_client_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_active_at DESC`,
    [userId]
  );
  const nativeSessions = nativeRows.map(s => ({
    id: `native:${s.id}`,
    session_type: 'native',
    client_id: s.client_id,
    ip_address: s.ip_address,
    device_info: `${s.client_id === 'mdtbbs-mindustry-mod' ? 'MDTBBS Mindustry Mod' : 'Native Client'} · ${s.device_name}`,
    is_current: false,
    created_at: s.created_at,
    last_active_at: s.last_active_at,
  }));
  return [...webSessions, ...nativeSessions].sort((a, b) => new Date(b.last_active_at) - new Date(a.last_active_at));
}

async function revokeNativeClientSession({ sessionId, userId }) {
  if (!Number.isSafeInteger(Number(sessionId)) || Number(sessionId) <= 0) return { revoked: false };
  const [result] = await pool.execute(
    'UPDATE native_client_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [Number(sessionId), userId]
  );
  if (!result.affectedRows) return { revoked: false };
  await pool.execute('UPDATE refresh_tokens SET revoked = 1 WHERE native_session_id = ?', [Number(sessionId)]);
  await tokenStore.revokeAccessTokensForNativeSession(Number(sessionId));
  return { revoked: true };
}

// ─── Admin sessions ───────────────────────────────────────────

/**
 * Create a new admin session.
 *
 * Admin sessions are short-lived (24 h) and stored in Redis with a per-user
 * index set for efficient bulk invalidation (no SCAN).
 *
 * @param {{ adminId: number, ipAddress?: string, userAgent?: string }} opts
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
async function createAdminSession({ adminId, ipAddress, userAgent }) {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_LIFETIME_MS);

  // Store session data in Redis (admin sessions are short-lived, Redis is sufficient)
  await client.setEx(`admin_session:${tokenHash}`, ADMIN_SESSION_TTL, JSON.stringify({
    user_id: adminId,
    created: Date.now(),
    ip_address: ipAddress || null,
    user_agent: (userAgent || '').slice(0, 500),
  }));

  // Add to per-user admin index set
  await client.sAdd(`admin_sessions_by_user:${adminId}`, tokenHash);

  return { token: rawToken, expiresAt };
}

/**
 * Authenticate an admin session by raw token.
 *
 * Returns the admin user data (with fresh DB role/ban check) or null.
 *
 * @param {string} rawToken
 * @returns {Promise<{ admin: object, session: object } | null>}
 */
async function authenticateAdminSession(rawToken) {
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);

  // 1. Check Redis for admin session data. Admin sessions are Redis-only, so a
  // Redis outage fails closed (401) instead of crashing the request with a 500.
  let sessionData;
  try {
    sessionData = await client.get(`admin_session:${tokenHash}`);
  } catch (err) {
    console.warn('[SessionManager] Redis unavailable for admin session:', err.message);
    return null;
  }
  if (!sessionData) return null;

  let session;
  try {
    session = JSON.parse(sessionData);
  } catch {
    await client.del(`admin_session:${tokenHash}`).catch(() => {});
    return null;
  }

  if (!session.user_id) {
    await client.del(`admin_session:${tokenHash}`).catch(() => {});
    return null;
  }

  // 2. ALWAYS re-check user in DB (role, ban status)
  const [userRows] = await pool.execute(
    'SELECT id, username, email, role, ban_status FROM users WHERE id = ?',
    [session.user_id]
  );
  const user = userRows[0];

  if (!user) {
    await client.del(`admin_session:${tokenHash}`);
    return null;
  }

  // 3. Verify user is still an admin
  const rawRole = String(user.role || '').trim();
  const normalizedRole = rawRole === 'admin' ? 'super_admin'
    : (ADMIN_ROLES.includes(rawRole) ? rawRole : null);

  if (!normalizedRole) {
    // User is no longer admin — invalidate session
    await client.del(`admin_session:${tokenHash}`);
    await client.sRem(`admin_sessions_by_user:${session.user_id}`, tokenHash).catch(() => {});
    return null;
  }

  // 4. Check ban status
  if (user.ban_status === 'banned') {
    await client.del(`admin_session:${tokenHash}`);
    await client.sRem(`admin_sessions_by_user:${session.user_id}`, tokenHash).catch(() => {});
    return null;
  }

  return {
    admin: { ...user, normalized_role: normalizedRole },
    session,
  };
}

/**
 * Revoke all admin sessions for a given user.
 * Uses the per-user Redis index set instead of SCAN.
 *
 * @param {number} userId
 * @returns {Promise<{ revokedCount: number }>}
 */
async function revokeAdminSessionsForUser(userId) {
  const memberKey = `admin_sessions_by_user:${userId}`;
  const tokenHashes = await client.sMembers(memberKey);

  if (tokenHashes.length === 0) return { revokedCount: 0 };

  // Delete all admin session cache keys
  await Promise.all(
    tokenHashes.map(h => client.del(`admin_session:${h}`).catch(() => {}))
  );

  // Delete the index set
  await client.del(memberKey).catch(() => {});

  return { revokedCount: tokenHashes.length };
}

/**
 * Drop the Redis cache entry for one user session so the next request
 * re-reads fresh user data from MySQL. The durable session row is untouched.
 *
 * @param {string} rawToken - raw token from cookie
 */
async function invalidateUserSessionCache(rawToken) {
  if (!rawToken) return;
  await client.del(`session:${hashToken(rawToken)}`);
}

// ─── Exports ──────────────────────────────────────────────────

module.exports = {
  // Token utilities (for testing / internal use)
  hashToken,

  // User sessions
  createUserSession,
  authenticateUserSession,
  touchUserSession,
  revokeUserSession,
  revokeAllUserSessions,
  invalidateUserSessionCache,
  listUserSessions,
  revokeNativeClientSession,

  // Admin sessions
  createAdminSession,
  authenticateAdminSession,
  revokeAdminSessionsForUser,
};
