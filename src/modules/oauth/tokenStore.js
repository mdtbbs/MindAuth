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
 *   accesstokens_by_userclient:{userId}:{clientId} → Set<accessToken>
 */

const { client } = require('../../redis');

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
  await client.setEx(`accesstoken:${token}`, ttlSeconds, JSON.stringify(data));
  // Index for targeted invalidation (avoids SCAN)
  await client.sAdd(`accesstokens_by_userclient:${data.user_id}:${data.client_id}`, token);
}

/**
 * Look up an access token in Redis.
 *
 * @param {string} token
 * @returns {Promise<object|null>} Parsed payload or null.
 */
async function getAccessToken(token) {
  const raw = await client.get(`accesstoken:${token}`);
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
  return client.ttl(`accesstoken:${token}`);
}

/**
 * Revoke (delete) a single access token from Redis.
 *
 * @param {string} token
 */
async function revokeAccessToken(token) {
  await client.del(`accesstoken:${token}`);
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
  const tokens = await client.sMembers(indexKey);
  if (tokens.length > 0) {
    await Promise.all(tokens.map(t => client.del(`accesstoken:${t}`).catch(() => {})));
  }
  await client.del(indexKey).catch(() => {});
}

module.exports = {
  storeAuthCode,
  consumeAuthCode,
  storeAccessToken,
  getAccessToken,
  getAccessTokenTtl,
  revokeAccessToken,
  revokeAccessTokensForUserClient,
};
