const { client } = require('../redis');
const { getClientIp } = require('../utils/request');

// Local memory fallback for rate limiting when Redis unavailable
const localRateLimitStore = new Map();

function createRateLimiter(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const windowMs = options.windowMs || 5 * 60 * 1000; // 5 minutes
  const keyPrefix = options.keyPrefix;

  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    throw new Error('maxAttempts must be a positive number');
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('windowMs must be a positive number');
  }
  // Each limiter must have its own counter namespace — a shared default key
  // lets unrelated endpoints consume (or reset) each other's budget.
  if (!keyPrefix || typeof keyPrefix !== 'string') {
    throw new Error('keyPrefix is required and must be unique per limiter');
  }

  return async function rateLimit(req, res, next) {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;

    try {
      // Try Redis first
      const count = await client.incr(key);

      if (count === 1) {
        try {
          await client.pExpire(key, windowMs);
        } catch (err) {
          // Never leave a counter without TTL — that would 429 this IP forever
          await client.del(key).catch(() => {});
          throw err;
        }
      }

      if (count > maxAttempts) {
        const ttl = await client.ttl(key);
        const waitTime = ttl + 1;
        return res.status(429).json({
          success: false,
          message: `尝试次数过多，请${waitTime}秒后重试`
        });
      }

      next();
    } catch (err) {
      console.error('Rate limit Redis error, using memory fallback:', err.message);

      // Memory fallback when Redis unavailable
      const now = Date.now();

      // Prune expired entries so the fallback Map cannot grow unbounded
      if (localRateLimitStore.size > 1000) {
        for (const [k, v] of localRateLimitStore) {
          if (now > v.expiresAt) localRateLimitStore.delete(k);
        }
      }

      const entry = localRateLimitStore.get(key);

      if (!entry || now > entry.expiresAt) {
        // New window
        localRateLimitStore.set(key, { count: 1, expiresAt: now + windowMs });
        return next();
      }

      if (entry.count >= maxAttempts) {
        const waitTime = Math.ceil((entry.expiresAt - now) / 1000);
        return res.status(429).json({
          success: false,
          message: `尝试次数过多，请${waitTime}秒后重试`
        });
      }

      entry.count++;
      next();
    }
  };
}

async function resetRateLimit(ip, keyPrefix) {
  if (!keyPrefix) throw new Error('resetRateLimit requires the keyPrefix of the limiter to reset');
  const key = `${keyPrefix}:${ip}`;
  await client.del(key);
}

async function getRateLimitStatus(ip, keyPrefix) {
  if (!keyPrefix) throw new Error('getRateLimitStatus requires a keyPrefix');
  const key = `${keyPrefix}:${ip}`;
  const count = await client.get(key);
  const ttl = await client.ttl(key);
  return {
    count: parseInt(count) || 0,
    ttl: ttl
  };
}

module.exports = { createRateLimiter, resetRateLimit, getRateLimitStatus };