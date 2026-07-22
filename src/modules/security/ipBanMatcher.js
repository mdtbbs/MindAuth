/**
 * ipBanMatcher — Centralized IP ban matching module.
 *
 * Single seam for checking whether an IP is banned, with Redis-backed
 * caching and support for both exact-match and CIDR subnet matching.
 *
 * Design invariants:
 *   - Cache lives in Redis (shared across processes) with a 5-min TTL.
 *   - Expired bans (expires_at in the past) are skipped at match time.
 *   - CIDR matching uses bitwise operations on IPv4 addresses only.
 *   - All failures are caught and logged — ban check must never crash
 *     the request pipeline.
 *
 * Middleware and admin routes consume this module; no other code should
 * read ip_bans directly.
 */

const { pool } = require('../../db');
const { client } = require('../../redis');

// ─── Constants ────────────────────────────────────────────────

const CACHE_KEY = 'ip_bans_cache';
const CACHE_TTL = 300; // 5 minutes

// ─── Internal helpers ────────────────────────────────────────

/**
 * Convert dotted-quad IPv4 to 32-bit unsigned integer.
 * @param {string} ip
 * @returns {number}
 */
function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Check whether `clientIp` falls within the subnet defined by
 * `networkIp` + `prefix` (CIDR notation).
 *
 * When prefix is null/undefined the match is exact (single host).
 *
 * @param {string} clientIp
 * @param {string} networkIp
 * @param {number|null} prefix
 * @returns {boolean}
 */
function isInSubnet(clientIp, networkIp, prefix) {
  if (prefix === null || prefix === undefined) {
    return clientIp === networkIp;
  }
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToLong(clientIp) & mask) === (ipToLong(networkIp) & mask);
}

/**
 * Load all IP ban records from MySQL.
 * @returns {Promise<Array>}
 */
async function loadIpBans() {
  const [rows] = await pool.execute(
    'SELECT ip_address, cidr_prefix, reason, expires_at FROM ip_bans'
  );
  return rows;
}

// ─── Cache layer ─────────────────────────────────────────────

/**
 * Retrieve the ban list from Redis cache, falling back to MySQL.
 * @returns {Promise<Array>}
 */
async function getIpBanCache() {
  const cached = await client.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const bans = await loadIpBans();
  await client.setEx(CACHE_KEY, CACHE_TTL, JSON.stringify(bans));
  return bans;
}

// ─── Public interface ────────────────────────────────────────

/**
 * Check if an IP address is currently banned.
 *
 * @param {string} ip - Client IP to check
 * @returns {Promise<{ banned: boolean, reason?: string }>}
 */
async function isBanned(ip) {
  try {
    const bans = await getIpBanCache();
    const now = new Date();

    for (const ban of bans) {
      // Skip expired bans
      if (ban.expires_at && new Date(ban.expires_at) < now) continue;

      if (isInSubnet(ip, ban.ip_address, ban.cidr_prefix)) {
        return { banned: true, reason: ban.reason || undefined };
      }
    }

    return { banned: false };
  } catch (err) {
    console.warn('[IPBanMatcher] isBanned check failed:', err.message);
    // Fail open — don't block requests on cache/DB errors
    return { banned: false };
  }
}

/**
 * Refresh the ban cache by clearing Redis and re-loading from DB.
 * Useful after admin create/update/delete operations.
 *
 * @returns {Promise<void>}
 */
async function refreshCache() {
  await client.del(CACHE_KEY);
}

/**
 * Clear the ban cache without reloading.
 *
 * @returns {Promise<void>}
 */
async function clearCache() {
  await client.del(CACHE_KEY);
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = {
  isBanned,
  refreshCache,
  clearCache,
  // Exposed for testing
  _ipToLong: ipToLong,
  _isInSubnet: isInSubnet,
  _loadIpBans: loadIpBans,
};
