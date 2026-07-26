/**
 * Unit tests for tokenStore — verifies OAuth tokens are stored HASHED at rest
 * (a Redis dump must never expose usable bearer tokens) and that the per-user/
 * client index set holds hashes, enabling SCAN-free revocation.
 *
 * Uses a mock Redis client (SET semantics included) — no live Redis required.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// -- Redis Mock (strings + sets) --
const store = new Map();  // key -> string value
const sets = new Map();   // key -> Set<string>
const mockRedisClient = {
  setEx: async (key, ttl, value) => { store.set(key, value); return 'OK'; },
  get: async (key) => (store.has(key) ? store.get(key) : null),
  del: async (key) => { const had = store.delete(key) || sets.delete(key); return had ? 1 : 0; },
  ttl: async (key) => (store.has(key) ? 3600 : -2),
  getDel: async (key) => { const v = store.get(key) ?? null; store.delete(key); return v; },
  sAdd: async (key, member) => {
    if (!sets.has(key)) sets.set(key, new Set());
    sets.get(key).add(member);
    return 1;
  },
  sMembers: async (key) => (sets.has(key) ? [...sets.get(key)] : []),
};

// Install the mock before requiring tokenStore
const redisPath = require.resolve('../../src/redis');
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true,
  exports: { client: mockRedisClient },
};

const tokenStore = require('../../src/modules/oauth/tokenStore');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

beforeEach(() => { store.clear(); sets.clear(); });

test('storeAccessToken persists under the SHA-256 hash, never the raw token', async () => {
  const raw = 'raw-access-token-abc';
  await tokenStore.storeAccessToken(raw, { user_id: 1, client_id: 'app', scope: 'openid', token_type: 'Bearer' }, 3600);

  assert.equal(store.has(`accesstoken:${raw}`), false, 'raw token must not be a key');
  assert.equal(store.has(`accesstoken:${sha256(raw)}`), true, 'hashed token must be the key');
});

test('index set stores the token hash (not the raw token)', async () => {
  const raw = 'raw-access-token-xyz';
  await tokenStore.storeAccessToken(raw, { user_id: 7, client_id: 'forum', scope: 'openid', token_type: 'Bearer' }, 3600);

  const members = await mockRedisClient.sMembers('accesstokens_by_userclient:7:forum');
  assert.deepEqual(members, [sha256(raw)]);
});

test('getAccessToken looks up by hash and returns the payload', async () => {
  const raw = 'lookup-token';
  await tokenStore.storeAccessToken(raw, { user_id: 3, client_id: 'app', scope: 'profile', token_type: 'Bearer' }, 3600);

  const data = await tokenStore.getAccessToken(raw);
  assert.equal(data.user_id, 3);
  assert.equal(data.scope, 'profile');
  assert.equal(await tokenStore.getAccessToken('unknown-token'), null);
});

test('revokeAccessToken removes the hashed key', async () => {
  const raw = 'revoke-me';
  await tokenStore.storeAccessToken(raw, { user_id: 9, client_id: 'app', scope: 'openid', token_type: 'Bearer' }, 3600);
  await tokenStore.revokeAccessToken(raw);
  assert.equal(await tokenStore.getAccessToken(raw), null);
});

test('revokeAccessTokensForUserClient clears all tokens via the index set', async () => {
  await tokenStore.storeAccessToken('t1', { user_id: 5, client_id: 'app', scope: 'openid', token_type: 'Bearer' }, 3600);
  await tokenStore.storeAccessToken('t2', { user_id: 5, client_id: 'app', scope: 'openid', token_type: 'Bearer' }, 3600);

  await tokenStore.revokeAccessTokensForUserClient(5, 'app');

  assert.equal(await tokenStore.getAccessToken('t1'), null);
  assert.equal(await tokenStore.getAccessToken('t2'), null);
  assert.deepEqual(await mockRedisClient.sMembers('accesstokens_by_userclient:5:app'), []);
});

test('auth codes are single-use (GETDEL semantics)', async () => {
  await tokenStore.storeAuthCode('code123', { client_id: 'app', user_id: 1 }, 300);
  const first = await tokenStore.consumeAuthCode('code123');
  assert.equal(first.client_id, 'app');
  const second = await tokenStore.consumeAuthCode('code123');
  assert.equal(second, null, 'a consumed code cannot be replayed');
});
