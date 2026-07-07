require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const config = require('./config');
const { pool, closePool, initSchema, seedTestAdmin, seedTestOAuthClient } = require('./db');
const { client, connectRedis, closeRedis } = require('./redis');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const oauthRoutes = require('./routes/oauth');
const passwordRoutes = require('./routes/password');
const emailVerificationRoutes = require('./routes/email-verification');
const accountRoutes = require('./routes/account');
const smsRoutes = require('./routes/sms');
const internalRoutes = require('./routes/internal');
const challengeRoutes = require('./routes/challenge');
const sessionsRoutes = require('./routes/sessions');
const notificationsRoutes = require('./routes/notifications');
const { startCleanupScheduler } = require('./utils/cleanup');
const { setCsrfCookie, validateCsrf, csrfTokenEndpoint } = require('./middleware/csrf');
const { ipBanMiddleware } = require('./middleware/ipBan');

const app = express();
const PORT = config.server.port;

// IP extraction is handled by utils/request.js with explicit trusted proxy checks.
app.set('trust proxy', false);

// CDN and CORS configuration
const CDN_URL = config.server.cdnUrl;
const ALLOWED_ORIGINS = config.server.allowedOrigins;

if (config.server.isProduction && ALLOWED_ORIGINS.includes('*')) {
  throw new Error('ALLOWED_ORIGINS=* is not allowed in production when credentials are enabled');
}

// CORS middleware - allow cross-origin API requests
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl)
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,  // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));

// Security headers with CDN support
app.use(helmet({
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
app.use(compression()); // 响应压缩
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  },
})); // 开发模式不缓存
// Serve shared-styles from monorepo root
app.use('/shared-styles', express.static(path.join(__dirname, '../../shared-styles'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.css')) {
      const type = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/css; charset=utf-8';
      res.setHeader('Content-Type', type);
    }
  },
}));
// Serve shared templates from monorepo
app.use('/templates', express.static(path.join(__dirname, '../../shared/dist/templates'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  },
}));

// CSRF protection
app.use(ipBanMiddleware);       // IP ban check (before CSRF)
app.use(setCsrfCookie);  // Set CSRF cookie on all responses
app.get('/api/csrf-token', csrfTokenEndpoint);  // Endpoint to get CSRF token
app.use(validateCsrf);   // Validate CSRF on POST/PUT/DELETE

// Mount routes
app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', oauthRoutes);
app.use('/api/password', passwordRoutes);
app.use('/api/email-verification', emailVerificationRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/challenge', challengeRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/internal', internalRoutes);

// Health check endpoint (public) - simplified for production security
app.get('/api/health', async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, return minimal health info
  if (isProduction) {
    let status = 'ok';
    try {
      await pool.execute('SELECT 1');
      await client.ping();
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
    await pool.execute('SELECT 1');
    health.services.database = 'connected (MySQL)';
  } catch (err) {
    health.status = 'degraded';
    health.services.database = 'error';
    console.error('Health check database error:', err.message);
  }

  // Check Redis
  try {
    await client.ping();
    health.services.redis = 'connected';
  } catch (err) {
    health.status = 'degraded';
    health.services.redis = 'error';
    console.error('Health check redis error:', err.message);
  }

  // Check email config
  try {
    const [rows] = await pool.execute('SELECT host, user FROM email_config WHERE id = 1');
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

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: '接口不存在' });
});

// SPA fallback - handle direct /login, /register, /logout URLs
app.get('*', (req, res, next) => {
  const reqPath = req.path;

  // In development, always serve fresh HTML (no caching)
  if (process.env.NODE_ENV !== 'production') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  // For /login, /register, /logout: serve index.html directly (the SPA hash router handles the rest)
  // For other routes: also serve index.html (SPA fallback)
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler - handle multer errors specifically
app.use((err, req, res, next) => {
  // Handle multer file size errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    // Determine which upload limit based on route
    const isAvatar = req.path.includes('/avatar');
    const isBanner = req.path.includes('/banner');
    const limit = isBanner ? '5MB' : '2MB';
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

// Initialize and start server
async function startServer() {
  try {
    // Connect to MySQL and initialize schema
    await initSchema();
    console.log('MySQL database initialized');

    // Seed test data only when the environment explicitly allows it.
    const shouldSeedTestData = ['development', 'test'].includes(process.env.NODE_ENV) || process.env.ENABLE_TEST_SEEDS === 'true';
    if (shouldSeedTestData) {
      await seedTestAdmin();
      await seedTestOAuthClient();
    }

    // Connect to Redis
    await connectRedis();
    console.log('Redis connected');

    // Start Express server
    const server = app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });

    // Start cleanup scheduler (for MySQL expired data)
    const cleanupInterval = startCleanupScheduler();

    let shuttingDown = false;

    async function closeResourcesAndExit(code) {
      try {
        await closePool();
        console.log('MySQL pool closed');
        await closeRedis();
        console.log('Redis closed');
      } catch (err) {
        console.error('Error closing connections:', err);
      }
      process.exit(code);
    }

    // Graceful shutdown
    function gracefulShutdown(signal) {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`Received ${signal}, shutting down...`);
      clearInterval(cleanupInterval);

      const forcedExitTimer = setTimeout(() => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        closeResourcesAndExit(0);
      }, 5000);
      forcedExitTimer.unref();

      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }

      server.close(() => {
        clearTimeout(forcedExitTimer);
        closeResourcesAndExit(0);
      });
    }

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
