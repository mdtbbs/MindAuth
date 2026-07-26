/**
 * Unit tests for runtimeConfig — the centralized runtime configuration module.
 *
 * Tests verify:
 *   - get (cache → DB fallback)
 *   - getMany (batch read)
 *   - set (DB write + cache invalidation)
 *   - invalidate (clear cache)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

process.env.USE_MEMORY_REDIS = '1';
process.env.NODE_ENV = 'test';

const { pool, closePool, runMigrations } = require('../../src/db');
const runtimeConfig = require('../../src/modules/config/runtimeConfig');

// Integration test: requires a live MySQL test database (RUN_INTEGRATION=1).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

describe('runtimeConfig', { skip: !RUN_INTEGRATION }, () => {
  before(async () => {
    await runMigrations(pool);
  });

  after(async () => {
    await closePool();
  });

  beforeEach(async () => {
    runtimeConfig.invalidate();
  });

  describe('get', () => {
    it('returns value from DB', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('test_key_1', 'test_value_1') ON DUPLICATE KEY UPDATE `value` = 'test_value_1'"
      );

      const value = await runtimeConfig.get('test_key_1');
      assert.equal(value, 'test_value_1');
    });

    it('returns null for non-existent key', async () => {
      const value = await runtimeConfig.get('nonexistent_key_xyz');
      assert.equal(value, null);
    });

    it('returns cached value on second call', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('test_cached', 'original') ON DUPLICATE KEY UPDATE `value` = 'original'"
      );

      const v1 = await runtimeConfig.get('test_cached');
      assert.equal(v1, 'original');

      await pool.execute("UPDATE system_config SET `value` = 'changed' WHERE `key` = 'test_cached'");

      const v2 = await runtimeConfig.get('test_cached');
      assert.equal(v2, 'original');
    });
  });

  describe('getMany', () => {
    it('returns multiple values', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('batch_1', 'val_1') ON DUPLICATE KEY UPDATE `value` = 'val_1'"
      );
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('batch_2', 'val_2') ON DUPLICATE KEY UPDATE `value` = 'val_2'"
      );

      const result = await runtimeConfig.getMany(['batch_1', 'batch_2']);
      assert.equal(result.batch_1, 'val_1');
      assert.equal(result.batch_2, 'val_2');
    });

    it('returns null for missing keys', async () => {
      const result = await runtimeConfig.getMany(['nonexistent_1', 'nonexistent_2']);
      assert.equal(result.nonexistent_1, null);
      assert.equal(result.nonexistent_2, null);
    });

    it('mixes cached and DB values', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('mixed_1', 'v1') ON DUPLICATE KEY UPDATE `value` = 'v1'"
      );
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('mixed_2', 'v2') ON DUPLICATE KEY UPDATE `value` = 'v2'"
      );

      await runtimeConfig.get('mixed_1');

      const result = await runtimeConfig.getMany(['mixed_1', 'mixed_2']);
      assert.equal(result.mixed_1, 'v1');
      assert.equal(result.mixed_2, 'v2');
    });
  });

  describe('set', () => {
    it('updates value in DB and invalidates cache', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('set_test', 'old') ON DUPLICATE KEY UPDATE `value` = 'old'"
      );

      await runtimeConfig.get('set_test');

      const result = await runtimeConfig.set('set_test', 'new');
      assert.equal(result.updated, true);

      const [rows] = await pool.execute("SELECT `value` FROM system_config WHERE `key` = 'set_test'");
      assert.equal(rows[0].value, 'new');

      const value = await runtimeConfig.get('set_test');
      assert.equal(value, 'new');
    });

    it('returns updated:false for non-existent key', async () => {
      const result = await runtimeConfig.set('totally_nonexistent_key', 'value');
      assert.equal(result.updated, false);
    });
  });

  describe('invalidate', () => {
    it('clears specific keys', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('inv_1', 'v1') ON DUPLICATE KEY UPDATE `value` = 'v1'"
      );
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('inv_2', 'v2') ON DUPLICATE KEY UPDATE `value` = 'v2'"
      );

      await runtimeConfig.get('inv_1');
      await runtimeConfig.get('inv_2');

      await pool.execute("UPDATE system_config SET `value` = 'changed_1' WHERE `key` = 'inv_1'");
      await pool.execute("UPDATE system_config SET `value` = 'changed_2' WHERE `key` = 'inv_2'");

      runtimeConfig.invalidate(['inv_1']);

      const v1 = await runtimeConfig.get('inv_1');
      assert.equal(v1, 'changed_1');

      const v2 = await runtimeConfig.get('inv_2');
      assert.equal(v2, 'v2');
    });

    it('clears all when no keys specified', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('inv_all', 'original') ON DUPLICATE KEY UPDATE `value` = 'original'"
      );

      await runtimeConfig.get('inv_all');
      await pool.execute("UPDATE system_config SET `value` = 'new' WHERE `key` = 'inv_all'");

      runtimeConfig.invalidate();

      const value = await runtimeConfig.get('inv_all');
      assert.equal(value, 'new');
    });
  });

  describe('preload', () => {
    it('pre-warms the cache', async () => {
      await pool.execute(
        "INSERT INTO system_config (`key`, `value`) VALUES ('preload_1', 'pv1') ON DUPLICATE KEY UPDATE `value` = 'pv1'"
      );

      await runtimeConfig.preload();

      await pool.execute("UPDATE system_config SET `value` = 'changed' WHERE `key` = 'preload_1'");

      const value = await runtimeConfig.get('preload_1');
      assert.equal(value, 'pv1');
    });
  });
});
