const { client } = require('../redis');
const { getClientIp, isTrustedProxy } = require('../utils/request');

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

    // 调试日志：确认IP检测是否正确
    if (process.env.DEBUG_IP_DETECTION === 'true') {
      console.log('[IP Detection]', {
        detected_ip: ip,
        remote_addr: req.connection?.remoteAddress,
        is_trusted_proxy: isTrustedProxy(req),
        headers: {
          'ali-real-client-ip': req.headers['ali-real-client-ip'],
          'x-real-ip': req.headers['x-real-ip'],
          'cf-connecting-ip': req.headers['cf-connecting-ip'],
          'x-forwarded-for': req.headers['x-forwarded-for'],
        }
      });
    }

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
        res.set('Retry-After', String(waitTime));
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: `尝试次数过多，请${waitTime}秒后重试`,
          retry_after_seconds: waitTime
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
        res.set('Retry-After', String(waitTime));
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: `尝试次数过多，请${waitTime}秒后重试`,
          retry_after_seconds: waitTime
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

/**
 * 检测客户端类型
 * @param {Express.Request} req
 * @returns {'default' | 'mod'}
 */
function detectClientType(req) {
  // 显式声明
  if (req.headers['x-client-type'] === 'mod') return 'mod';
  // User-Agent 自动识别
  const ua = req.headers['user-agent'] || '';
  if (/MindustryMod|BackupSave|LanLink/i.test(ua)) return 'mod';
  return 'default';
}

/**
 * 创建客户端感知的限流器
 * 根据客户端类型（浏览器/Mod）使用不同的限流阈值
 *
 * @param {object} options
 * @param {string} options.keyPrefix - Redis key 前缀
 * @param {number} options.windowMs - 时间窗口（毫秒）
 * @param {object} options.clients - 客户端配置 { default: { maxAttempts }, mod: { maxAttempts } }
 */
function createClientAwareRateLimiter(options = {}) {
  const keyPrefix = options.keyPrefix;
  const windowMs = options.windowMs || 5 * 60 * 1000;
  const clients = options.clients || { default: { maxAttempts: 5 } };

  if (!keyPrefix || typeof keyPrefix !== 'string') {
    throw new Error('keyPrefix is required and must be unique per limiter');
  }

  return async function rateLimit(req, res, next) {
    const clientType = detectClientType(req);
    const clientConfig = clients[clientType] || clients.default;
    const maxAttempts = clientConfig.maxAttempts;
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${clientType}:${ip}`;

    // IP 检测调试日志
    if (process.env.DEBUG_IP_DETECTION === 'true') {
      console.log('[IP Detection]', {
        detected_ip: ip,
        client_type: clientType,
        remote_addr: req.connection?.remoteAddress,
        is_trusted_proxy: isTrustedProxy(req),
      });
    }

    // 服务间 API key 绕过 IP 限流（仅跳过 IP 限流，账户锁定仍生效）
    if (req.headers['x-service-api-key'] && process.env.SERVICE_API_KEY) {
      const { timingSafeCompare } = require('../utils/crypto');
      if (timingSafeCompare(req.headers['x-service-api-key'], process.env.SERVICE_API_KEY)) {
        return next();
      }
    }

    try {
      const count = await client.incr(key);

      if (count === 1) {
        try {
          await client.pExpire(key, windowMs);
        } catch (err) {
          await client.del(key).catch(() => {});
          throw err;
        }
      }

      if (count > maxAttempts) {
        const ttl = await client.ttl(key);
        const waitTime = ttl + 1;
        res.set('Retry-After', String(waitTime));
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: `尝试次数过多，请${waitTime}秒后重试`,
          retry_after_seconds: waitTime,
          client_type: clientType
        });
      }

      next();
    } catch (err) {
      console.error('Rate limit Redis error, using memory fallback:', err.message);
      const now = Date.now();

      if (localRateLimitStore.size > 1000) {
        for (const [k, v] of localRateLimitStore) {
          if (now > v.expiresAt) localRateLimitStore.delete(k);
        }
      }

      const entry = localRateLimitStore.get(key);

      if (!entry || now > entry.expiresAt) {
        localRateLimitStore.set(key, { count: 1, expiresAt: now + windowMs });
        return next();
      }

      if (entry.count >= maxAttempts) {
        const waitTime = Math.ceil((entry.expiresAt - now) / 1000);
        res.set('Retry-After', String(waitTime));
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMITED',
          message: `尝试次数过多，请${waitTime}秒后重试`,
          retry_after_seconds: waitTime,
          client_type: clientType
        });
      }

      entry.count++;
      next();
    }
  };
}

module.exports = { createRateLimiter, createClientAwareRateLimiter, resetRateLimit, getRateLimitStatus };