const crypto = require('crypto');
const { timingSafeCompare } = require('../utils/crypto');

/**
 * CSRF Protection Middleware
 * Uses double-submit cookie pattern:
 * 1. Server sets csrf_token cookie
 * 2. Client must send X-CSRF-Token header matching the cookie
 * 3. Validates on POST/PUT/PATCH/DELETE requests
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
  // Only validate state-changing requests
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  // Skip CSRF only for exact public/service endpoints that do not rely on a
  // browser session cookie for authorization.
  const path = req.path;
  const exemptPaths = new Set([
    '/api/token',        // OAuth token exchange (has client_secret)
    '/api/refresh',      // OAuth refresh (has client_secret)
    '/api/introspect',   // OAuth introspect (has client_secret)
    '/api/revoke',       // OAuth revoke (has client_secret)
    '/api/verify',       // Session verification (no CSRF needed)
    '/api/sms/sync-status', // Phone verification status sync uses a one-time token
    '/api/challenge/random', // Challenge question retrieval (no session needed)
    '/api/challenge/verify', // Challenge answer verification
    '/api/email-verification/verify', // Email verification uses a one-time token
    '/api/register',     // User registration (no session needed)
    '/api/login',        // User login (creates session, rate-limited)
    '/api/admin/login',  // Admin login (uses rate limiting + ADMIN_SECRET)
    '/api/admin/test/clear-rate-limits', // Test endpoint (non-production only)
    '/api/admin/test/get-user-id',       // Test endpoint (ADMIN_SECRET protected)
    '/api/admin/test/verify-email',      // Test endpoint (ADMIN_SECRET protected)
    '/api/admin/test/create-reset-token' // Test endpoint (ADMIN_SECRET protected)
  ]);

  if (exemptPaths.has(path)) {
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
  if (!timingSafeCompare(cookieToken, headerToken)) {
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
