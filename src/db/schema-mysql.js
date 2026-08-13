/**
 * DEPRECATED — This file has been replaced by the migration system.
 *
 * - Schema DDL lives in `src/db/migrations/001_initial_schema.sql`.
 * - The migrator runner is `src/db/migrator.js` → `runMigrations(pool)`.
 * - Test/dev seeds are in `src/db/seeds/testSeeds.js` → `seedTestFixtures(pool)`.
 *
 * This module is kept as a thin re-export for any external callers that
 * still import from this path.  It will be removed in a future release.
 */

const { runMigrations } = require('./migrator');
const { seedTestFixtures } = require('./seeds/testSeeds');
const { hashClientSecret } = require('../utils/secrets');

// Backward-compatible aliases (deprecated).
async function initSchema(pool) {
  console.warn('DEPRECATED: initSchema() is deprecated. Use runMigrations(pool) instead.');
  return runMigrations(pool);
}

async function seedTestAdmin(pool) {
  console.warn('DEPRECATED: seedTestAdmin() is deprecated. Use seedTestFixtures(pool) instead.');
  if (process.env.NODE_ENV === 'production') return;
  const { pool: dbPool } = require('./pool');
  const bcrypt = require('bcrypt');
  const targetPool = pool || dbPool;
  const admins = [
    { username: 'testadmin', email: 'testadmin@mindauth.local', password: 'AdminPass123' }
  ];
  for (const admin of admins) {
    try {
      const [existing] = await targetPool.execute('SELECT id FROM users WHERE username = ?', [admin.username]);
      if (existing.length === 0) {
        const passwordHash = await bcrypt.hash(admin.password, 10);
        await targetPool.execute(
          'INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, ?)',
          [admin.username, admin.email, passwordHash, 'super_admin', 1]
        );
      }
    } catch (err) {
      console.warn(`Could not seed admin '${admin.username}':`, err.message);
    }
  }
}

async function seedTestOAuthClient(pool) {
  console.warn('DEPRECATED: seedTestOAuthClient() is deprecated. Use seedTestFixtures(pool) instead.');
  if (process.env.NODE_ENV === 'production') return;
  const { pool: dbPool } = require('./pool');
  const targetPool = pool || dbPool;
  const clients = [
    { name: 'MindFourm', client_id: 'forum', client_secret: 'forum_secret_key_for_development', redirect_uri: 'http://localhost:4000/api/auth/callback' },
    { name: 'MindFourm (Test)', client_id: '6d875cc521f1c60ba17dd53c7b9edc5a', client_secret: '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1', redirect_uri: 'http://localhost:4000/api/auth/callback' }
  ];
  for (const c of clients) {
    try {
      const [existing] = await targetPool.execute('SELECT id FROM clients WHERE client_id = ?', [c.client_id]);
      if (existing.length === 0) {
        await targetPool.execute(
          'INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)',
          [c.name, c.client_id, hashClientSecret(c.client_secret), c.redirect_uri]
        );
      }
    } catch (err) {
      console.warn(`Could not seed OAuth client '${c.name}':`, err.message);
    }
  }
}

module.exports = { initSchema, seedTestAdmin, seedTestOAuthClient };
