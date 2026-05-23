/**
 * Request utility functions
 */

/**
 * Extract client IP address from request
 * Handles various proxy/CDN headers for real client IP
 * Priority: CF-Connecting-IP > X-Real-IP > X-Forwarded-For > req.ip
 * @param {Express.Request} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIp(req) {
  // Cloudflare specific header (highest priority)
  if (req.headers['cf-connecting-ip']) {
    return req.headers['cf-connecting-ip'].trim();
  }

  // X-Real-IP header (nginx, some proxies)
  if (req.headers['x-real-ip']) {
    return req.headers['x-real-ip'].trim();
  }

  // X-Forwarded-For header (standard proxy header)
  if (req.headers['x-forwarded-for']) {
    // Take first IP in the chain (original client)
    return req.headers['x-forwarded-for'].split(',')[0].trim();
  }

  // Fallback to Express req.ip or connection remote address
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

module.exports = { getClientIp };