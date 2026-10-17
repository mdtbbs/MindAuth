const { test } = require('node:test');
const assert = require('node:assert/strict');
const issuer = require('../../src/modules/oauth/oauthIssuer');
const { pool } = require('../../src/db');
const tokenStore = require('../../src/modules/oauth/tokenStore');
const sessionManager = require('../../src/modules/sessions/sessionManager');

test('PKCE S256 matches the RFC 7636 verifier/challenge vector', () => {
  assert.equal(issuer._verifyPkce(
    'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  ), true);
  assert.equal(issuer._verifyPkce('wrong-verifier', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'), false);
});

test('redirect matching requires an exact registration except for a loopback random port', () => {
  assert.equal(issuer._redirectUriMatches('com.example.client:/oauth2redirect', 'com.example.client:/oauth2redirect'), true);
  assert.equal(issuer._redirectUriMatches('com.example.client:/other', 'com.example.client:/oauth2redirect'), false);
  assert.equal(issuer._redirectUriMatches('http://127.0.0.1:51321/callback', 'http://127.0.0.1:0/callback'), true);
  assert.equal(issuer._redirectUriMatches('http://192.168.1.20:51321/callback', 'http://127.0.0.1:0/callback'), false);
  assert.equal(issuer._redirectUriMatches('http://192.168.1.20/callback', 'http://192.168.1.20/callback'), true);
  assert.equal(issuer._redirectUriMatches('http://192.168.1.21/callback', 'http://192.168.1.20/callback'), false);
  assert.equal(issuer._redirectUriMatches('http://127.0.0.1:51321/other', 'http://127.0.0.1:0/callback'), false);
});

test('requested scopes cannot exceed the approved scope set', () => {
  const client = { approved_scopes: JSON.stringify(['openid', 'profile', 'forum.read', 'game_content.saves.read']) };
  assert.deepEqual(issuer._requestedScopes('openid forum.read', client), ['openid', 'forum.read']);
  assert.deepEqual(issuer._requestedScopes('game_content.saves.read', client), ['game_content.saves.read']);
  assert.throws(() => issuer._requestedScopes('game_content.saves.write', client), (error) => error.error === 'invalid_scope');
  assert.throws(() => issuer._requestedScopes('openid message.write', client), (error) => error.error === 'invalid_scope');
});

test('previously granted scopes skip consent while newly requested scopes are identified', async () => {
  const originalExecute = pool.execute;
  const originalStoreAuthCode = tokenStore.storeAuthCode;
  const originalAuthenticate = sessionManager.authenticateUserSession;
  const previousGrant = 'profile forum.read';
  const client = {
    id: 4, client_id: 'public-app', name: 'Community App', description: 'A test app',
    client_type: 'public', party_type: 'third_party', status: 'approved', owner_user_id: null,
    redirect_uri: 'http://localhost:0/callback', require_pkce: 1,
    approved_scopes: ['profile', 'forum.read', 'message.read'],
  };
  let storedCodeCount = 0;
  try {
    pool.execute = async (sql) => {
      if (sql.startsWith('SELECT * FROM clients')) return [[client]];
      if (sql.startsWith('SELECT redirect_uri')) return [[]];
      if (sql.startsWith('SELECT scope FROM authorizations')) return [[{ scope: previousGrant }]];
      return [{ insertId: 1 }];
    };
    tokenStore.storeAuthCode = async () => { storedCodeCount++; };
    sessionManager.authenticateUserSession = async () => ({ user: { id: 42 } });

    const common = {
      clientId: 'public-app', redirectUri: 'http://localhost:49152/callback', state: 'random-state',
      scope: 'profile forum.read', codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256',
      sessionToken: 'session-token', ipAddress: '127.0.0.1',
    };
    const existing = await issuer.authorize(common);
    assert.ok(existing.redirectTo, 'an identical previously granted request proceeds without a consent page');
    assert.equal(storedCodeCount, 1);

    const additional = await issuer.authorize({ ...common, scope: 'profile forum.read message.read', previewOnly: true });
    assert.equal(additional.consentRequired, true);
    assert.deepEqual(additional.previousScopes, ['profile', 'forum.read']);
    assert.deepEqual(additional.newScopes, ['message.read']);
    assert.equal(storedCodeCount, 1, 'the preview does not issue an authorization code');
  } finally {
    pool.execute = originalExecute;
    tokenStore.storeAuthCode = originalStoreAuthCode;
    sessionManager.authenticateUserSession = originalAuthenticate;
  }
});

test('first-party forum authorization grants approved scopes without a consent decision', async () => {
  const originalExecute = pool.execute;
  const originalStoreAuthCode = tokenStore.storeAuthCode;
  const originalAuthenticate = sessionManager.authenticateUserSession;
  const client = {
    id: 9, client_id: 'forum', name: 'MindFourm', client_type: 'confidential',
    party_type: 'first_party', status: 'approved', owner_user_id: null,
    redirect_uri: 'http://localhost:4000/api/auth/callback',
    approved_scopes: ['openid', 'profile', 'email'],
  };
  let storedCodeCount = 0;
  let writtenAuthorization;
  try {
    pool.execute = async (sql, params = []) => {
      if (sql.startsWith('SELECT * FROM clients')) return [[client]];
      if (sql.startsWith('SELECT redirect_uri')) return [[]];
      if (sql.startsWith('SELECT scope FROM authorizations')) return [[]];
      if (sql.includes('INSERT INTO authorizations')) writtenAuthorization = params;
      return [{ insertId: 1 }];
    };
    tokenStore.storeAuthCode = async () => { storedCodeCount++; };
    sessionManager.authenticateUserSession = async () => ({ user: { id: 42 } });

    const common = {
      clientId: 'forum', redirectUri: client.redirect_uri, state: 'forum-login',
      scope: 'openid profile email', sessionToken: 'session-token', ipAddress: '127.0.0.1',
    };
    const preview = await issuer.authorize({ ...common, previewOnly: true });
    assert.equal(preview.consentRequired, false, 'the consent page should auto-continue for the forum');

    const result = await issuer.authorize(common);
    const destination = new URL(result.redirectTo);
    assert.equal(destination.origin + destination.pathname, client.redirect_uri);
    assert.equal(destination.searchParams.get('state'), 'forum-login');
    assert.ok(destination.searchParams.get('code'));
    assert.equal(storedCodeCount, 1);
    assert.equal(writtenAuthorization[2], 'openid profile email');
  } finally {
    pool.execute = originalExecute;
    tokenStore.storeAuthCode = originalStoreAuthCode;
    sessionManager.authenticateUserSession = originalAuthenticate;
  }
});

test('the forum option accepts old request names but grants the whole group with new consent', async () => {
  const { normalizeScopes, applicationScopes } = require('../../src/modules/oauth/scopes');
  const basic = { approved_scopes: applicationScopes({ forum_access: false }) };
  const forum = { approved_scopes: applicationScopes({ forum_access: true }) };
  assert.deepEqual(issuer._requestedScopes('', basic), ['openid', 'profile']);
  assert.throws(() => issuer._requestedScopes('forum.read', basic), error => error.error === 'invalid_scope');
  assert.throws(() => issuer._requestedScopes('forum', basic), error => error.error === 'invalid_scope');
  const granted = issuer._requestedScopes('profile forum.write', forum);
  assert.ok(granted.includes('forum'));
  for (const scope of ['multiplayer.write', 'presence.write', 'message.read', 'game_content.saves.delete']) {
    assert.ok(granted.includes(scope), scope);
  }
  assert.deepEqual(issuer._requestedScopes('openid profile', forum), ['openid', 'profile']);
  // Normalizing a previously issued narrow grant must never add permissions.
  assert.deepEqual(normalizeScopes('profile forum.read'), ['profile', 'forum.read']);
  assert.throws(() => applicationScopes({ forum_access: 'false' }), /布尔值/);
});

test('a previous narrow forum grant requires consent before the complete forum group is issued', async () => {
  const originalExecute = pool.execute;
  const originalAuthenticate = sessionManager.authenticateUserSession;
  const originalStoreCode = tokenStore.storeAuthCode;
  const client = {
    id: 4, client_id: 'forum-group-app', name: 'Forum app', client_type: 'public', party_type: 'third_party',
    status: 'approved', redirect_uri: 'https://app.example/callback', approved_scopes: ['openid', 'profile', 'forum'],
  };
  let issued;
  try {
    pool.execute = async sql => {
      if (sql.startsWith('SELECT * FROM clients')) return [[client]];
      if (sql.startsWith('SELECT redirect_uri')) return [[]];
      if (sql.startsWith('SELECT scope FROM authorizations')) return [[{ scope: 'openid profile forum.read' }]];
      return [{ affectedRows: 1 }];
    };
    sessionManager.authenticateUserSession = async () => ({ user: { id: 42 } });
    tokenStore.storeAuthCode = async (_code, payload) => { issued = payload; };
    const request = {
      clientId: client.client_id, redirectUri: client.redirect_uri, state: 'random-login-state',
      scope: 'profile forum.read', codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256', sessionToken: 'session',
    };
    const pending = await issuer.authorize(request);
    assert.equal(pending.consentRequired, true);
    assert.ok(pending.newScopes.includes('forum.write'));
    assert.ok(pending.newScopes.includes('game_content.saves.delete'));
    assert.equal(issued, undefined);
    await issuer.authorize({ ...request, consentGranted: true });
    assert.ok(issued.scope.split(' ').includes('forum'));
  } finally {
    pool.execute = originalExecute;
    sessionManager.authenticateUserSession = originalAuthenticate;
    tokenStore.storeAuthCode = originalStoreCode;
  }
});

test('a downgraded app cannot use an old access token even when its Redis payload remains', async () => {
  const originalExecute = pool.execute;
  const originalGetToken = tokenStore.getAccessToken;
  try {
    pool.execute = async sql => {
      if (sql.startsWith('SELECT * FROM clients')) return [[{
        client_id: 'forum', client_secret: 'server-secret', client_type: 'confidential', party_type: 'first_party', status: 'approved',
      }]];
      if (sql.startsWith('SELECT status, approved_scopes')) return [[{ status: 'approved', approved_scopes: ['openid', 'profile'] }]];
      throw new Error('scope downgrade must reject before further reads');
    };
    tokenStore.getAccessToken = async () => ({ user_id: 42, client_id: 'downgraded-app', scope: 'openid profile forum.write' });
    assert.deepEqual(await issuer.introspect({ token: 'old-token', clientId: 'forum', clientSecret: 'server-secret' }), { active: false });
    await assert.rejects(issuer.userinfo('old-token'), error => error.error === 'invalid_token');
  } finally { pool.execute = originalExecute; tokenStore.getAccessToken = originalGetToken; }
});
