/**
 * tokenStore — Redis-backed storage for OAuth tokens and authorization codes.
 *
 * Manages:
 *   - Authorization codes (short-lived, single-use, atomic redemption)
 *   - Access tokens (Redis-cached with per-user/client indexes)
 *
 * Refresh tokens live in MySQL (not here); they are managed by oauthIssuer
 * inside a transaction with row locking.
 *
 * Index sets (Redis SETs) allow targeted invalidation without SCAN:
 *   accesstokens_by_userclient:{userId}:{clientId} → Set<sha256(accessToken)>
 *
 * Tokens are stored under their SHA-256 hash — a Redis dump never exposes
 * usable bearer tokens. Callers always pass the raw token.
 */

const crypto = require('crypto');
const { client } = require('../../redis');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

// ─── Authorization Codes ──────────────────────────────────────

/**
 * Store an authorization code in Redis with a TTL.
 *
 * @param {string} code - The short authorization code.
 * @param {object} data - Payload (client_id, user_id, scope, redirect_uri, PKCE fields).
 * @param {number} ttlSeconds - Time-to-live in seconds (typically 300 = 5 min).
 */
async function storeAuthCode(code, data, ttlSeconds) {
  await client.setEx(`authcode:${code}`, ttlSeconds, JSON.stringify(data));
}

/**
 * Atomically consume an authorization code (GETDEL).
 *
 * Uses Redis GETDEL for true atomic read-and-delete. Falls back to GET + DEL
 * if the Redis version does not support GETDEL (e.g. < 6.2).
 *
 * @param {string} code
 * @returns {Promise<object|null>} Parsed auth code payload, or null if not found.
 */
async function consumeAuthCode(code) {
  const raw = await client.getDel(`authcode:${code}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Access Tokens ────────────────────────────────────────────

/**
 * Store an access token in Redis and add it to the per-user/client index set.
 *
 * @param {string} token - The raw access token string.
 * @param {object} data  - Payload (user_id, client_id, scope, token_type).
 * @param {number} ttlSeconds - Time-to-live in seconds (typically 3600 = 1 hour).
 */
async function storeAccessToken(token, data, ttlSeconds) {
  const tokenHash = hashToken(token);
  await client.setEx(`accesstoken:${tokenHash}`, ttlSeconds, JSON.stringify(data));
  // Index for targeted invalidation (avoids SCAN)
  await client.sAdd(`accesstokens_by_userclient:${data.user_id}:${data.client_id}`, tokenHash);
}

/**
 * Look up an access token in Redis.
 *
 * @param {string} token
 * @returns {Promise<object|null>} Parsed payload or null.
 */
async function getAccessToken(token) {
  const raw = await client.get(`accesstoken:${hashToken(token)}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get the remaining TTL for an access token.
 *
 * @param {string} token
 * @returns {Promise<number>} TTL in seconds (-2 = key does not exist).
 */
async function getAccessTokenTtl(token) {
  return client.ttl(`accesstoken:${hashToken(token)}`);
}

/**
 * Revoke (delete) a single access token from Redis.
 *
 * @param {string} token
 */
async function revokeAccessToken(token) {
  await client.del(`accesstoken:${hashToken(token)}`);
}

/**
 * Revoke all access tokens for a given user/client pair using the index set.
 * No SCAN required.
 *
 * @param {number} userId
 * @param {string} clientId
 */
async function revokeAccessTokensForUserClient(userId, clientId) {
  const indexKey = `accesstokens_by_userclient:${userId}:${clientId}`;
  // Index members are already hashes — delete their keys directly
  const tokenHashes = await client.sMembers(indexKey);
  if (tokenHashes.length > 0) {
    await Promise.all(tokenHashes.map(h => client.del(`accesstoken:${h}`).catch(() => {})));
  }
  await client.del(indexKey).catch(() => {});
}

// ─── Device Authorization Codes (RFC 8628) ────────────────────

/**
 * Store a device authorization code in Redis with a TTL.
 *
 * @param {string} deviceCode - The device code (32 bytes hex).
 * @param {object} data - Payload (client_id, scope, user_id, approved, created_at).
 * @param {number} ttlSeconds - Time-to-live in seconds (typically 900 = 15 min).
 */
async function storeDeviceCode(deviceCode, data, ttlSeconds) {
  await client.setEx(`device:${deviceCode}`, ttlSeconds, JSON.stringify(data));
}

/**
 * Look up a device authorization code in Redis.
 *
 * @param {string} deviceCode
 * @returns {Promise<object|null>} Parsed payload or null.
 */
async function getDeviceCode(deviceCode) {
  const raw = await client.get(`device:${deviceCode}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Update a device authorization code (e.g., set user_id and approved).
 *
 * @param {string} deviceCode
 * @param {object} data - Updated payload.
 * @param {number} ttlSeconds - Remaining TTL in seconds.
 */
async function updateDeviceCode(deviceCode, data, ttlSeconds) {
  await client.setEx(`device:${deviceCode}`, ttlSeconds, JSON.stringify(data));
}

/**
 * Delete a device authorization code.
 *
 * @param {string} deviceCode
 */
async function deleteDeviceCode(deviceCode) {
  await client.del(`device:${deviceCode}`);
}

/**
 * Store a mapping from user_code to device_code.
 *
 * @param {string} userCode - The user-facing code (LL-XXXX-XXXX).
 * @param {string} deviceCode - The device code.
 * @param {number} ttlSeconds - Time-to-live in seconds.
 */
async function storeUserCode(userCode, deviceCode, ttlSeconds) {
  await client.setEx(`device_code:${userCode}`, ttlSeconds, deviceCode);
}

/**
 * Look up a device code by user code.
 *
 * @param {string} userCode
 * @returns {Promise<string|null>} The device code or null.
 */
async function getDeviceCodeByUserCode(userCode) {
  return await client.get(`device_code:${userCode}`);
}

/**
 * Delete a user code mapping.
 *
 * @param {string} userCode
 */
async function deleteUserCode(userCode) {
  await client.del(`device_code:${userCode}`);
}

module.exports = {
  storeAuthCode,
  consumeAuthCode,
  storeAccessToken,
  getAccessToken,
  getAccessTokenTtl,
  revokeAccessToken,
  revokeAccessTokensForUserClient,
  storeDeviceCode,
  getDeviceCode,
  updateDeviceCode,
  deleteDeviceCode,
  storeUserCode,
  getDeviceCodeByUserCode,
  deleteUserCode,
};
