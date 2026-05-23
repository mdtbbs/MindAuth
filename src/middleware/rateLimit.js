const { client } = require('../redis');
const { getClientIp } = require('../utils/request');

function createRateLimiter(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const windowMs = options.windowMs || 5 * 60 * 1000; // 5 minutes
  const keyPrefix = options.keyPrefix || 'ratelimit';

  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    throw new Error('maxAttempts must be a positive number');
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('windowMs must be a positive number');
  }

  return async function rateLimit(req, res, next) {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;

    try {
      const count = await client.incr(key);

      if (count === 1) {
        // First attempt, set expiry
        await client.pExpire(key, windowMs);
      }

      if (count > maxAttempts) {
        const ttl = await client.ttl(key);
        const waitTime = ttl + 1; // TTL is in seconds
        return res.status(429).json({
          success: false,
          message: `尝试次数过多，请${waitTime}秒后重试`
        });
      }

      next();
    } catch (err) {
      console.error('Rate limit error:', err);
      // Allow request on Redis error (fail open)
      next();
    }
  };
}

async function resetRateLimit(ip, keyPrefix = 'ratelimit') {
  const key = `${keyPrefix}:${ip}`;
  await client.del(key);
}

async function getRateLimitStatus(ip, keyPrefix = 'ratelimit') {
  const key = `${keyPrefix}:${ip}`;
  const count = await client.get(key);
  const ttl = await client.ttl(key);
  return {
    count: parseInt(count) || 0,
    ttl: ttl
  };
}

module.exports = { createRateLimiter, resetRateLimit, getRateLimitStatus };