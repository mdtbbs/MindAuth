const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

// -- Redis Mock --
const mockRedisStore = new Map();
const mockRedisClient = {
  get: async (key) => mockRedisStore.get(key) || null,
  setEx: async (key, ttl, value) => { mockRedisStore.set(key, value); return 'OK'; },
  del: async (key) => { mockRedisStore.delete(key); return 1; },
  incr: async (key) => {
    const val = parseInt(mockRedisStore.get(key) || '0') + 1;
    mockRedisStore.set(key, String(val));
    return val;
  },
  expire: async (key, ttl) => 'OK',
};

// -- DB Mock --
const mockQueryResults = new Map();
const mockPool = {
  execute: async (sql, params) => {
    const key = sql.trim().split(' ').slice(0, 3).join(' ');
    if (mockQueryResults.has(key)) return [mockQueryResults.get(key)(params)];
    return [[]];
  },
};

function setupMocks() {
  const redisPath = require.resolve('../../src/redis');
  require.cache[redisPath] = {
    id: redisPath, filename: redisPath, loaded: true,
    exports: { client: mockRedisClient },
  };

  const dbPath = require.resolve('../../src/db');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: { pool: mockPool },
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  mockRedisStore.clear();
  mockQueryResults.clear();
  delete require.cache[require.resolve('../../src/utils/auditLog')];
  delete require.cache[require.resolve('../../src/utils/notify')];
  delete require.cache[require.resolve('../../src/utils/deviceInfo')];
});

// -- auditLog tests --

test('logAudit inserts audit record without throwing', async () => {
  setupMocks();
  const { logAudit } = require('../../src/utils/auditLog');

  // Should not throw even if DB call succeeds silently
  await assert.doesNotReject(() => logAudit({
    admin_id: 1,
    action: 'user.ban',
    target_type: 'user',
    target_id: 42,
    details: { reason: 'test' },
    ip_address: '127.0.0.1',
  }));
});

test('logAudit handles null optional fields', async () => {
  setupMocks();
  const { logAudit } = require('../../src/utils/auditLog');

  await assert.doesNotReject(() => logAudit({
    admin_id: 1,
    action: 'config.email',
  }));
});

// -- deviceInfo tests --

test('parseDeviceInfo detects Chrome on Windows', () => {
  const { parseDeviceInfo } = require('../../src/utils/deviceInfo');
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const result = parseDeviceInfo(ua);
  assert.ok(result.includes('Chrome'), `should detect Chrome, got: ${result}`);
  assert.ok(result.includes('Windows'), `should detect Windows, got: ${result}`);
});

test('parseDeviceInfo detects Firefox on Linux', () => {
  const { parseDeviceInfo } = require('../../src/utils/deviceInfo');
  const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
  const result = parseDeviceInfo(ua);
  assert.ok(result.includes('Firefox'), `should detect Firefox, got: ${result}`);
  assert.ok(result.includes('Linux'), `should detect Linux, got: ${result}`);
});

test('parseDeviceInfo detects Safari on macOS', () => {
  const { parseDeviceInfo } = require('../../src/utils/deviceInfo');
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const result = parseDeviceInfo(ua);
  assert.ok(result.includes('Safari'), `should detect Safari, got: ${result}`);
  assert.ok(result.includes('macOS'), `should detect macOS, got: ${result}`);
});

test('parseDeviceInfo detects Edge on Windows', () => {
  const { parseDeviceInfo } = require('../../src/utils/deviceInfo');
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
  const result = parseDeviceInfo(ua);
  assert.ok(result.includes('Edge'), `should detect Edge, got: ${result}`);
});

test('parseDeviceInfo returns Unknown for empty input', () => {
  const { parseDeviceInfo } = require('../../src/utils/deviceInfo');
  assert.equal(parseDeviceInfo(''), 'Unknown');
  assert.equal(parseDeviceInfo(null), 'Unknown');
  assert.equal(parseDeviceInfo(undefined), 'Unknown');
});

test('parseDeviceInfo truncates to 200 chars', () => {
  const { parseDeviceInfo } = require('../../src/utils/deviceInfo');
  const longUA = 'A'.repeat(300);
  assert.ok(parseDeviceInfo(longUA).length <= 200);
});

// -- ipBan CIDR tests --

test('ipBan middleware allows non-banned IP', async () => {
  setupMocks();
  const { ipBanMiddleware } = require('../../src/middleware/ipBan');

  // Cache an empty ban list
  mockRedisStore.set('ip_bans_cache', JSON.stringify([]));

  const mockReq = { ip: '1.2.3.4', headers: {}, connection: { remoteAddress: '1.2.3.4' } };
  let nextCalled = false;
  const mockRes = { status: () => ({ json: () => {} }) };
  const mockNext = () => { nextCalled = true; };

  await ipBanMiddleware(mockReq, mockRes, mockNext);
  assert.ok(nextCalled, 'next() should be called for non-banned IP');
});

test('ipBan middleware blocks exact IP match', async () => {
  setupMocks();
  const { ipBanMiddleware } = require('../../src/middleware/ipBan');

  mockRedisStore.set('ip_bans_cache', JSON.stringify([
    { ip_address: '10.0.0.1', cidr_prefix: null, reason: 'test ban', expires_at: null }
  ]));

  let respondedWith = null;
  const mockReq = { ip: '10.0.0.1', headers: {}, connection: { remoteAddress: '10.0.0.1' } };
  const mockRes = {
    status: (code) => {
      respondedWith = code;
      return { json: () => {} };
    },
  };
  const mockNext = () => { assert.fail('next() should NOT be called for banned IP'); };

  await ipBanMiddleware(mockReq, mockRes, mockNext);
  assert.equal(respondedWith, 403);
});

test('ipBan middleware ignores expired bans', async () => {
  setupMocks();
  const { ipBanMiddleware } = require('../../src/middleware/ipBan');

  mockRedisStore.set('ip_bans_cache', JSON.stringify([
    { ip_address: '10.0.0.1', cidr_prefix: null, reason: 'expired', expires_at: '2020-01-01T00:00:00Z' }
  ]));

  let nextCalled = false;
  const mockReq = { ip: '10.0.0.1', headers: {}, connection: { remoteAddress: '10.0.0.1' } };
  const mockRes = { status: () => ({ json: () => {} }) };
  const mockNext = () => { nextCalled = true; };

  await ipBanMiddleware(mockReq, mockRes, mockNext);
  assert.ok(nextCalled, 'expired ban should not block');
});

test('ipBan middleware blocks CIDR /24 subnet', async () => {
  setupMocks();
  const { ipBanMiddleware } = require('../../src/middleware/ipBan');

  mockRedisStore.set('ip_bans_cache', JSON.stringify([
    { ip_address: '192.168.1.0', cidr_prefix: 24, reason: 'subnet ban', expires_at: null }
  ]));

  let blocked = false;
  const mockReq = { ip: '192.168.1.100', headers: {}, connection: { remoteAddress: '192.168.1.100' } };
  const mockRes = {
    status: (code) => { blocked = (code === 403); return { json: () => {} }; },
  };
  const mockNext = () => {};

  await ipBanMiddleware(mockReq, mockRes, mockNext);
  assert.ok(blocked, 'IP in /24 subnet should be blocked');
});

test('ipBan middleware allows IP outside CIDR range', async () => {
  setupMocks();
  const { ipBanMiddleware } = require('../../src/middleware/ipBan');

  mockRedisStore.set('ip_bans_cache', JSON.stringify([
    { ip_address: '192.168.1.0', cidr_prefix: 24, reason: 'subnet ban', expires_at: null }
  ]));

  let nextCalled = false;
  const mockReq = { ip: '192.168.2.50', headers: {}, connection: { remoteAddress: '192.168.2.50' } };
  const mockRes = { status: () => ({ json: () => {} }) };
  const mockNext = () => { nextCalled = true; };

  await ipBanMiddleware(mockReq, mockRes, mockNext);
  assert.ok(nextCalled, 'IP outside /24 subnet should not be blocked');
});

test('ipBan middleware blocks CIDR /16 subnet', async () => {
  setupMocks();
  const { ipBanMiddleware } = require('../../src/middleware/ipBan');

  mockRedisStore.set('ip_bans_cache', JSON.stringify([
    { ip_address: '10.0.0.0', cidr_prefix: 16, reason: 'big subnet', expires_at: null }
  ]));

  let blocked = false;
  const mockReq = { ip: '10.0.99.1', headers: {}, connection: { remoteAddress: '10.0.99.1' } };
  const mockRes = {
    status: (code) => { blocked = (code === 403); return { json: () => {} }; },
  };

  await ipBanMiddleware(mockReq, mockRes, () => {});
  assert.ok(blocked, 'IP in /16 subnet should be blocked');
});
