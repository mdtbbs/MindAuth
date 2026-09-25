const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pkceChallenge, createNativeAuthService, NativeAuthError, verifyPhoneActionTicket } = require('../../src/modules/nativeAuth/nativeAuthService');

process.env.NATIVE_AUTH_HMAC_SECRET = 'native-auth-test-secret';
process.env.NATIVE_PHONE_ACTION_SECRET = 'native-phone-action-test-secret';

function phoneTicket(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signed = `npa.${payload}`;
  return `${signed}.${crypto.createHmac('sha256', process.env.NATIVE_PHONE_ACTION_SECRET).update(signed).digest('base64url')}`;
}

test('PKCE S256 challenge is RFC 7636 base64url SHA-256', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('transaction only accepts S256 and returns the registered methods', async () => {
  const calls = [];
  const service = createNativeAuthService({
    pool: { execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT client_id')) return [[{ client_id: 'mdtbbs_android', enabled: 1, allowed_methods: '["password","sms","qq"]', pkce_required: 1 }]];
      if (sql.startsWith('INSERT INTO native_auth_audit_logs')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    } },
    redis: { incr: async () => 1, expire: async () => {} },
  });
  const result = await service.createTransaction({ clientId: 'mdtbbs_android', codeChallenge: 'A'.repeat(43), codeChallengeMethod: 'S256', req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } });
  assert.equal(result.expires_in, 600);
  assert.deepEqual(result.methods, ['password', 'sms', 'qq']);
  await assert.rejects(() => service.createTransaction({ clientId: 'mdtbbs_android', codeChallenge: 'A'.repeat(43), codeChallengeMethod: 'plain', req: { headers: {} } }), (err) => err instanceof NativeAuthError && err.code === 'PKCE_S256_REQUIRED');
  assert.ok(calls.some(({ sql }) => sql.startsWith('INSERT INTO native_auth_transactions')));
});

test('Mindustry public native client requires S256 and exposes password only', async () => {
  const calls = [];
  const service = createNativeAuthService({
    pool: { execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT client_id')) return [[{
        client_id: 'mdtbbs_mindustry', enabled: 1, allowed_methods: '["password"]', pkce_required: 1,
      }]];
      if (sql.startsWith('INSERT INTO native_auth_audit_logs')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    } },
    redis: { incr: async () => 1, expire: async () => {} },
  });

  const result = await service.createTransaction({
    clientId: 'mdtbbs_mindustry', codeChallenge: 'A'.repeat(43), codeChallengeMethod: 'S256',
    req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
  });
  assert.deepEqual(result.methods, ['password']);
  assert.ok(calls.some(({ sql, params }) => sql.startsWith('INSERT INTO native_auth_transactions') && params[1] === 'mdtbbs_mindustry'));
});

test('Mindustry authorization code exchange stays server-client authenticated and client-bound', async () => {
  process.env.NATIVE_MINDFOURM_CLIENT_SECRET = 'server-only-exchange-secret';
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const now = new Date();
  const calls = [];
  const service = createNativeAuthService({
    pool: { execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT client_id')) return [[{
        client_id: 'mdtbbs_mindustry', enabled: 1, allowed_methods: '["password"]', pkce_required: 1,
      }]];
      if (sql.startsWith('SELECT c.*, NOW() AS db_now, u.username')) return [[{
        id: 12, client_id: 'mdtbbs_mindustry', user_id: 7, transaction_id: 3,
        expires_at: new Date(now.getTime() + 60_000), db_now: now,
        code_challenge: pkceChallenge(verifier), auth_method: 'password',
        username: 'builder', email: 'builder@example.test', avatar_url: null, phone_verified: 0,
      }]];
      if (sql.startsWith('UPDATE native_authorization_codes')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    } },
  });

  const result = await service.exchange({
    clientId: 'mdtbbs_mindustry', clientSecret: process.env.NATIVE_MINDFOURM_CLIENT_SECRET,
    code: 'one-time-code', codeVerifier: verifier,
    req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
  });
  assert.equal(result.user.id, 7);
  assert.equal(result.user.username, 'builder');
  assert.ok(calls.some(({ sql, params }) => sql.startsWith('SELECT client_id') && params[0] === 'mdtbbs_mindustry'));
  await assert.rejects(() => service.exchange({
    clientId: 'unregistered-client', clientSecret: process.env.NATIVE_MINDFOURM_CLIENT_SECRET,
    code: 'one-time-code', codeVerifier: verifier, req: { headers: {} },
  }), (err) => err instanceof NativeAuthError && err.code === 'INVALID_CLIENT');
});

test('phone action ticket requires a valid signature, audience, and expiry', () => {
  const valid = phoneTicket({ sub: 7, jti: 'one-time-ticket-id', aud: 'mindauth-native-phone', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.deepEqual(verifyPhoneActionTicket(valid).sub, 7);
  assert.throws(() => verifyPhoneActionTicket(`${valid}x`), (err) => err instanceof NativeAuthError && err.code === 'PHONE_ACTION_INVALID');
  const expired = phoneTicket({ sub: 7, jti: 'expired-ticket-id', aud: 'mindauth-native-phone', exp: 1 });
  assert.throws(() => verifyPhoneActionTicket(expired), (err) => err instanceof NativeAuthError && err.code === 'PHONE_ACTION_INVALID');
});
