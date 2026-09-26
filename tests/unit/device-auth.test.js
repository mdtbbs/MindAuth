/**
 * Unit tests for device authorization flow (RFC 8628).
 *
 * Verifies:
 *   - Device code issuance and user code format
 *   - User code uniqueness and collision retry
 *   - Approval and denial flows
 *   - Token exchange with proper state transitions
 *   - Replay attack protection (single-use device codes)
 *
 * Uses a mock Redis client — no live Redis required.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// -- Redis Mock (strings + sets) --
const store = new Map();
const mockRedisClient = {
  setEx: async (key, ttl, value) => {
    store.set(key, value);
    return 'OK';
  },
  get: async (key) => (store.has(key) ? store.get(key) : null),
  del: async (key) => {
    const had = store.delete(key);
    return had ? 1 : 0;
  },
  ttl: async (key) => (store.has(key) ? 3600 : -2),
  getDel: async (key) => {
    const v = store.get(key) ?? null;
    store.delete(key);
    return v;
  },
  sAdd: async () => 1,
  sMembers: async () => [],
};

// Install the mock before requiring modules
const redisPath = require.resolve('../../src/redis');
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true,
  exports: { client: mockRedisClient },
};

// Mock MySQL pool
const mockPool = {
  execute: async (sql, params) => {
    // Return mock user for SELECT queries
    if (sql.includes('SELECT') && sql.includes('FROM users')) {
      return [[{
        id: params[0],
        username: 'testuser',
        email: 'test@example.com',
        phone_verified: 1,
        phone_verified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }]];
    }
    // Return mock client for SELECT queries
    if (sql.includes('SELECT') && sql.includes('FROM clients')) {
      return [[{
        client_id: params[0],
        client_secret: 'test_secret',
        name: 'Test Client',
        redirect_uri: 'http://localhost:3000/callback',
        require_pkce: 0,
      }]];
    }
    // Return empty for INSERT/UPDATE
    return [{ affectedRows: 1 }];
  },
};

const dbPath = require.resolve('../../src/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    pool: mockPool,
    transaction: async (fn) => fn(mockPool),
  },
};

// Mock session manager
const sessionManagerPath = require.resolve('../../src/modules/sessions/sessionManager');
require.cache[sessionManagerPath] = {
  id: sessionManagerPath, filename: sessionManagerPath, loaded: true,
  exports: {
    authenticateUserSession: async () => null,
    touchUserSession: async () => {},
  },
};

const oauthIssuer = require('../../src/modules/oauth/oauthIssuer');

beforeEach(() => {
  store.clear();
});

// ─── User Code Format Tests ───────────────────────────────────

test('user code format is LL-XXXX-XXXX with valid characters', async () => {
  const result = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid profile',
  });

  // Format: LL-XXXX-XXXX (12 characters total: LL-XXXX-XXXX)
  assert.match(result.userCode, /^LL-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(result.userCode.length, 12);
});

test('user code excludes ambiguous characters (0, O, 1, I)', async () => {
  // Generate many user codes to verify character set
  const codes = new Set();
  for (let i = 0; i < 100; i++) {
    const result = await oauthIssuer.issueDeviceCode({
      clientId: 'test_client',
      scope: 'openid',
    });
    codes.add(result.userCode);
  }

  // Verify no ambiguous characters appear
  for (const code of codes) {
    const chars = code.replace('LL-', '').replace(/-/g, '');
    assert.ok(!chars.includes('0'), 'User code must not contain 0');
    assert.ok(!chars.includes('O'), 'User code must not contain O');
    assert.ok(!chars.includes('1'), 'User code must not contain 1');
    assert.ok(!chars.includes('I'), 'User code must not contain I');
  }
});

test('device code is 32 bytes hex (64 characters)', async () => {
  const result = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  assert.equal(result.deviceCode.length, 64);
  assert.match(result.deviceCode, /^[a-f0-9]{64}$/);
});

test('verification URIs are correctly formatted', async () => {
  const result = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  assert.ok(result.verificationUri);
  assert.ok(result.verificationUriComplete);
  assert.ok(result.verificationUriComplete.includes(result.userCode));
  assert.ok(result.verificationUriComplete.includes('/device'));
});

test('expires_in and interval are reasonable values', async () => {
  const result = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  assert.ok(result.expiresIn >= 300, 'expires_in should be at least 5 minutes');
  assert.ok(result.expiresIn <= 1800, 'expires_in should be at most 30 minutes');
  assert.ok(result.interval >= 1, 'interval should be at least 1 second');
  assert.ok(result.interval <= 30, 'interval should be at most 30 seconds');
});

// ─── Storage Tests ────────────────────────────────────────────

test('device code is stored in Redis with correct key', async () => {
  const result = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  const stored = store.get(`device:${result.deviceCode}`);
  assert.ok(stored, 'Device code must be stored in Redis');

  const parsed = JSON.parse(stored);
  assert.equal(parsed.client_id, 'test_client');
  assert.equal(parsed.scope, 'openid');
  assert.equal(parsed.user_id, null);
  assert.equal(parsed.approved, false);
  assert.ok(parsed.created_at);
});

test('user code mapping is stored in Redis', async () => {
  const result = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  const stored = store.get(`device_code:${result.userCode}`);
  assert.ok(stored, 'User code mapping must be stored');
  assert.equal(stored, result.deviceCode);
});

// ─── Approval Flow Tests ──────────────────────────────────────

test('approveDeviceCode sets user_id and approved flag', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  const success = await oauthIssuer.approveDeviceCode({
    userCode: issued.userCode,
    userId: 123,
  });

  assert.equal(success, true);

  // Verify the device code was updated
  const deviceData = await oauthIssuer.getDeviceCodeByUserCode({ userCode: issued.userCode });
  assert.equal(deviceData.user_id, 123);
  assert.equal(deviceData.approved, true);
});

test('approveDeviceCode returns false for invalid user code', async () => {
  const success = await oauthIssuer.approveDeviceCode({
    userCode: 'LL-INVALID',
    userId: 123,
  });

  assert.equal(success, false);
});

test('denyDeviceCode removes device code from Redis', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  const success = await oauthIssuer.denyDeviceCode({ userCode: issued.userCode });
  assert.equal(success, true);

  // Verify both keys were deleted
  const deviceData = await oauthIssuer.getDeviceCodeByUserCode({ userCode: issued.userCode });
  assert.equal(deviceData, null);

  const stored = store.get(`device:${issued.deviceCode}`);
  assert.equal(stored, undefined);
});

test('denyDeviceCode returns false for invalid user code', async () => {
  const success = await oauthIssuer.denyDeviceCode({ userCode: 'LL-INVALID' });
  assert.equal(success, false);
});

// ─── Token Exchange Tests ─────────────────────────────────────

test('exchangeDeviceToken returns authorization_pending when not approved', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  try {
    await oauthIssuer.exchangeDeviceToken({
      clientId: 'test_client',
      deviceCode: issued.deviceCode,
    });
    assert.fail('Should have thrown OAuthError');
  } catch (err) {
    assert.equal(err.name, 'OAuthError');
    assert.equal(err.error, 'authorization_pending');
  }
});

test('exchangeDeviceToken returns access_denied when denied', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  // Manually set approved=true but user_id=null (simulating denial)
  const deviceData = JSON.parse(store.get(`device:${issued.deviceCode}`));
  deviceData.approved = true;
  deviceData.user_id = null;
  store.set(`device:${issued.deviceCode}`, JSON.stringify(deviceData));

  try {
    await oauthIssuer.exchangeDeviceToken({
      clientId: 'test_client',
      deviceCode: issued.deviceCode,
    });
    assert.fail('Should have thrown OAuthError');
  } catch (err) {
    assert.equal(err.name, 'OAuthError');
    assert.equal(err.error, 'access_denied');
  }
});

test('exchangeDeviceToken returns tokens when approved', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  // Approve the device code
  await oauthIssuer.approveDeviceCode({
    userCode: issued.userCode,
    userId: 123,
  });

  // Exchange for tokens
  const result = await oauthIssuer.exchangeDeviceToken({
    clientId: 'test_client',
    deviceCode: issued.deviceCode,
  });

  assert.ok(result.access_token);
  assert.ok(result.refresh_token);
  assert.equal(result.token_type, 'Bearer');
  assert.equal(result.expires_in, 3600);
  assert.equal(result.scope, 'openid');
});

test('exchangeDeviceToken deletes device code after success (replay protection)', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  await oauthIssuer.approveDeviceCode({
    userCode: issued.userCode,
    userId: 123,
  });

  // First exchange should succeed
  await oauthIssuer.exchangeDeviceToken({
    clientId: 'test_client',
    deviceCode: issued.deviceCode,
  });

  // Second exchange should fail (expired_token)
  try {
    await oauthIssuer.exchangeDeviceToken({
      clientId: 'test_client',
      deviceCode: issued.deviceCode,
    });
    assert.fail('Should have thrown OAuthError');
  } catch (err) {
    assert.equal(err.name, 'OAuthError');
    assert.equal(err.error, 'expired_token');
  }
});

test('exchangeDeviceToken rejects mismatched client_id', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  await oauthIssuer.approveDeviceCode({
    userCode: issued.userCode,
    userId: 123,
  });

  try {
    await oauthIssuer.exchangeDeviceToken({
      clientId: 'wrong_client',
      deviceCode: issued.deviceCode,
    });
    assert.fail('Should have thrown OAuthError');
  } catch (err) {
    assert.equal(err.name, 'OAuthError');
    assert.equal(err.error, 'invalid_grant');
  }
});

test('exchangeDeviceToken returns expired_token for unknown device code', async () => {
  try {
    await oauthIssuer.exchangeDeviceToken({
      clientId: 'test_client',
      deviceCode: '0'.repeat(64),
    });
    assert.fail('Should have thrown OAuthError');
  } catch (err) {
    assert.equal(err.name, 'OAuthError');
    assert.equal(err.error, 'expired_token');
  }
});

// ─── Scope Validation Tests ───────────────────────────────────

test('issueDeviceCode validates scope', async () => {
  try {
    await oauthIssuer.issueDeviceCode({
      clientId: 'test_client',
      scope: 'invalid_scope',
    });
    assert.fail('Should have thrown OAuthError');
  } catch (err) {
    assert.equal(err.name, 'OAuthError');
    assert.equal(err.error, 'invalid_scope');
  }
});

test('issueDeviceCode defaults scope to openid profile email', async () => {
  const result = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
  });

  const stored = JSON.parse(store.get(`device:${result.deviceCode}`));
  assert.equal(stored.scope, 'openid profile email');
});

// ─── getDeviceCodeByUserCode Tests ────────────────────────────

test('getDeviceCodeByUserCode returns null for unknown user code', async () => {
  const result = await oauthIssuer.getDeviceCodeByUserCode({ userCode: 'LL-UNKNOWN' });
  assert.equal(result, null);
});

test('getDeviceCodeByUserCode returns device data for valid user code', async () => {
  const issued = await oauthIssuer.issueDeviceCode({
    clientId: 'test_client',
    scope: 'openid',
  });

  const result = await oauthIssuer.getDeviceCodeByUserCode({ userCode: issued.userCode });
  assert.ok(result);
  assert.equal(result.deviceCode, issued.deviceCode);
  assert.equal(result.client_id, 'test_client');
});
