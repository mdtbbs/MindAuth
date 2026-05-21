const loginAttempts = new Map();

function createRateLimiter(options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const windowMs = options.windowMs || 5 * 60 * 1000; // 5 minutes

  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    throw new Error('maxAttempts must be a positive number');
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error('windowMs must be a positive number');
  }

  return function rateLimit(req, res, next) {
    let ip = req.ip || req.connection.remoteAddress;
    if (req.headers['x-forwarded-for']) {
      ip = req.headers['x-forwarded-for'].split(',')[0].trim();
    }

    const now = Date.now();
    const record = loginAttempts.get(ip);

    // Clean up old records periodically
    if (loginAttempts.size > 1000) {
      for (const [key, value] of loginAttempts.entries()) {
        if (now - value.firstAttempt > windowMs) {
          loginAttempts.delete(key);
        }
      }
    }

    if (!record) {
      loginAttempts.set(ip, { count: 1, firstAttempt: now });
      return next();
    }

    // Reset if window has passed
    if (now - record.firstAttempt >= windowMs) {
      loginAttempts.set(ip, { count: 1, firstAttempt: now });
      return next();
    }

    // Check if limit exceeded
    if (record.count >= maxAttempts) {
      const waitTime = Math.ceil((windowMs - (now - record.firstAttempt)) / 1000);
      return res.status(429).json({
        success: false,
        message: `尝试次数过多，请${waitTime}秒后重试`
      });
    }

    record.count++;
    return next();
  };
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

module.exports = { createRateLimiter, resetRateLimit };