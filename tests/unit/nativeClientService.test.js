const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeClientService, OFFICIAL_CLIENT_ID, NativeClientError } = require('../../src/modules/nativeAuth/nativeClientService');

function fixture() {
  const calls = [];
  const keys = new Map();
  const pool = { execute: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT * FROM native_auth_clients')) return [[{ enabled: 1, token_audience_client_id: 'forum' }]];
    if (sql.startsWith('SELECT id FROM login_logs')) return [[]];
    if (sql.startsWith('SELECT ip FROM login_logs')) return [[]];
    if (sql.startsWith('SELECT r.native_session_id')) return [[{ native_session_id: 42 }]];
    if (sql.startsWith('INSERT INTO native_client_sessions')) return [{ insertId: 42 }];
    return [{ affectedRows: 1 }];
  } };
  const redis = { incr: async (key) => { const n = (keys.get(key) || 0) + 1; keys.set(key, n); return n; }, expire: async () => {}, get: async () => null, setEx: async () => {} };
  const emitted = [];
  const issued = [];
  const issuer = {
    issueNativeTokens: async (args) => { issued.push(args); return { access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600, scope: args.scope }; },
    refreshNative: async (args) => args,
    revokeNativeSession: async (id) => emitted.push(id),
    userinfo: async () => ({ sub: '5', username: 'player', avatar_url: '/a.png', phone_verified: true, ban_status: 'none', is_muted: false, email: 'private@example.com' }),
  };
  const store = { getAccessToken: async () => ({ user_id: 5, native_session_id: 42 }) };
  const service = createNativeClientService({ pool, redis, auth: async () => ({ ok: true, user: { id: 5 } }), issuer, store, notify: { create: async () => {} } });
  return { service, calls, keys, issued, emitted, issuer };
}

const req = { headers: { 'user-agent': 'Mindustry Linux' }, socket: { remoteAddress: '192.0.2.10' } };
const deviceId = '3f764e93-8d14-4a53-8c11-123456789abc';

test('only configured official client can create a password device session', async () => {
  const { service, calls, issued } = fixture();
  const result = await service.login({ clientId: OFFICIAL_CLIENT_ID, login: 'player', password: 'secret', deviceId, deviceName: 'Mindustry Linux', req });
  assert.equal(result.success, true);
  assert.equal(issued[0].accessClientId, 'forum');
  assert.equal(issued[0].nativeSessionId, 42);
  const loginLog = calls.find(c => c.sql.startsWith('INSERT INTO login_logs'));
  assert.deepEqual(loginLog.params.slice(3), ['native', OFFICIAL_CLIENT_ID, deviceId, 'Mindustry Linux']);
  assert.equal(JSON.stringify(calls).includes('secret'), false);
});

test('rejects spoofed clients and unsafe device metadata before password validation', async () => {
  const { service } = fixture();
  await assert.rejects(() => service.login({ clientId: 'spoofed', login: 'player', password: 'secret', deviceId, req }), e => e.code === 'INVALID_CLIENT');
  await assert.rejects(() => service.login({ clientId: OFFICIAL_CLIENT_ID, login: 'player', password: 'secret', deviceId: 'machine-id', req }), e => e.code === 'INVALID_REQUEST');
  await assert.rejects(() => service.login({ clientId: OFFICIAL_CLIENT_ID, login: 'player', password: 'secret', deviceId, deviceName: '<b>x</b>', req }), e => e instanceof NativeClientError && e.code === 'INVALID_REQUEST');
});

test('refresh binds both configured client and stable device id', async () => {
  const { service } = fixture();
  const result = await service.refresh({ clientId: OFFICIAL_CLIENT_ID, refreshToken: 'r'.repeat(40), deviceId });
  assert.equal(result.accessClientId, 'forum');
  assert.equal(result.deviceId, deviceId);
  await assert.rejects(() => service.refresh({ clientId: OFFICIAL_CLIENT_ID, refreshToken: 'short', deviceId }), e => e.code === 'INVALID_REFRESH_TOKEN');
});

test('logout and me require a native access token and me returns only safe fields', async () => {
  const { service, emitted } = fixture();
  assert.deepEqual(await service.logout({ accessToken: 'access', userId: 5 }), { success: true });
  assert.deepEqual(emitted, [42]);
  assert.deepEqual(await service.me({ accessToken: 'access' }), {
    id: 5, username: 'player', avatar_url: '/a.png', phone_verified: true, ban_status: 'none', is_muted: false,
  });
});

test('an expired access token can still be logged out with its bound refresh credential', async () => {
  const { service, emitted } = fixture();
  assert.deepEqual(await service.logout({ clientId: OFFICIAL_CLIENT_ID, refreshToken: 'r'.repeat(40), deviceId }), { success: true });
  assert.deepEqual(emitted, [42]);
});
