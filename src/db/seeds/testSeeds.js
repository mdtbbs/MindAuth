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
const { hashClientSecret } = require('../../utils/secrets');

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
      redirect_uri: 'http://localhost:4000/api/auth/callback',
      client_type: 'confidential',
      party_type: 'first_party',
      ecosystem: 'mdtbbs',
      status: 'approved',
      scopes: ['openid', 'profile', 'email', 'forum.read', 'forum.write', 'resource.read', 'resource.download', 'resource.upload', 'notification.read', 'message.read', 'message.write'],
    },
    {
      name: 'MindFourm (Test)',
      client_id: '6d875cc521f1c60ba17dd53c7b9edc5a',
      client_secret: '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1',
      redirect_uri: 'http://localhost:4000/api/auth/callback',
      client_type: 'confidential',
      party_type: 'third_party',
      ecosystem: 'mdtbbs',
      status: 'approved',
      scopes: ['openid', 'profile', 'email'],
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
      const storedSecret = hashClientSecret(client.client_secret);
      const [existing] = await pool.execute(
        'SELECT id FROM clients WHERE client_id = ?',
        [client.client_id]
      );
      const scopeJson = JSON.stringify(client.scopes);

      if (existing.length === 0) {
        await pool.execute(
          `INSERT INTO clients
             (name, client_id, client_secret, redirect_uri, client_type, party_type, ecosystem, status,
              require_pkce, requested_scopes, approved_scopes, approved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP)`,
          [client.name, client.client_id, storedSecret, client.redirect_uri, client.client_type,
            client.party_type, client.ecosystem, client.status, scopeJson, scopeJson]
        );
        console.log(`Test OAuth client '${client.name}' created`);
      } else {
        // Keep dev/test rows aligned with the approved downstream fixture
        // contract; production security checks are unchanged.
        await pool.execute(
          `UPDATE clients
           SET name = ?, client_secret = ?, redirect_uri = ?, client_type = ?, party_type = ?, ecosystem = ?,
               status = ?, require_pkce = 0, requested_scopes = ?, approved_scopes = ?,
               approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP)
           WHERE id = ?`,
          [client.name, storedSecret, client.redirect_uri, client.client_type, client.party_type,
            client.ecosystem, client.status, scopeJson, scopeJson, existing[0].id]
        );
        console.log(`Test OAuth client '${client.name}' re-synced to seed values`);
      }

      const [clientRows] = await pool.execute('SELECT id FROM clients WHERE client_id = ?', [client.client_id]);
      await pool.execute(
        `INSERT INTO oauth_client_redirect_uris (oauth_client_id, redirect_uri, redirect_type)
         VALUES (?, ?, 'web')
         ON DUPLICATE KEY UPDATE redirect_type = VALUES(redirect_type)`,
        [clientRows[0].id, client.redirect_uri]
      );
    } catch (err) {
      console.warn(`Could not seed OAuth client '${client.name}':`, err.message);
    }
  }
}

module.exports = { seedTestFixtures };
