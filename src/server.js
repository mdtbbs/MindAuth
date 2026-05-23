require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const { pool, closePool, initSchema } = require('./db');
const { client, connectRedis, closeRedis } = require('./redis');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const oauthRoutes = require('./routes/oauth');
const passwordRoutes = require('./routes/password');
const emailVerificationRoutes = require('./routes/email-verification');
const accountRoutes = require('./routes/account');
const { startCleanupScheduler } = require('./utils/cleanup');
const { setCsrfCookie, validateCsrf, csrfTokenEndpoint } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 4001;

// Trust proxy for CDN/reverse proxy scenarios
// Enables proper handling of X-Forwarded-For, X-Real-IP headers
app.set('trust proxy', true);

// CDN and CORS configuration
const CDN_URL = process.env.CDN_URL || '';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:4000', 'http://localhost:4001'];

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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));
// Serve shared-styles from monorepo root
app.use('/shared-styles', express.static(path.join(__dirname, '../../shared-styles')));

// CSRF protection
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

// Health check endpoint (public)
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    services: {}
  };

  // Check MySQL database
  try {
    await pool.execute('SELECT 1');
    health.services.database = 'connected (MySQL)';
  } catch (err) {
    health.status = 'degraded';
    health.services.database = 'error: ' + err.message;
  }

  // Check Redis
  try {
    await client.ping();
    health.services.redis = 'connected';
  } catch (err) {
    health.status = 'degraded';
    health.services.redis = 'error: ' + err.message;
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
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: '服务器错误' });
});

// Initialize and start server
async function startServer() {
  try {
    // Connect to MySQL and initialize schema
    await initSchema();
    console.log('MySQL database initialized');

    // Connect to Redis
    await connectRedis();
    console.log('Redis connected');

    // Start Express server
    const server = app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });

    // Start cleanup scheduler (for MySQL expired data)
    const cleanupInterval = startCleanupScheduler();

    // Graceful shutdown
    function gracefulShutdown(signal) {
      console.log(`Received ${signal}, shutting down...`);
      clearInterval(cleanupInterval);
      server.close(async () => {
        try {
          await closePool();
          console.log('MySQL pool closed');
          await closeRedis();
          console.log('Redis closed');
        } catch (err) {
          console.error('Error closing connections:', err);
        }
        process.exit(0);
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