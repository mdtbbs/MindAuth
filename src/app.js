/**
 * Express application factory
 *
 * Creates and configures the Express app with all middleware, routes,
 * health check, 404 handler, SPA fallback, and error handler.
 *
 * This module is purely synchronous — it does NOT connect to databases,
 * start servers, or run migrations. Those concerns live in bootstrap.js.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const config = require('./config');
const { pool } = require('./db');
const { client } = require('./redis');

// Route modules
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const oauthRoutes = require('./routes/oauth');
const { sloLogoutHandler } = require('./routes/sloLogout');
const passwordRoutes = require('./routes/password');
const emailVerificationRoutes = require('./routes/email-verification');
const accountRoutes = require('./routes/account');
const smsRoutes = require('./routes/sms');
const challengeRoutes = require('./routes/challenge');
const sessionsRoutes = require('./routes/sessions');
const notificationsRoutes = require('./routes/notifications');
const registerEmailCodeRoutes = require('./routes/registerEmailCode');
const socialAuthRoutes = require('./routes/socialAuth');
const nativeAuthRoutes = require('./routes/nativeAuth');

// Middleware
const { setCsrfCookie, validateCsrf, csrfTokenEndpoint } = require('./middleware/csrf');
const { ipBanMiddleware } = require('./middleware/ipBan');

/**
 * Create the Express application.
 *
 * @param {object} [deps] - Optional dependency overrides (for testing)
 * @param {object} [deps.pool] - MySQL pool override
 * @param {object} [deps.client] - Redis client override
 * @returns {express.Application}
 */
function createApp(deps = {}) {
  const appPool = deps.pool || pool;
  const appRedis = deps.client || client;

  const app = express();

  // IP extraction is handled by utils/request.js with explicit trusted proxy checks.
  app.set('trust proxy', false);

  // CDN and CORS configuration
  const CDN_URL = config.server.cdnUrl;
  const ALLOWED_ORIGINS = config.server.allowedOrigins;

  // CORS middleware - allow cross-origin API requests.
  // Same-origin requests (Origin host === request Host) are always allowed —
  // browsers attach an Origin header to fetch/crossorigin-asset requests even
  // same-site, and rejecting those breaks the site itself (asset 500s, CSRF
  // token fetch failures) whenever the exact origin isn't in ALLOWED_ORIGINS.
  // Unknown origins get a response WITHOUT CORS headers (the browser blocks
  // cross-origin reads) instead of a hard 500.
  app.use(cors((req, callback) => {
    const origin = req.headers.origin;
    let allow;
    if (!origin) {
      allow = true; // non-browser clients / same-origin navigations
    } else {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch { /* malformed Origin -> not same-origin */ }
      allow = sameOrigin || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*');
    }
    callback(null, {
      origin: allow,
      credentials: true,  // Allow cookies
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
    });
  }));

  // Security headers with CDN support
  app.use(helmet({
    strictTransportSecurity: process.env.NODE_ENV === 'production' ? {
      maxAge: 31536000,           // 1 year
      includeSubDomains: true,
      preload: true
    } : false,                    // disabled in dev to allow HTTP
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", CDN_URL ? CDN_URL : "'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", CDN_URL ? CDN_URL : "'self'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", CDN_URL ? CDN_URL : "'self'"],
        connectSrc: ["'self'", ...ALLOWED_ORIGINS.filter(o => o !== '*')],
        fontSrc: ["'self'", "https://fonts.gstatic.com", CDN_URL ? CDN_URL : "'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      }
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Middleware
  app.use(compression());
  app.use(express.json());
  app.use(cookieParser());

  // ── Static assets (before CSRF — static files don't need CSRF) ──────
  //
  // Resolution order:
  //   1. Legacy compatibility files (error.html, robots.txt, etc.)
  //   2. User uploads (/uploads/*) — 1-day cache, no immutable
  //   3. Vite hashed assets (/assets/*) — 1-year cache, immutable
  //   4. Vite root files (favicon.svg) — 1-hour cache
  //
  // After these, requests flow through CSRF → API routes → API 404 →
  // admin SPA → user SPA fallback.

  const PUBLIC_DIR = path.join(__dirname, '../public');
  const distClientDir = path.join(__dirname, '../dist/client');

  // 1. Legacy files that must remain accessible at their original URLs.
  //    We use an explicit allowlist instead of express.static(public/)
  //    to prevent public/index.html and public/admin.html from shadowing
  //    the React build.
  const LEGACY_FILES = new Set([
    '/error.html',
    '/oauth-error.html',
    '/robots.txt',
    '/docs.html',
  ]);
  app.use((req, res, next) => {
    if (req.method === 'GET' && LEGACY_FILES.has(req.path)) {
      const filePath = path.join(PUBLIC_DIR, req.path);
      res.sendFile(filePath);
    } else {
      next();
    }
  });

  // 2. User uploads — safe cache (1 day), no immutable flag.
  //    User uploads can change at any time, so we must not cache aggressively.
  app.use('/uploads', express.static(path.join(PUBLIC_DIR, 'uploads'), {
    maxAge: '1d',
  }));

  // 3. Vite build output — hashed assets get long cache (1 year).
  //    Vite emits filenames like assets/index-a1b2c3.js so cache-busting
  //    is built in.  This MUST come before the SPA fallback.
  app.use('/assets', express.static(path.join(distClientDir, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));

  // 4. Other root-level files from dist/client (favicon.svg, etc.)
  //    index: false prevents serving index.html/admin.html — those are
  //    handled by the SPA fallback routes below.
  app.use(express.static(distClientDir, {
    maxAge: '1h',
    index: false,
  }));

  // CSRF protection
  app.use(ipBanMiddleware);       // IP ban check (before CSRF)
  app.use(setCsrfCookie);  // Set CSRF cookie on all responses
  app.get('/api/csrf-token', csrfTokenEndpoint);  // Endpoint to get CSRF token
  app.use(validateCsrf);   // Validate CSRF on POST/PUT/DELETE

  // Mount routes
  // Registration email code must mount BEFORE authRoutes so /api/register/send-code
  // is handled here; /api/register then falls through to authRoutes.
  app.use('/api/register', registerEmailCodeRoutes);
  app.use('/api/auth', socialAuthRoutes);
  app.use('/api/v1/native', nativeAuthRoutes);
  app.use('/api', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', oauthRoutes);
  app.use('/api/password', passwordRoutes);
  app.use('/api/email-verification', emailVerificationRoutes);
  app.use('/api/account', accountRoutes);
  // 注意：accountRoutes 已包含 /bindings 和 /bindings/:id 路由
  app.use('/api/sms', smsRoutes);
  app.use('/api/challenge', challengeRoutes);
  app.use('/api/sessions', sessionsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/public', require('./routes/public'));

  // OIDC Discovery (RFC 8414 / OpenID Connect Discovery 1.0).
  // Exposes endpoint metadata so third-party clients can auto-discover MindAuth
  // endpoints instead of hard-coding them. MindAuth does not sign ID tokens
  // (RS256); callers retrieve user claims via /api/userinfo with an access_token.
  app.get('/.well-known/openid-configuration', (req, res) => {
    const baseUrl = config.server.baseUrl;
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/api/authorize`,
      token_endpoint: `${baseUrl}/api/token`,
      userinfo_endpoint: `${baseUrl}/api/userinfo`,
      revocation_endpoint: `${baseUrl}/api/revoke`,
      introspection_endpoint: `${baseUrl}/api/introspect`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
  });

  // Health check endpoint (public) - simplified for production security
  app.get('/api/health', async (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production';

    // In production, return minimal health info
    if (isProduction) {
      let status = 'ok';
      try {
        await appPool.execute('SELECT 1');
        await appRedis.ping();
      } catch (err) {
        status = 'degraded';
        console.error('Health check error:', err.message);
      }
      return res.status(status === 'ok' ? 200 : 503).json({ status });
    }

    // In development, return detailed health info but hide error details
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: config.server.version,
      services: {}
    };

    // Check MySQL database
    try {
      await appPool.execute('SELECT 1');
      health.services.database = 'connected (MySQL)';
    } catch (err) {
      health.status = 'degraded';
      health.services.database = 'error';
      console.error('Health check database error:', err.message);
    }

    // Check Redis
    try {
      await appRedis.ping();
      health.services.redis = 'connected';
    } catch (err) {
      health.status = 'degraded';
      health.services.redis = 'error';
      console.error('Health check redis error:', err.message);
    }

    // Check email config
    try {
      const [rows] = await appPool.execute('SELECT host, user FROM email_config WHERE id = 1');
      const emailConfig = rows[0];
      if (emailConfig && emailConfig.host && emailConfig.user) {
        health.services.email = 'configured';
      } else {
        health.services.email = 'not configured';
      }
    } catch (err) {
      health.services.email = 'error';
      console.error('Health check email config error:', err.message);
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // API 404 handler
  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: '接口不存在' });
  });

  // ── Admin SPA ──────────────────────────────────────────────────────
  // /admin and /admin/* serve the admin React entry.
  // Must come after /api/* routes so API calls are never intercepted.
  const serveAdminSpa = (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    }
    res.sendFile(path.join(distClientDir, 'admin.html'));
  };
  app.get('/admin', serveAdminSpa);
  app.get('/admin/*', serveAdminSpa);

  // ── User SPA fallback ──────────────────────────────────────────────
  // Serve the React user app for all remaining routes.
  // This MUST come after API routes and static asset middleware so that
  // /api/*, /uploads/*, and /assets/* are never intercepted.
  //
  // SLO logout (GET /logout) is mounted here — before the wildcard — so that
  // cross-origin browser logouts from SPAs like MindFourm work correctly.
  // The handler validates redirect_uri against the registered client's value
  // to prevent open redirect; any failure redirects to /login.
  app.get('/logout', sloLogoutHandler);

  app.get('*', (req, res, next) => {
    // In development, always serve fresh HTML (no caching)
    if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(distClientDir, 'index.html'));
  });

  // Error handler - handle multer errors specifically
  app.use((err, req, res, next) => {
    // Handle multer file size errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      // Determine which upload limit based on route
      const isBanner = req.path.includes('/banner');
      const isBackground = req.path.includes('/auth-background');
      const limit = (isBanner || isBackground) ? '5MB' : '2MB';
      return res.status(400).json({ success: false, message: `图片大小不能超过 ${limit}` });
    }

    // Handle multer file type errors
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ success: false, message: '请选择有效的图片文件' });
    }

    // Handle multer general errors
    if (err.message && err.message.includes('File too large')) {
      return res.status(400).json({ success: false, message: '文件大小超出限制' });
    }

    if (err.message === '只支持 JPEG、PNG、GIF、WebP 格式的图片') {
      console.warn('Upload rejected:', err.message);
      return res.status(400).json({ success: false, message: err.message });
    }

    console.error('Server error:', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  });

  return app;
}

module.exports = { createApp };
