/**
 * IP Ban Middleware
 *
 * Thin adapter over ipBanMatcher module. Checks incoming request IPs
 * against the ban cache and returns 403 if banned.
 */

const { getClientIp } = require('../utils/request');
const ipBanMatcher = require('../modules/security/ipBanMatcher');

async function ipBanMiddleware(req, res, next) {
  try {
    const clientIp = getClientIp(req);
    const result = await ipBanMatcher.isBanned(clientIp);

    if (result.banned) {
      return res.status(403).json({
        success: false,
        code: 'IP_BANNED',
        message: result.reason || 'IP 已被封禁',
      });
    }
  } catch (err) {
    console.warn('[IPBan] check failed:', err.message);
  }
  next();
}

// Re-export refreshCache as invalidateIpBanCache for backward compat
const invalidateIpBanCache = ipBanMatcher.refreshCache;

module.exports = { ipBanMiddleware, invalidateIpBanCache };
