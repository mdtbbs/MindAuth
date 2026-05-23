/**
 * Request utility functions
 */

/**
 * Extract client IP address from request
 * Handles X-Forwarded-For header for proxied requests
 * @param {Express.Request} req - Express request object
 * @returns {string} Client IP address
 */
function getClientIp(req) {
  let ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // Check X-Forwarded-For header (proxy scenarios)
  if (req.headers['x-forwarded-for']) {
    // Take first IP in the chain (original client)
    ip = req.headers['x-forwarded-for'].split(',')[0].trim();
  }

  return ip;
}

module.exports = { getClientIp };