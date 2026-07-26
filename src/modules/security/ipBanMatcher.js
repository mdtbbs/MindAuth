/**
 * ipBanMatcher — Centralized IP ban matching module.
 *
 * Single seam for checking whether an IP is banned, with Redis-backed
 * caching and support for both exact-match and CIDR subnet matching.
 *
 * Design invariants:
 *   - Cache lives in Redis (shared across processes) with a 5-min TTL.
 *   - Expired bans (expires_at in the past) are skipped at match time.
 *   - CIDR + exact matching support BOTH IPv4 and IPv6 (128-bit via BigInt).
 *   - Cross-family comparisons never match (v4 client vs v6 ban → false).
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
 * Retained for backward compatibility / tests. Returns 0 on malformed input.
 * @param {string} ip
 * @returns {number}
 */
function ipToLong(ip) {
  const n = ipv4ToBigInt(ip);
  return n === null ? 0 : Number(n);
}

/** Parse dotted-quad IPv4 → BigInt (32-bit), or null if invalid. */
function ipv4ToBigInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = (n << 8n) + BigInt(o);
  }
  return n;
}

/** Parse IPv6 (incl. `::` compression and embedded IPv4) → BigInt (128-bit), or null. */
function ipv6ToBigInt(ip) {
  ip = ip.split('%')[0]; // drop zone id (e.g. fe80::1%eth0)

  // Convert a trailing embedded IPv4 (e.g. ::ffff:192.168.0.1) into two hextets
  const v4 = ip.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const v4n = ipv4ToBigInt(v4[1]);
    if (v4n === null) return null;
    const hi = (v4n >> 16n) & 0xffffn;
    const lo = v4n & 0xffffn;
    ip = ip.slice(0, v4.index) + hi.toString(16) + ':' + lo.toString(16);
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];

  let groups;
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(parseInt(g, 16));
  }
  return n;
}

/** Parse any IP → { fam: 4|6, n: BigInt } or null. */
function parseIp(ip) {
  if (typeof ip !== 'string') return null;
  if (ip.includes(':')) {
    const n = ipv6ToBigInt(ip);
    return n === null ? null : { fam: 6, n };
  }
  if (ip.includes('.')) {
    const n = ipv4ToBigInt(ip);
    return n === null ? null : { fam: 4, n };
  }
  return null;
}

/**
 * Check whether `clientIp` falls within the subnet defined by
 * `networkIp` + `prefix` (CIDR notation). Supports IPv4 and IPv6.
 * When prefix is null/undefined the match is exact (single host).
 * Different address families never match; unparseable input never matches.
 *
 * @param {string} clientIp
 * @param {string} networkIp
 * @param {number|null} prefix
 * @returns {boolean}
 */
function isInSubnet(clientIp, networkIp, prefix) {
  const c = parseIp(clientIp);
  const net = parseIp(networkIp);
  if (!c || !net || c.fam !== net.fam) return false;

  if (prefix === null || prefix === undefined) {
    return c.n === net.n; // normalized exact match (e.g. ::1 === 0:0:...:1)
  }

  const bits = c.fam === 4 ? 32 : 128;
  const p = Number(prefix);
  if (!Number.isInteger(p) || p < 0 || p > bits) return false;
  const mask = p === 0 ? 0n : (((1n << BigInt(p)) - 1n) << BigInt(bits - p));
  return (c.n & mask) === (net.n & mask);
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
