/**
 * Unit tests for stateManager — verifies OAuth state management security:
 * - state is 64 hex chars (32 bytes random)
 * - state is consumed atomically (GETDEL semantics)
 * - session tokens are hashed, never stored in plaintext
 * - payload size is bounded
 * - field allowlist prevents unexpected data
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// -- Redis Mock --
const store = new Map();
const mockRedisClient = {
  setEx: async (key, ttl, value) => {
    store.set(key, value);
    return 'OK';
  },
  get: async (key) => store.get(key) ?? null,
  getDel: async (key) => {
    const v = store.get(key) ?? null;
    store.delete(key);
    return v;
  },
  del: async (key) => {
    const had = store.delete(key);
    return had ? 1 : 0;
  },
  ttl: async (key) => (store.has(key) ? 600 : -2),
};

// Install mock before requiring stateManager
const redisPath = require.resolve('../../src/redis');
require.cache[redisPath] = {
  id: redisPath,
  filename: redisPath,
  loaded: true,
  exports: { client: mockRedisClient },
};

const stateManager = require('../../src/modules/social/stateManager');

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

beforeEach(() => {
  store.clear();
});

// ─── createState ─────────────────────────────────────────────────────────────

test('createState returns 64-char hex string (32 bytes)', async () => {
  const state = await stateManager.createState({
    provider: 'qq',
    intent: 'login',
  });

  assert.equal(state.length, 64);
  assert.match(state, /^[a-f0-9]{64}$/);
});

test('createState generates unique values', async () => {
  const states = new Set();
  for (let i = 0; i < 100; i++) {
    const state = await stateManager.createState({
      provider: 'qq',
      intent: 'login',
    });
    states.add(state);
  }
  assert.equal(states.size, 100, 'all states must be unique');
});

test('createState requires valid provider', () => {
  assert.throws(
    () => stateManager.createState({ intent: 'login' }),
    (err) => err.message === 'Invalid provider'
  );
  assert.throws(
    () => stateManager.createState({ provider: 'invalid', intent: 'login' }),
    (err) => err.message === 'Invalid provider'
  );
});

test('createState requires valid intent', () => {
  assert.throws(
    () => stateManager.createState({ provider: 'qq' }),
    (err) => err.message === 'Invalid intent'
  );
  assert.throws(
    () => stateManager.createState({ provider: 'qq', intent: 'invalid' }),
    (err) => err.message === 'Invalid intent'
  );
});

test('createState stores sessionToken as hash, never plaintext', async () => {
  const sessionToken = 'raw-session-token-12345';
  const state = await stateManager.createState({
    provider: 'qq',
    intent: 'bind',
    sessionToken,
  });

  // Retrieve stored payload
  const raw = store.get(`social:state:${state}`);
  const payload = JSON.parse(raw);

  // Must not contain plaintext token
  assert.equal(payload.sessionToken, undefined, 'plaintext sessionToken must not be stored');
  assert.equal(payload.sessionHash, sha256(sessionToken), 'sessionHash must be SHA-256');
});

test('createState truncates IP and userAgent', async () => {
  const longIp = 'x'.repeat(500);
  const longUa = 'y'.repeat(1000);

  const state = await stateManager.createState({
    provider: 'qq',
    intent: 'login',
    ip: longIp,
    userAgent: longUa,
  });

  const raw = store.get(`social:state:${state}`);
  const payload = JSON.parse(raw);

  assert.equal(payload.ip.length, 200, 'IP truncated to 200 chars');
  assert.equal(payload.userAgent.length, 500, 'userAgent truncated to 500 chars');
});

test('createState filters authorize context to allowlist', async () => {
  const state = await stateManager.createState({
    provider: 'qq',
    intent: 'login',
    authorize: {
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      state: 'oauth-state',
      scope: 'openid profile',
      codeChallenge: 'challenge-value',
      codeChallengeMethod: 'S256',
      secretField: 'should-be-filtered',
      extraField: 'should-not-exist',
    },
  });

  const raw = store.get(`social:state:${state}`);
  const payload = JSON.parse(raw);

  assert.equal(payload.authorize.clientId, 'test-client');
  assert.equal(payload.authorize.redirectUri, 'https://example.com/callback');
  assert.equal(payload.authorize.state, 'oauth-state');
  assert.equal(payload.authorize.scope, 'openid profile');
  assert.equal(payload.authorize.codeChallenge, 'challenge-value');
  assert.equal(payload.authorize.codeChallengeMethod, 'S256');
  assert.equal(payload.authorize.secretField, undefined, 'unknown fields must be filtered');
  assert.equal(payload.authorize.extraField, undefined, 'unknown fields must be filtered');
});

test('createState rejects payload exceeding MAX_PAYLOAD_SIZE', () => {
  // Create a payload with huge authorize context that exceeds 4096 bytes
  const hugeAuthorize = {
    clientId: 'x'.repeat(2000),
    redirectUri: 'y'.repeat(2000),
    state: 'z'.repeat(2000),
    scope: 'a'.repeat(2000),
  };

  assert.throws(
    () => stateManager.createState({
      provider: 'qq',
      intent: 'login',
      authorize: hugeAuthorize,
    }),
    (err) => err.message === 'State payload too large'
  );
});

// ─── consumeState ────────────────────────────────────────────────────────────

test('consumeState returns null for invalid format', async () => {
  assert.equal(await stateManager.consumeState(''), null);
  assert.equal(await stateManager.consumeState('short'), null);
  assert.equal(await stateManager.consumeState('x'.repeat(63)), null);
  assert.equal(await stateManager.consumeState('g'.repeat(64)), null); // non-hex
});

test('consumeState returns null for non-existent state', async () => {
  const nonExistent = 'a'.repeat(64);
  assert.equal(await stateManager.consumeState(nonExistent), null);
});

test('consumeState returns payload on first call', async () => {
  const state = await stateManager.createState({
    provider: 'qq',
    intent: 'login',
    ip: '127.0.0.1',
  });

  const payload = await stateManager.consumeState(state);

  assert.equal(payload.provider, 'qq');
  assert.equal(payload.intent, 'login');
  assert.equal(payload.ip, '127.0.0.1');
  assert.ok(payload.createdAt, 'createdAt must be present');
});

test('consumeState returns null on second call (atomic delete)', async () => {
  const state = await stateManager.createState({
    provider: 'qq',
    intent: 'login',
  });

  const first = await stateManager.consumeState(state);
  assert.ok(first, 'first consume must return payload');

  const second = await stateManager.consumeState(state);
  assert.equal(second, null, 'second consume must return null');
});

test('consumeState validates required fields', async () => {
  // Manually store invalid payload
  const state = 'b'.repeat(64);
  await store.set(`social:state:${state}`, JSON.stringify({
    // Missing provider and intent
    createdAt: new Date().toISOString(),
  }));

  const result = await stateManager.consumeState(state);
  assert.equal(result, null, 'payload without required fields must be rejected');
});

// ─── compareSessionHash ──────────────────────────────────────────────────────

test('compareSessionHash returns true for matching token', async () => {
  const sessionToken = 'my-secret-session-token';
  const sessionHash = sha256(sessionToken);

  assert.equal(stateManager.compareSessionHash(sessionHash, sessionToken), true);
});

test('compareSessionHash returns false for non-matching token', async () => {
  const sessionToken = 'my-secret-session-token';
  const sessionHash = sha256(sessionToken);

  assert.equal(stateManager.compareSessionHash(sessionHash, 'wrong-token'), false);
});

test('compareSessionHash returns false for null/empty values', async () => {
  assert.equal(stateManager.compareSessionHash(null, 'token'), false);
  assert.equal(stateManager.compareSessionHash('', 'token'), false);
  assert.equal(stateManager.compareSessionHash('hash', null), false);
  assert.equal(stateManager.compareSessionHash('hash', ''), false);
});

// ─── storeState ──────────────────────────────────────────────────────────────

test('storeState can restore a state', async () => {
  const state = 'c'.repeat(64);
  const payload = {
    provider: 'qq',
    intent: 'register',
    createdAt: new Date().toISOString(),
    openid: 'test-openid',
  };

  await stateManager.storeState(state, payload);

  const retrieved = await stateManager.consumeState(state);
  assert.equal(retrieved.provider, 'qq');
  assert.equal(retrieved.intent, 'register');
  assert.equal(retrieved.openid, 'test-openid');
});

test('storeState rejects invalid state format', async () => {
  await assert.rejects(
    () => stateManager.storeState('short', {}),
    (err) => err.message === 'INVALID_STATE'
  );
  await assert.rejects(
    () => stateManager.storeState('x'.repeat(64), {}), // non-hex
    (err) => err.message === 'INVALID_STATE'
  );
});

test('storeState rejects payload exceeding MAX_PAYLOAD_SIZE', async () => {
  const state = 'd'.repeat(64);
  const payload = {
    provider: 'qq',
    intent: 'register',
    hugeField: 'x'.repeat(10000),
  };

  await assert.rejects(
    () => stateManager.storeState(state, payload),
    (err) => err.message === 'State payload too large'
  );
});

// ─── TTL verification ────────────────────────────────────────────────────────

test('state TTL is 600 seconds', async () => {
  assert.equal(stateManager.TTL, 600);
});

// ─── Exports ─────────────────────────────────────────────────────────────────

test('exports VALID_INTENTS and VALID_PROVIDERS', () => {
  assert.ok(stateManager.VALID_INTENTS.has('login'));
  assert.ok(stateManager.VALID_INTENTS.has('bind'));
  assert.ok(stateManager.VALID_INTENTS.has('register'));

  assert.ok(stateManager.VALID_PROVIDERS.has('qq'));
});
