/**
 * Unit tests for the admin-configurable registration/password/session policy.
 *
 * These four system_config keys were editable in the admin UI but read by
 * nothing — `registration_enabled=0` did not stop registration, and
 * `password_min_length` had no effect. The tests below pin the wiring and,
 * just as importantly, pin the floor that config must never go below.
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const store = new Map();

// ─── Install a DB stub exposing only `system_config` reads ───────────────────

const mockPool = {
  execute: async (sql, params) => {
    if (/FROM system_config WHERE `key` = \?/.test(sql)) {
      const key = params[0];
      return [store.has(key) ? [{ value: store.get(key) }] : []];
    }
    if (/FROM system_config WHERE `key` IN/.test(sql)) {
      return [params.filter((k) => store.has(k)).map((k) => ({ key: k, value: store.get(k) }))];
    }
    return [[]];
  },
};

const dbPath = require.resolve('../../src/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { pool: mockPool },
};

const policy = require('../../src/modules/config/registrationPolicy');

beforeEach(() => {
  store.clear();
  policy._invalidate();
});

test('registration is enabled by default and by registration_enabled=1', async () => {
  assert.equal(await policy.isRegistrationEnabled(), true);
  store.set('registration_enabled', '1');
  policy._invalidate();
  assert.equal(await policy.isRegistrationEnabled(), true);
});

test('registration_enabled=0 actually disables registration', async () => {
  store.set('registration_enabled', '0');
  policy._invalidate();
  assert.equal(await policy.isRegistrationEnabled(), false);
});

test('password floor: 8 chars with a letter and a digit', async () => {
  assert.equal(await policy.validatePassword('short1A'), '密码至少需要8个字符');
  assert.equal(await policy.validatePassword('alllowercase'), '密码需要包含数字');
  assert.equal(await policy.validatePassword('12345678'), '密码需要包含字母');
  assert.equal(await policy.validatePassword('TestPass1'), null);
});

test('password_min_length can only raise the floor, never lower it', async () => {
  store.set('password_min_length', '3');
  policy._invalidate();
  assert.equal(await policy.validatePassword('short1A'), '密码至少需要8个字符', 'below-floor config must be ignored');

  store.set('password_min_length', '12');
  policy._invalidate();
  assert.equal(await policy.validatePassword('TestPass1'), '密码至少需要12个字符');
  assert.equal(await policy.validatePassword('TestPassword1'), null);
});

test('password_require_complexity adds uppercase + special characters', async () => {
  store.set('password_require_complexity', '1');
  policy._invalidate();
  assert.equal(await policy.validatePassword('testpass1'), '密码需要包含大写字母');
  assert.equal(await policy.validatePassword('Testpass1'), '密码需要包含特殊字符');
  assert.equal(await policy.validatePassword('Testpass1!'), null);
});

test('session lifetime falls back to 30 days on missing or junk values', async () => {
  assert.equal(await policy.getSessionLifetimeDays(), 30);
  store.set('session_lifetime_days', 'not-a-number');
  policy._invalidate();
  assert.equal(await policy.getSessionLifetimeDays(), 30);
  store.set('session_lifetime_days', '-5');
  policy._invalidate();
  assert.equal(await policy.getSessionLifetimeDays(), 30);
  store.set('session_lifetime_days', '7');
  policy._invalidate();
  assert.equal(await policy.getSessionLifetimeDays(), 7);
});
