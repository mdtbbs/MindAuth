/**
 * Bootstrap — startup sequencing
 *
 * Responsible for:
 * 1. Loading environment variables
 * 2. Validating configuration
 * 3. Connecting to MySQL and Redis
 * 4. Running schema migrations
 * 5. Seeding test data (dev/test only)
 * 6. Starting the cleanup scheduler
 * 7. Creating the Express app and listening on the configured port
 * 8. Handling graceful shutdown
 *
 * This is the ONLY module that performs process-level side effects
 * (connecting databases, binding ports, registering signal handlers).
 */

const config = require('./config');
const { validateConfig } = require('./config/validate');
const { pool, closePool, runMigrations, seedTestFixtures } = require('./db');
const { migrateSensitiveConfig } = require('./utils/secrets');
const { client, connectRedis, closeRedis } = require('./redis');
const { createApp } = require('./app');
const { startCleanupScheduler } = require('./utils/cleanup');
const {
  refreshAliyunEsaTrustedProxyCache,
  startAliyunEsaTrustedProxyRefresh,
  stopAliyunEsaTrustedProxyRefresh,
} = require('./utils/aliyunEsaTrustedProxy');

/**
 * Start the application.
 *
 * @returns {Promise<http.Server>} The listening HTTP server (useful for tests)
 */
async function start() {
  // 1. Validate configuration
  validateConfig(config);
  console.log('Configuration validated');

  // 2. Connect to MySQL and run migrations
  await runMigrations(pool);
  console.log('MySQL database migrated');
  const migratedSecrets = await migrateSensitiveConfig(pool);
  if (migratedSecrets > 0) console.log(`Migrated ${migratedSecrets} stored provider secret(s) to encrypted form`);

  // 3. Seed test data only when the environment explicitly allows it.
  const shouldSeedTestData = ['development', 'test'].includes(process.env.NODE_ENV) || process.env.ENABLE_TEST_SEEDS === 'true';
  if (shouldSeedTestData) {
    await seedTestFixtures(pool);
  }

  // 4. Connect to Redis
  await connectRedis();
  console.log('Redis connected');

  // 4.5. Warm trusted proxy cache from Aliyun ESA if enabled
  await refreshAliyunEsaTrustedProxyCache();
  startAliyunEsaTrustedProxyRefresh();

  // 5. Create the Express app
  const app = createApp();

  // 6. Start Express server
  const PORT = config.server.port;
  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  // 7. Start cleanup scheduler (for MySQL expired data)
  const cleanupInterval = startCleanupScheduler();

  // 8. Graceful shutdown
  let shuttingDown = false;

  async function closeResourcesAndExit(code) {
    try {
      stopAliyunEsaTrustedProxyRefresh();
      await closePool();
      console.log('MySQL pool closed');
      await closeRedis();
      console.log('Redis closed');
    } catch (err) {
      console.error('Error closing connections:', err);
    }
    process.exit(code);
  }

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

  return server;
}

module.exports = { start };
