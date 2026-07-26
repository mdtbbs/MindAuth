/**
 * Test/dev-only seed helpers.
 *
 * These functions create fixture data needed for local development and E2E
 * tests.  They are NEVER run in production — `seedTestFixtures` bails out
 * immediately when NODE_ENV is 'production'.
 *
 * @module db/seeds/testSeeds
 */

const bcrypt = require('bcrypt');

/**
 * Seed all test fixtures (admin accounts, OAuth clients).
 *
 * Safe to call multiple times — each insert is guarded by an existence check.
 *
 * @param {import('mysql2/promise').Pool} pool
 */
async function seedTestFixtures(pool) {
  // Hard guard: never seed in production.
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  await seedTestAdmin(pool);
  await seedTestOAuthClient(pool);
}

/**
 * Seed the test admin account used by E2E tests and local development.
 *
 * @param {import('mysql2/promise').Pool} pool
 */
async function seedTestAdmin(pool) {
  const testAdmins = [
    { username: 'testadmin', email: 'testadmin@mindauth.local', password: 'AdminPass123' }
  ];

  for (const admin of testAdmins) {
    try {
      const [existing] = await pool.execute(
        'SELECT id FROM users WHERE username = ?',
        [admin.username]
      );

      if (existing.length === 0) {
        const passwordHash = await bcrypt.hash(admin.password, 10);
        await pool.execute(
          'INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, ?)',
          [admin.username, admin.email, passwordHash, 'super_admin', 1]
        );
        console.log(`Test admin '${admin.username}' created with password '${admin.password}'`);
      }
    } catch (err) {
      console.warn(`Could not seed admin '${admin.username}':`, err.message);
    }
  }
}

/**
 * Seed test OAuth clients used by E2E tests and MindFourm dev integration.
 *
 * @param {import('mysql2/promise').Pool} pool
 */
async function seedTestOAuthClient(pool) {
  const testClients = [
    {
      name: 'MindFourm',
      client_id: 'forum',
      client_secret: 'forum_secret_key_for_development',
      redirect_uri: 'http://localhost:4000/api/auth/callback'
    },
    {
      name: 'MindFourm (Test)',
      client_id: '6d875cc521f1c60ba17dd53c7b9edc5a',
      client_secret: '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1',
      redirect_uri: 'http://localhost:4000/api/auth/callback'
    },
    // EasyManager — paused, preserved for restoration
    // {
    //   name: 'EasyManager',
    //   client_id: 'easymanager',
    //   client_secret: 'easymanager_secret_key_2024_dev_only',
    //   redirect_uri: 'http://localhost:3001/api/auth/callback'
    // }
  ];

  for (const client of testClients) {
    try {
      const [existing] = await pool.execute(
        'SELECT id, name, client_secret, redirect_uri FROM clients WHERE client_id = ?',
        [client.client_id]
      );

      if (existing.length === 0) {
        await pool.execute(
          'INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)',
          [client.name, client.client_id, client.client_secret, client.redirect_uri]
        );
        console.log(`Test OAuth client '${client.name}' created`);
      } else if (
        existing[0].name !== client.name ||
        existing[0].client_secret !== client.client_secret ||
        existing[0].redirect_uri !== client.redirect_uri
      ) {
        // Dev/test fixtures must match the seed definition exactly — E2E tests
        // depend on these values.  Sync rows left behind by older seed data.
        await pool.execute(
          'UPDATE clients SET name = ?, client_secret = ?, redirect_uri = ? WHERE id = ?',
          [client.name, client.client_secret, client.redirect_uri, existing[0].id]
        );
        console.log(`Test OAuth client '${client.name}' re-synced to seed values`);
      }
    } catch (err) {
      console.warn(`Could not seed OAuth client '${client.name}':`, err.message);
    }
  }
}

module.exports = { seedTestFixtures };
