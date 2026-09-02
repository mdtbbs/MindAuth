/**
 * Unit tests for notificationCenter — the centralized notification module.
 *
 * Tests verify:
 *   - create (with and without email)
 *   - list (pagination, unread filter)
 *   - getUnreadCount
 *   - markRead / markAllRead
 *   - remove (delete)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { pool, closePool, runMigrations } = require('../../src/db');
const { client, connectRedis, closeRedis } = require('../../src/redis');
const notificationCenter = require('../../src/modules/notifications/notificationCenter');
const bcrypt = require('bcrypt');

async function createTestUser(overrides = {}) {
  const ts = Date.now();
  const username = overrides.username || `notif_test_${ts}`;
  const email = overrides.email || `notif_test_${ts}@test.com`;
  const passwordHash = await bcrypt.hash('TestPass123', 4);
  const [result] = await pool.execute(
    'INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 1)',
    [username, email, passwordHash, 'user']
  );
  return { id: result.insertId, username, email };
}

async function cleanupUser(userId) {
  await pool.execute('DELETE FROM user_notifications WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
}

// Integration test: requires a live MySQL test database (RUN_INTEGRATION=1).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe('notificationCenter', { skip: !RUN_INTEGRATION }, () => {
  let user;

  before(async () => {
    await connectRedis();
    await runMigrations(pool);
    user = await createTestUser();
  });

  after(async () => {
    await cleanupUser(user.id);
    await closeRedis();
    await closePool();
  });

  beforeEach(async () => {
    await pool.execute('DELETE FROM user_notifications WHERE user_id = ?', [user.id]);
  });

  describe('create', () => {
    it('creates a notification and returns id', async () => {
      const result = await notificationCenter.create({
        user_id: user.id,
        type: 'test',
        title: 'Test Notification',
        content: 'Test content',
      });
      assert.ok(result.id > 0);
    });

    it('creates notification without content', async () => {
      const result = await notificationCenter.create({
        user_id: user.id,
        type: 'test',
        title: 'No Content',
      });
      assert.ok(result.id > 0);
    });
  });

  describe('list', () => {
    it('returns notifications with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await notificationCenter.create({
          user_id: user.id, type: 'test', title: `Notification ${i}`,
        });
      }

      const result = await notificationCenter.list(user.id, { page: 1, limit: 3 });
      assert.equal(result.notifications.length, 3);
      assert.equal(result.pagination.page, 1);
      assert.equal(result.pagination.limit, 3);
      assert.equal(result.pagination.total, 5);
      assert.equal(result.pagination.totalPages, 2);
    });

    it('supports unreadOnly filter', async () => {
      await notificationCenter.create({ user_id: user.id, type: 'test', title: 'Unread 1' });
      await notificationCenter.create({ user_id: user.id, type: 'test', title: 'Unread 2' });
      const { id } = await notificationCenter.create({ user_id: user.id, type: 'test', title: 'Will Read' });
      await notificationCenter.markRead(user.id, id);

      const result = await notificationCenter.list(user.id, { unreadOnly: true });
      assert.equal(result.notifications.length, 2);
      assert.equal(result.pagination.total, 2);
    });

    it('returns empty list for user with no notifications', async () => {
      const result = await notificationCenter.list(999999);
      assert.equal(result.notifications.length, 0);
      assert.equal(result.pagination.total, 0);
    });
  });

  describe('getUnreadCount', () => {
    it('returns 0 when no notifications', async () => {
      const count = await notificationCenter.getUnreadCount(user.id);
      assert.equal(count, 0);
    });

    it('returns correct count', async () => {
      await notificationCenter.create({ user_id: user.id, type: 'test', title: 'N1' });
      await notificationCenter.create({ user_id: user.id, type: 'test', title: 'N2' });
      const count = await notificationCenter.getUnreadCount(user.id);
      assert.equal(count, 2);
    });
  });

  describe('markRead', () => {
    it('marks a notification as read', async () => {
      const { id } = await notificationCenter.create({ user_id: user.id, type: 'test', title: 'Read Me' });
      const result = await notificationCenter.markRead(user.id, id);
      assert.equal(result.updated, true);

      const count = await notificationCenter.getUnreadCount(user.id);
      assert.equal(count, 0);
    });

    it('returns updated:false for non-existent notification', async () => {
      const result = await notificationCenter.markRead(user.id, 99999);
      assert.equal(result.updated, false);
    });

    it('does not mark other user\'s notification', async () => {
      const otherUser = await createTestUser({ username: `other_${Date.now()}`, email: `other_${Date.now()}@test.com` });
      const { id } = await notificationCenter.create({ user_id: otherUser.id, type: 'test', title: 'Not Mine' });

      const result = await notificationCenter.markRead(user.id, id);
      assert.equal(result.updated, false);

      await cleanupUser(otherUser.id);
    });
  });

  describe('markAllRead', () => {
    it('marks all as read', async () => {
      await notificationCenter.create({ user_id: user.id, type: 'test', title: 'N1' });
      await notificationCenter.create({ user_id: user.id, type: 'test', title: 'N2' });
      await notificationCenter.create({ user_id: user.id, type: 'test', title: 'N3' });

      const result = await notificationCenter.markAllRead(user.id);
      assert.equal(result.updatedCount, 3);

      const count = await notificationCenter.getUnreadCount(user.id);
      assert.equal(count, 0);
    });
  });

  describe('remove', () => {
    it('deletes a notification', async () => {
      const { id } = await notificationCenter.create({ user_id: user.id, type: 'test', title: 'Delete Me' });
      const result = await notificationCenter.remove(user.id, id);
      assert.equal(result.deleted, true);
    });

    it('returns deleted:false for non-existent', async () => {
      const result = await notificationCenter.remove(user.id, 99999);
      assert.equal(result.deleted, false);
    });
  });
});
