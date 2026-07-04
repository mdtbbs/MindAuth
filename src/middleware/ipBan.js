const { pool } = require('../db');
const { client } = require('../redis');
const { getClientIp } = require('../utils/request');

const CACHE_KEY = 'ip_bans_cache';
const CACHE_TTL = 300; // 5 minutes

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isInSubnet(clientIp, networkIp, prefix) {
  if (prefix === null || prefix === undefined) {
    return clientIp === networkIp;
  }
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToLong(clientIp) & mask) === (ipToLong(networkIp) & mask);
}

async function loadIpBans() {
  const [rows] = await pool.execute(
    'SELECT ip_address, cidr_prefix, reason, expires_at FROM ip_bans'
  );
  return rows;
}

async function getIpBanCache() {
  const cached = await client.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const bans = await loadIpBans();
  await client.setEx(CACHE_KEY, CACHE_TTL, JSON.stringify(bans));
  return bans;
}

async function invalidateIpBanCache() {
  await client.del(CACHE_KEY);
}

async function ipBanMiddleware(req, res, next) {
  try {
    const clientIp = getClientIp(req);
    const bans = await getIpBanCache();
    const now = new Date();

    for (const ban of bans) {
      if (ban.expires_at && new Date(ban.expires_at) < now) continue;
      if (isInSubnet(clientIp, ban.ip_address, ban.cidr_prefix)) {
        return res.status(403).json({
          success: false,
          code: 'IP_BANNED',
          message: ban.reason || 'IP 已被封禁',
        });
      }
    }
  } catch (err) {
    console.warn('[IPBan] check failed:', err.message);
  }
  next();
}

module.exports = { ipBanMiddleware, invalidateIpBanCache };
