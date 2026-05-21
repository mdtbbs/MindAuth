require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const path = require('path');

const db = require('./db');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const oauthRoutes = require('./routes/oauth');
const passwordRoutes = require('./routes/password');
const emailVerificationRoutes = require('./routes/email-verification');
const accountRoutes = require('./routes/account');
const { startCleanupScheduler } = require('./utils/cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
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

// Mount routes
app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', oauthRoutes);
app.use('/api/password', passwordRoutes);
app.use('/api/email-verification', emailVerificationRoutes);
app.use('/api/account', accountRoutes);

// Health check endpoint (public)
app.get('/api/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    services: {}
  };

  // Check database
  try {
    db.prepare('SELECT 1').get();
    health.services.database = 'connected';
  } catch (err) {
    health.status = 'degraded';
    health.services.database = 'error: ' + err.message;
  }

  // Check email config
  try {
    const emailConfig = db.prepare('SELECT host, user FROM email_config WHERE id = 1').get();
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

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Start cleanup scheduler
const cleanupInterval = startCleanupScheduler();

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  clearInterval(cleanupInterval);
  server.close(() => {
    try {
      db.close();
    } catch (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));