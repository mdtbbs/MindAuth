/**
 * Unit tests for sessionManager — the centralized session lifecycle module.
 *
 * Tests run with USE_MEMORY_REDIS=1 and a real MySQL test database.
 * They verify:
 *   - create / authenticate / touch / revoke / revoke-all for user sessions
 *   - token hashing (SHA-256) before DB storage
 *   - Redis cache + per-user index set management
 *   - admin session create / authenticate / revoke with DB role re-check
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Load .env before any application imports
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Ensure memory redis is used for tests
process.env.USE_MEMORY_REDIS = '1';
process.env.NODE_ENV = 'test';

const { pool, closePool, runMigrations } = require('../../src/db');
const { client } = require('../../src/redis');
const sessionManager = require('../../src/modules/sessions/sessionManager');
const bcrypt = require('bcrypt');

// Helper: create a test user in MySQL
async function createTestUser(overrides = {}) {
  const ts = Date.now();
  const username = overrides.username || `test_${ts}`;
  const email = overrides.email || `test_${ts}@test.com`;
  const password = overrides.password || 'TestPass123';
  const role = overrides.role || 'user';

  const passwordHash = await bcrypt.hash(password, 4); // low cost for tests
  const [result] = await pool.execute(
    'INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 1)',
    [username, email, passwordHash, role]
  );
  return { id: result.insertId, username, email, password, role };
}

// Helper: clean up test data
async function cleanupUser(userId) {
  await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
  // Clean up Redis index sets
  await client.del(`sessions_by_user:${userId}`).catch(() => {});
}

describe('sessionManager', () => {
  before(async () => {
    await runMigrations(pool);
  });

  after(async () => {
    await closePool();
  });

  describe('hashToken', () => {
    it('produces SHA-256 hex digest', () => {
      const hash = sessionManager.hashToken('hello');
      assert.equal(hash.length, 64); // SHA-256 = 32 bytes = 64 hex chars
      assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('is deterministic', () => {
      assert.equal(sessionManager.hashToken('abc'), sessionManager.hashToken('abc'));
    });
  });

  describe('createUserSession', () => {
    let user;

    before(async () => {
      user = await createTestUser();
    });

    after(async () => {
      await cleanupUser(user.id);
    });

    it('returns a raw token, expiresAt, and sessionId', async () => {
      const result = await sessionManager.createUserSession({
        userId: user.id,
        ipAddress: '127.0.0.1',
        userAgent: 'TestAgent/1.0',
      });

      assert.ok(result.token, 'should have a raw token');
      assert.ok(typeof result.token === 'string');
      assert.ok(result.token.length >= 32, 'token should be long enough');
      assert.ok(result.expiresAt instanceof Date);
      assert.ok(result.expiresAt > new Date());
      assert.ok(Number.isInteger(result.sessionId));
      assert.ok(result.sessionId > 0);
    });

    it('stores hash (not raw token) in MySQL user_sessions', async () => {
      const result = await sessionManager.createUserSession({
        userId: user.id,
        ipAddress: '127.0.0.1',
      });

      const [rows] = await pool.execute(
        'SELECT session_token FROM user_sessions WHERE id = ?',
        [result.sessionId]
      );

      // Stored value should be the SHA-256 hash, NOT the raw token
      const expectedHash = sessionManager.hashToken(result.token);
      assert.equal(rows[0].session_token, expectedHash);
      assert.notEqual(rows[0].session_token, result.token);
    });

    it('does NOT write users.session_token', async () => {
      const result = await sessionManager.createUserSession({
        userId: user.id,
      });

      const [rows] = await pool.execute(
        'SELECT session_token FROM users WHERE id = ?',
        [user.id]
      );

      // users.session_token should remain NULL (deprecated column)
      assert.equal(rows[0].session_token, null);
    });

    it('caches session data in Redis by hash', async () => {
      const result = await sessionManager.createUserSession({
        userId: user.id,
        ipAddress: '10.0.0.1',
      });

      const tokenHash = sessionManager.hashToken(result.token);
      const cached = await client.get(`session:${tokenHash}`);
      assert.ok(cached, 'Redis should have the session cached');

      const parsed = JSON.parse(cached);
      assert.equal(parsed.id, user.id);
      assert.equal(parsed.session_id, result.sessionId);
      assert.ok(parsed.username);
      assert.ok(parsed.email);
    });

    it('adds session ID to per-user index set', async () => {
      const result = await sessionManager.createUserSession({
        userId: user.id,
      });

      const members = await client.sMembers(`sessions_by_user:${user.id}`);
      assert.ok(members.includes(String(result.sessionId)));
    });
  });

  describe('authenticateUserSession', () => {
    let user;

    before(async () => {
      user = await createTestUser();
    });

    after(async () => {
      await cleanupUser(user.id);
    });

    it('returns user + session for valid token (from cache)', async () => {
      const { token } = await sessionManager.createUserSession({ userId: user.id });

      const result = await sessionManager.authenticateUserSession(token);
      assert.ok(result);
      assert.equal(result.user.id, user.id);
      assert.equal(result.user.username, user.username);
      assert.ok(result.session.id);
    });

    it('returns null for invalid/unknown token', async () => {
      const result = await sessionManager.authenticateUserSession('nonexistent_token_xyz');
      assert.equal(result, null);
    });

    it('returns null for null/empty token', async () => {
      assert.equal(await sessionManager.authenticateUserSession(null), null);
      assert.equal(await sessionManager.authenticateUserSession(''), null);
    });

    it('falls back to MySQL when Redis cache is missing', async () => {
      const { token, sessionId } = await sessionManager.createUserSession({ userId: user.id });
      const tokenHash = sessionManager.hashToken(token);

      // Delete the Redis cache entry
      await client.del(`session:${tokenHash}`);

      // Should still authenticate via MySQL fallback
      const result = await sessionManager.authenticateUserSession(token);
      assert.ok(result);
      assert.equal(result.user.id, user.id);
      assert.equal(result.session.id, sessionId);

      // Should have re-populated the cache
      const recached = await client.get(`session:${tokenHash}`);
      assert.ok(recached);
    });
  });

  describe('touchUserSession', () => {
    let user;

    before(async () => {
      user = await createTestUser();
    });

    after(async () => {
      await cleanupUser(user.id);
    });

    it('does not throw for valid session', async () => {
      const { sessionId } = await sessionManager.createUserSession({ userId: user.id });
      await assert.doesNotReject(() => sessionManager.touchUserSession(sessionId));
    });

    it('does not throw for null/undefined', async () => {
      await assert.doesNotReject(() => sessionManager.touchUserSession(null));
      await assert.doesNotReject(() => sessionManager.touchUserSession(undefined));
    });
  });

  describe('revokeUserSession', () => {
    let user;

    before(async () => {
      user = await createTestUser();
    });

    after(async () => {
      await cleanupUser(user.id);
    });

    it('revokes by token', async () => {
      const { token, sessionId } = await sessionManager.createUserSession({ userId: user.id });

      const result = await sessionManager.revokeUserSession({ token, userId: user.id });
      assert.equal(result.revoked, true);

      // MySQL row should be deleted
      const [rows] = await pool.execute('SELECT id FROM user_sessions WHERE id = ?', [sessionId]);
      assert.equal(rows.length, 0);

      // Redis cache should be deleted
      const tokenHash = sessionManager.hashToken(token);
      const cached = await client.get(`session:${tokenHash}`);
      assert.equal(cached, null);

      // Should not authenticate anymore
      const authResult = await sessionManager.authenticateUserSession(token);
      assert.equal(authResult, null);
    });

    it('revokes by sessionId', async () => {
      const { token, sessionId } = await sessionManager.createUserSession({ userId: user.id });

      const result = await sessionManager.revokeUserSession({ sessionId, userId: user.id });
      assert.equal(result.revoked, true);

      const authResult = await sessionManager.authenticateUserSession(token);
      assert.equal(authResult, null);
    });

    it('returns revoked=false for non-existent session', async () => {
      const result = await sessionManager.revokeUserSession({ sessionId: 999999, userId: user.id });
      assert.equal(result.revoked, false);
    });
  });

  describe('revokeAllUserSessions', () => {
    let user;

    before(async () => {
      user = await createTestUser();
    });

    after(async () => {
      await cleanupUser(user.id);
    });

    it('revokes all sessions for a user', async () => {
      const s1 = await sessionManager.createUserSession({ userId: user.id });
      const s2 = await sessionManager.createUserSession({ userId: user.id });
      const s3 = await sessionManager.createUserSession({ userId: user.id });

      const result = await sessionManager.revokeAllUserSessions(user.id);
      assert.ok(result.revokedCount >= 3);

      // All tokens should be invalid
      assert.equal(await sessionManager.authenticateUserSession(s1.token), null);
      assert.equal(await sessionManager.authenticateUserSession(s2.token), null);
      assert.equal(await sessionManager.authenticateUserSession(s3.token), null);

      // MySQL should have no sessions for this user
      const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM user_sessions WHERE user_id = ?', [user.id]);
      assert.equal(rows[0].cnt, 0);

      // Index set should be empty
      const members = await client.sMembers(`sessions_by_user:${user.id}`);
      assert.equal(members.length, 0);
    });

    it('supports exceptToken option', async () => {
      const s1 = await sessionManager.createUserSession({ userId: user.id });
      const s2 = await sessionManager.createUserSession({ userId: user.id });

      const result = await sessionManager.revokeAllUserSessions(user.id, { exceptToken: s1.token });
      assert.ok(result.revokedCount >= 1);

      // s1 should still be valid
      const auth = await sessionManager.authenticateUserSession(s1.token);
      assert.ok(auth);
      assert.equal(auth.user.id, user.id);

      // s2 should be invalid
      assert.equal(await sessionManager.authenticateUserSession(s2.token), null);
    });
  });

  describe('listUserSessions', () => {
    let user;

    before(async () => {
      user = await createTestUser();
    });

    after(async () => {
      await cleanupUser(user.id);
    });

    it('lists all sessions for a user', async () => {
      await sessionManager.createUserSession({ userId: user.id, ipAddress: '1.2.3.4' });
      await sessionManager.createUserSession({ userId: user.id, ipAddress: '5.6.7.8' });

      const sessions = await sessionManager.listUserSessions(user.id);
      assert.ok(sessions.length >= 2);

      const s = sessions[0];
      assert.ok(s.id);
      assert.ok(s.ip_address);
      assert.ok(s.device_info !== undefined);
      assert.ok(s.created_at);
    });

    it('marks current session via currentTokenHash', async () => {
      const s1 = await sessionManager.createUserSession({ userId: user.id });
      await sessionManager.createUserSession({ userId: user.id });

      const currentHash = sessionManager.hashToken(s1.token);
      const sessions = await sessionManager.listUserSessions(user.id, currentHash);

      const currentSessions = sessions.filter(s => s.is_current);
      assert.equal(currentSessions.length, 1);
      assert.equal(currentSessions[0].id, s1.sessionId);
    });
  });

  describe('Admin sessions', () => {
    let adminUser;
    let normalUser;

    before(async () => {
      adminUser = await createTestUser({ role: 'super_admin', username: `admin_${Date.now()}` });
      normalUser = await createTestUser({ role: 'user', username: `normal_${Date.now()}` });
    });

    after(async () => {
      await cleanupUser(adminUser.id);
      await cleanupUser(normalUser.id);
    });

    describe('createAdminSession', () => {
      it('returns a raw token and expiresAt', async () => {
        const result = await sessionManager.createAdminSession({
          adminId: adminUser.id,
          ipAddress: '127.0.0.1',
        });

        assert.ok(result.token);
        assert.ok(result.expiresAt instanceof Date);
      });

      it('stores session in Redis (not MySQL)', async () => {
        const { token } = await sessionManager.createAdminSession({
          adminId: adminUser.id,
        });

        const tokenHash = sessionManager.hashToken(token);
        const cached = await client.get(`admin_session:${tokenHash}`);
        assert.ok(cached);

        const parsed = JSON.parse(cached);
        assert.equal(parsed.user_id, adminUser.id);
      });

      it('adds to per-user admin index set', async () => {
        const { token } = await sessionManager.createAdminSession({
          adminId: adminUser.id,
        });

        const tokenHash = sessionManager.hashToken(token);
        const members = await client.sMembers(`admin_sessions_by_user:${adminUser.id}`);
        assert.ok(members.includes(tokenHash));
      });
    });

    describe('authenticateAdminSession', () => {
      it('returns admin data for valid token', async () => {
        const { token } = await sessionManager.createAdminSession({ adminId: adminUser.id });

        const result = await sessionManager.authenticateAdminSession(token);
        assert.ok(result);
        assert.equal(result.admin.id, adminUser.id);
        assert.ok(result.admin.normalized_role);
        assert.ok(result.session);
      });

      it('returns null for invalid token', async () => {
        const result = await sessionManager.authenticateAdminSession('bad_token');
        assert.equal(result, null);
      });

      it('rejects non-admin users (role downgrade)', async () => {
        const { token } = await sessionManager.createAdminSession({ adminId: normalUser.id });

        // normalUser has role='user', which is not an admin role
        const result = await sessionManager.authenticateAdminSession(token);
        assert.equal(result, null);
      });

      it('rejects banned admin', async () => {
        // Create admin session
        const { token } = await sessionManager.createAdminSession({ adminId: adminUser.id });

        // Ban the admin
        await pool.execute(
          "UPDATE users SET ban_status = 'banned' WHERE id = ?",
          [adminUser.id]
        );

        const result = await sessionManager.authenticateAdminSession(token);
        assert.equal(result, null);

        // Clean up: unban
        await pool.execute(
          "UPDATE users SET ban_status = 'none' WHERE id = ?",
          [adminUser.id]
        );
      });
    });

    describe('revokeAdminSessionsForUser', () => {
      it('revokes all admin sessions for a user', async () => {
        const s1 = await sessionManager.createAdminSession({ adminId: adminUser.id });
        const s2 = await sessionManager.createAdminSession({ adminId: adminUser.id });

        const result = await sessionManager.revokeAdminSessionsForUser(adminUser.id);
        assert.ok(result.revokedCount >= 2);

        // Both tokens should be invalid now
        assert.equal(await sessionManager.authenticateAdminSession(s1.token), null);
        assert.equal(await sessionManager.authenticateAdminSession(s2.token), null);

        // Index set should be empty
        const members = await client.sMembers(`admin_sessions_by_user:${adminUser.id}`);
        assert.equal(members.length, 0);
      });
    });
  });
});
