const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../src/db');
const tokenStore = require('../../src/modules/oauth/tokenStore');
const issuer = require('../../src/modules/oauth/oauthIssuer');
const { hashClientSecret } = require('../../src/utils/secrets');

const publicClient = (overrides = {}) => ({
  id: 9, client_id: 'public-app', client_secret: null, status: 'approved',
  client_type: 'public', party_type: 'third_party', require_pkce: 1,
  approved_scopes: JSON.stringify(['openid', 'profile', 'forum.read']), ...overrides,
});

function install(t, { client = publicClient(), code, execute, connection } = {}) {
  const previous = {
    execute: db.pool.execute,
    getConnection: db.pool.getConnection,
    consumeAuthCode: tokenStore.consumeAuthCode,
    storeAccessToken: tokenStore.storeAccessToken,
    getAccessToken: tokenStore.getAccessToken,
    revokeAccessToken: tokenStore.revokeAccessToken,
  };
  db.pool.execute = execute || (async (sql) => {
    if (/SELECT \* FROM clients/.test(sql)) return [[client]];
    if (/FROM oauth_client_redirect_uris/.test(sql)) {
      return [[{ redirect_uri: client.redirect_uri || validCode.redirect_uri, redirect_type: 'custom_scheme' }]];
    }
    if (/SELECT id, username, email/.test(sql)) return [[{ id: 4, username: 'user', email: 'u@example.org', ban_status: 'active' }]];
    if (/INSERT INTO refresh_tokens/.test(sql)) return [{ insertId: 1 }];
    return [[], []];
  });
  if (connection) db.pool.getConnection = async () => connection;
  tokenStore.consumeAuthCode = async () => code;
  tokenStore.storeAccessToken = async () => undefined;
  t.after(() => {
    db.pool.execute = previous.execute;
    db.pool.getConnection = previous.getConnection;
    tokenStore.consumeAuthCode = previous.consumeAuthCode;
    tokenStore.storeAccessToken = previous.storeAccessToken;
    tokenStore.getAccessToken = previous.getAccessToken;
    tokenStore.revokeAccessToken = previous.revokeAccessToken;
  });
}

const validCode = {
  client_id: 'public-app', user_id: 4, scope: 'openid forum.read',
  redirect_uri: 'com.example.app:/oauth2redirect',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
};
const validExchange = {
  code: 'one-time-code', clientId: 'public-app', clientSecret: undefined,
  redirectUri: validCode.redirect_uri,
  codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
};

test('Public Client exchanges an authorization code with PKCE and no secret', async (t) => {
  install(t, { code: { ...validCode } });
  const result = await issuer.exchangeCode(validExchange);
  assert.equal(result.token_type, 'Bearer');
  assert.equal(result.scope, 'openid forum.read');
  assert.equal(typeof result.refresh_token, 'string');
});

test('Public Client requires the PKCE verifier and rejects a mismatch', async (t) => {
  install(t, { code: { ...validCode } });
  await assert.rejects(issuer.exchangeCode({ ...validExchange, codeVerifier: undefined }), (error) => error.error === 'invalid_request');
  install(t, { code: { ...validCode } });
  await assert.rejects(issuer.exchangeCode({ ...validExchange, codeVerifier: 'wrong-verifier-which-is-long-enough-to-be-invalid-0000' }), (error) => error.error === 'invalid_grant');
});

test('authorization codes stay client-bound and redirect-bound, and reject replay', async (t) => {
  install(t, { code: { ...validCode } });
  await assert.rejects(issuer.exchangeCode({ ...validExchange, clientId: 'other-app' }), (error) => error.error === 'invalid_grant');
  install(t, { code: { ...validCode } });
  await assert.rejects(issuer.exchangeCode({ ...validExchange, redirectUri: 'com.example.app:/other' }), (error) => error.error === 'invalid_grant');
  install(t, { code: null });
  await assert.rejects(issuer.exchangeCode(validExchange), (error) => error.error === 'invalid_grant');
});

test('confidential clients still require their secret; suspended clients cannot exchange codes', async (t) => {
  const confidential = publicClient({ client_type: 'confidential', client_secret: hashClientSecret('server-secret'), require_pkce: 1 });
  install(t, { client: confidential, code: { ...validCode, client_id: 'public-app' } });
  await assert.rejects(issuer.exchangeCode({ ...validExchange, clientSecret: undefined }), (error) => error.error === 'invalid_client');
  install(t, { client: publicClient({ status: 'suspended' }), code: { ...validCode } });
  await assert.rejects(issuer.exchangeCode(validExchange), (error) => error.error === 'invalid_client');
});

test('deleted Public Clients cannot exchange new authorization codes', async (t) => {
  install(t, { client: publicClient({ status: 'deleted' }), code: { ...validCode } });
  let consumed = 0;
  tokenStore.consumeAuthCode = async () => { consumed++; return null; };
  await assert.rejects(issuer.exchangeCode(validExchange), (error) => error.error === 'invalid_client');
  assert.equal(consumed, 0, 'a deleted client is rejected before consuming authorization codes');
});

test('authorization code cannot escalate beyond approved scopes', async (t) => {
  install(t, { code: { ...validCode, scope: 'openid message.write' } });
  await assert.rejects(issuer.exchangeCode(validExchange), (error) => error.error === 'invalid_grant');
});

test('Public Client refresh rotates tokens and replay revokes the refresh-token family', async (t) => {
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql) => {
      if (/SELECT \* FROM clients/.test(sql)) return [[publicClient()]];
      if (/SELECT \* FROM refresh_tokens/.test(sql)) return [[{ id: 1, user_id: 4, client_id: 'public-app', revoked: 0, expires_at: new Date(Date.now() + 60_000), scope: 'openid forum.read' }]];
      if (/SELECT id, username, email/.test(sql)) return [[{ id: 4, username: 'user', email: 'u@example.org', ban_status: 'active' }]];
      return [{ affectedRows: 1 }];
    },
  };
  install(t, { connection, code: null });
  const result = await issuer.refresh({ refreshToken: 'refresh-old', clientId: 'public-app' });
  assert.equal(result.token_type, 'Bearer');
  assert.equal(result.scope, 'openid forum.read');
  assert.ok(result.refresh_token);

  let familyRevoked = false;
  const replayConnection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql) => {
      if (/SELECT \* FROM clients/.test(sql)) return [[publicClient()]];
      if (/SELECT \* FROM refresh_tokens/.test(sql)) return [[{ id: 1, user_id: 4, client_id: 'public-app', revoked: 1, expires_at: new Date(Date.now() + 60_000), scope: 'openid forum.read' }]];
      if (/UPDATE refresh_tokens SET revoked = 1 WHERE user_id/.test(sql)) familyRevoked = true;
      return [{ affectedRows: 1 }];
    },
  };
  install(t, { connection: replayConnection, code: null });
  await assert.rejects(issuer.refresh({ refreshToken: 'refresh-old', clientId: 'public-app' }), (error) => error.error === 'invalid_grant');
  assert.equal(familyRevoked, true);
});

test('Public Client can revoke its own token without a secret; confidential-only introspection stays protected', async (t) => {
  install(t, { code: null });
  tokenStore.getAccessToken = async () => ({ client_id: 'public-app' });
  tokenStore.revokeAccessToken = async () => undefined;
  await assert.deepEqual(await issuer.revoke({ token: 'public-access-token', clientId: 'public-app' }), { success: true });
  await assert.rejects(issuer.introspect({ token: 'public-access-token', clientId: 'public-app' }), (error) => error.error === 'invalid_client');
});
