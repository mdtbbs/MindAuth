const crypto = require('crypto');

/**
 * CSRF Protection Middleware
 * Uses double-submit cookie pattern:
 * 1. Server sets csrf_token cookie
 * 2. Client must send X-CSRF-Token header matching the cookie
 * 3. Validates on POST/PUT/DELETE requests
 */

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to set CSRF cookie on responses
 * Should be applied before routes that need CSRF protection
 */
function setCsrfCookie(req, res, next) {
  // Only set if not already present
  if (!req.cookies.csrf_token) {
    const token = generateCsrfToken();
    res.cookie('csrf_token', token, {
      httpOnly: false, // Must be readable by JS
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
  }
  next();
}

/**
 * Middleware to validate CSRF token on state-changing requests
 */
function validateCsrf(req, res, next) {
  // Only validate POST/PUT/DELETE
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }

  // Skip CSRF for OAuth token endpoint (uses client_secret for auth)
  const path = req.path;
  const exemptPaths = [
    '/token',        // OAuth token exchange (has client_secret)
    '/refresh',      // OAuth refresh (has client_secret)
    '/introspect',   // OAuth introspect (has client_secret)
    '/revoke',       // OAuth revoke (has client_secret)
    '/verify'        // Session verification (no CSRF needed)
  ];

  if (exemptPaths.some(p => path.endsWith(p))) {
    return next();
  }

  const cookieToken = req.cookies.csrf_token;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({
      success: false,
      message: '缺少 CSRF token'
    });
  }

  // Timing-safe comparison
  if (cookieToken.length !== headerToken.length ||
      !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token 无效'
    });
  }

  next();
}

/**
 * Endpoint to get/refresh CSRF token
 */
function csrfTokenEndpoint(req, res) {
  const token = req.cookies.csrf_token || generateCsrfToken();

  res.cookie('csrf_token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000
  });

  res.json({ success: true, csrf_token: token });
}

module.exports = {
  setCsrfCookie,
  validateCsrf,
  csrfTokenEndpoint,
  generateCsrfToken
};