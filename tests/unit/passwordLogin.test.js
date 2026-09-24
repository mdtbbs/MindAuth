const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordLogin } = require('../../src/modules/auth/passwordLogin');

function setup(user) {
  const calls = [];
  const pool = { execute: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT * FROM users')) return [[user].filter(Boolean)];
    return [{ affectedRows: 1 }];
  } };
  const keys = new Map();
  const redis = {
    incr: async (key) => { const value = (keys.get(key) || 0) + 1; keys.set(key, value); return value; },
    expire: async () => 1,
    del: async (key) => { keys.delete(key); return 1; },
  };
  const notifications = [];
  const audits = [];
  const service = createPasswordLogin({ pool, redis, compare: async () => false,
    notify: { create: async (entry) => notifications.push(entry) },
    audit: async (entry) => audits.push(entry),
  });
  return { service, calls, keys, notifications, audits };
}

test('password login normalizes email and clears shared failure counter on success', async () => {
  const calls = [];
  const keys = new Map();
  const authenticate = createPasswordLogin({
    pool: { execute: async (sql, params) => { calls.push({ sql, params }); return sql.startsWith('SELECT') ? [[{ id: 3, username: 'player', password_hash: 'hash', ban_status: 'none', lock_level: 2 }]] : [{ affectedRows: 1 }]; } },
    redis: { incr: async () => 1, expire: async () => {}, del: async key => { keys.delete(key); } },
    compare: async () => true,
  });
  const result = await authenticate({ login: 'Player@Example.COM', password: 'secret', ipAddress: '192.0.2.1' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].params, ['player@example.com']);
  assert.equal(calls.at(-1).sql, 'UPDATE users SET lock_level = 0 WHERE id = ?');
});

test('five wrong passwords use shared failure key, lock account, notify and audit', async () => {
  const { service, calls, keys, notifications, audits } = setup({ id: 7, username: 'player', password_hash: 'hash', ban_status: 'none', lock_level: 0 });
  for (let i = 0; i < 5; i++) await service({ login: 'player', password: 'bad', ipAddress: '192.0.2.8', userAgent: 'Mod' });
  assert.ok(calls.some(c => c.sql.includes('SET lock_level = ?')));
  assert.equal(notifications.length, 1);
  assert.equal(audits.filter(a => a.action === 'login_failed').length, 5);
  assert.equal(audits.filter(a => a.action === 'account_locked').length, 1);
  assert.equal(keys.has('login_fail:7:192.0.2.8'), false);
});

test('banned and locked users are rejected before password comparison', async () => {
  let compared = false;
  const make = (user) => createPasswordLogin({
    pool: { execute: async () => [[user]] }, redis: {}, compare: async () => { compared = true; return true; },
  });
  const banned = await make({ id: 1, ban_status: 'banned', ban_expires_at: null })({ login: 'p', password: 'x', ipAddress: '1' });
  const locked = await make({ id: 1, ban_status: 'none', locked_until: new Date(Date.now() + 60000), lock_level: 1 })({ login: 'p', password: 'x', ipAddress: '1' });
  assert.equal(banned.reason, 'banned');
  assert.equal(locked.reason, 'locked');
  assert.equal(compared, false);
});
