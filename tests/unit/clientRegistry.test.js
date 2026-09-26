/**
 * Unit tests for clientRegistry.validateRedirectUri — the SSRF guard that
 * blocks OAuth redirect URIs pointing at localhost, private ranges, or cloud
 * metadata endpoints. Pure function; no DB/Redis required.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateRedirectUri, validateApplication, assertPhoneVerifiedDeveloper, createOwnerApplication, updateOwnerApplication, deleteOwnerApplication, updateClient } = require('../../src/modules/admin/clientRegistry');
const { pool } = require('../../src/db');
const tokenStore = require('../../src/modules/oauth/tokenStore');

test('accepts a normal public https URL', () => {
  assert.equal(validateRedirectUri('https://forum.example.com/callback').valid, true);
});

test('accepts a public http URL', () => {
  assert.equal(validateRedirectUri('http://app.example.org/oauth/cb').valid, true);
});

test('rejects empty / missing URI', () => {
  assert.equal(validateRedirectUri('').valid, false);
  assert.equal(validateRedirectUri(undefined).valid, false);
});

test('rejects malformed URLs', () => {
  assert.equal(validateRedirectUri('not-a-url').valid, false);
});

test('rejects non-http(s) protocols', () => {
  assert.equal(validateRedirectUri('ftp://example.com/x').valid, false);
  assert.equal(validateRedirectUri('javascript:alert(1)').valid, false);
});

test('allows only explicit loopback literals for native application redirects', () => {
  for (const uri of [
    'http://127.0.0.1:0/callback',
    'http://127.0.0.1:49152/callback',
    'http://[::1]:0/callback',
    'http://[::1]:49152/callback',
    'http://localhost:0/callback',
    'http://localhost:49152/callback',
  ]) assert.equal(validateRedirectUri(uri).valid, true, `${uri} must be accepted`);

  for (const uri of [
    'http://0.0.0.0/cb',
    'https://api.localhost/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, false, `${uri} must be blocked`);
  }
});

test('accepts valid custom application schemes and rejects dangerous schemes', () => {
  assert.equal(validateRedirectUri('xenon://oauth/callback').valid, true);
  assert.equal(validateRedirectUri('mdtbbs://oauth/callback').valid, true);
  assert.equal(validateRedirectUri('com.example.client:/oauth2redirect').valid, true);
  assert.equal(validateRedirectUri('com.example.client:///oauth2redirect').valid, true);
  for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/callback', 'intent://oauth/callback']) {
    assert.equal(validateRedirectUri(uri).valid, false, `${uri} must be rejected`);
  }
});

test('validates a self-service public application and rejects scope/redirect escalation', () => {
  const valid = validateApplication({
    name: 'Desktop Client', description: 'Desktop community client', website_url: 'https://client.example.org',
    redirect_uris: ['com.example.client:/oauth2redirect', 'http://127.0.0.1:0/callback'],
    requested_scopes: ['openid', 'profile', 'forum.read'],
  });
  assert.equal(valid.name, 'Desktop Client');
  assert.deepEqual(valid.requestedScopes, ['openid', 'profile', 'forum.read']);
  assert.equal(validateApplication({
    name: 'Local App', description: 'Local development client', website_url: 'http://localhost:3000',
    redirect_uris: ['http://localhost:0/callback'], requested_scopes: ['profile'],
  }).websiteUrl, 'http://localhost:3000');
  assert.throws(() => validateApplication({ name: 'Bad', redirect_uris: ['https://client.example.org/cb'], requested_scopes: ['openid', 'admin'] }));
  assert.throws(() => validateApplication({ name: 'Bad', redirect_uris: ['http://192.168.1.2/cb'], requested_scopes: ['openid'] }));
  assert.throws(() => validateApplication({ name: 'Bad', description: 'No public HTTP callback', redirect_uris: ['http://example.org/cb'], requested_scopes: ['openid'] }));
  assert.throws(() => validateApplication({ name: 'Bad', description: '', redirect_uris: ['https://client.example.org/cb'], requested_scopes: ['openid'] }));
  assert.throws(() => validateApplication({ name: 'Bad', redirect_uris: ['https://client.example.org/cb'], requested_scopes: 'openid profile' }));
});

test('requires a verified phone number before a user can create an application', async () => {
  const originalExecute = pool.execute;
  try {
    pool.execute = async () => [[{ phone_verified: 0 }]];
    await assert.rejects(assertPhoneVerifiedDeveloper(42), { code: 'PHONE_VERIFICATION_REQUIRED', statusCode: 403 });
    pool.execute = async () => [[{ phone_verified: 1 }]];
    await assert.doesNotReject(assertPhoneVerifiedDeveloper(42));
  } finally {
    pool.execute = originalExecute;
  }
});

test('creates verified users Public Clients as pending, secretless PKCE applications', async () => {
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  const inserts = [];
  let nextId = 100;
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, params = []) => {
      if (sql.startsWith('INSERT INTO clients')) {
        inserts.push({ sql, params });
        return [{ insertId: nextId++ }];
      }
      return [{ affectedRows: 1 }];
    },
  };
  try {
    pool.execute = async () => [[{ phone_verified: 1 }]];
    pool.getConnection = async () => connection;
    const body = {
      name: 'MDT Launcher', description: 'Community launcher', website_url: null,
      redirect_uris: ['http://localhost:0/oauth/callback'], requested_scopes: ['profile', 'forum.read'],
    };

    const first = await createOwnerApplication(9, body);
    const second = await createOwnerApplication(9, body);

    assert.equal(inserts.length, 2, 'the self-service flow does not impose an application count cap');
    assert.match(inserts[0].sql, /client_secret, redirect_uri[\s\S]*VALUES \(\?, \?, \?, \?, NULL, \?, 1, 'public', 'third_party', 'pending'/);
    assert.deepEqual(inserts[0].params.slice(-2), [9, '["profile","forum.read"]']);
    for (const application of [first, second]) {
      assert.equal(application.status, 'pending');
      assert.equal(application.client_type, 'public');
      assert.equal(application.party_type, 'third_party');
      assert.equal(application.client_secret, null);
    }
  } finally {
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
  }
});

test('admin scope changes revoke authorizations and cached access tokens for every affected user', async () => {
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  const originalRevoke = tokenStore.revokeAccessTokensForUserClient;
  const mutations = [];
  const invalidated = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, params = []) => {
      mutations.push({ sql, params });
      if (sql.includes('FROM clients WHERE id = ? FOR UPDATE')) {
        return [[{ id: 22, client_id: 'scope-edit-client', client_type: 'confidential', party_type: 'first_party',
          status: 'approved', requested_scopes: '["openid","profile"]', approved_scopes: '["openid","profile"]' }]];
      }
      if (sql.includes('FROM authorizations WHERE client_id = ?') && sql.includes('UNION SELECT user_id FROM refresh_tokens')) {
        return [[{ user_id: 7 }, { user_id: 11 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  try {
    pool.execute = async () => [{ affectedRows: 1 }];
    pool.getConnection = async () => connection;
    tokenStore.revokeAccessTokensForUserClient = async (userId, clientId) => { invalidated.push([userId, clientId]); };

    const result = await updateClient(22, {
      name: 'Identity client', redirect_uris: ['https://client.example.test/callback'], require_pkce: true,
      scopes: ['openid', 'profile', 'email'],
    }, { adminId: 1, ipAddress: '127.0.0.1' });

    assert.deepEqual(result, { updated: true, scopes_changed: true, revoked_users: 2 });
    assert.ok(mutations.some(({ sql }) => sql.startsWith('UPDATE refresh_tokens SET revoked = 1')));
    assert.ok(mutations.some(({ sql }) => sql.startsWith('DELETE FROM authorizations')));
    assert.deepEqual(invalidated, [[7, 'scope-edit-client'], [11, 'scope-edit-client']]);
  } finally {
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
    tokenStore.revokeAccessTokensForUserClient = originalRevoke;
  }
});

test('updates app details, redirects, and scopes immediately, then revokes tokens on scope changes', async () => {
  const originalGetConnection = pool.getConnection;
  const originalRevoke = tokenStore.revokeAccessTokensForUserClient;
  const mutations = [];
  const invalidated = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, params = []) => {
      mutations.push({ sql, params });
      if (sql.includes('FROM clients WHERE id = ? AND owner_user_id = ? FOR UPDATE')) {
        return [[{ id: 15, client_id: 'stable-client-id', status: 'approved', client_type: 'public',
          party_type: 'third_party', requested_scopes: '["profile","forum.read"]' }]];
      }
      if (sql.includes('FROM authorizations WHERE client_id = ?') && sql.includes('UNION SELECT user_id FROM refresh_tokens')) return [[{ user_id: 9 }]];
      if (sql.startsWith('SELECT user_id, scope FROM authorizations')) return [[{ user_id: 9, scope: 'profile forum.read' }]];
      return [{ affectedRows: 1 }];
    },
  };
  try {
    pool.getConnection = async () => connection;
    tokenStore.revokeAccessTokensForUserClient = async (userId, clientId) => { invalidated.push([userId, clientId]); };

    await assert.deepEqual(await updateOwnerApplication(9, 15, {
      name: 'New Launcher', description: 'Updated summary', website_url: 'https://example.test',
      redirect_uris: ['http://localhost:0/oauth/callback'], requested_scopes: ['profile', 'forum.write'],
    }), { updated: true, status: 'pending', re_review_required: true, scopes_changed: true });

    assert.ok(mutations.some(({ sql, params }) => sql.startsWith('UPDATE clients SET name = ?')
      && params[0] === 'New Launcher' && params[3] === '["profile","forum.write"]'));
    assert.ok(mutations.some(({ sql, params }) => sql.startsWith('UPDATE clients SET name = ?') && sql.includes("status = 'pending'") && params[3] === '["profile","forum.write"]'));
    assert.ok(mutations.some(({ sql, params }) => sql.startsWith('INSERT INTO oauth_client_redirect_uris')
      && params[1] === 'http://localhost:0/oauth/callback'));
    assert.ok(mutations.some(({ sql }) => sql.startsWith('UPDATE refresh_tokens SET revoked = 1')));
    assert.ok(mutations.some(({ sql }) => sql.startsWith('DELETE FROM authorizations')));
    assert.deepEqual(invalidated, [[9, 'stable-client-id']]);
  } finally {
    pool.getConnection = originalGetConnection;
    tokenStore.revokeAccessTokensForUserClient = originalRevoke;
  }
});

test('soft-deletes owner applications, removes grants, and invalidates access tokens', async () => {
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  const originalRevoke = tokenStore.revokeAccessTokensForUserClient;
  const mutations = [];
  const invalidated = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, params = []) => {
      mutations.push({ sql, params });
      if (sql.startsWith('SELECT id FROM clients')) return [[{ id: 15 }]];
      if (sql.includes('FROM authorizations WHERE client_id = ?') && sql.includes('UNION SELECT user_id FROM refresh_tokens')) return [[{ user_id: 9 }, { user_id: 12 }]];
      return [{ affectedRows: 1 }];
    },
  };
  try {
    pool.execute = async () => [[{ client_id: 'never-reused-id', status: 'approved', client_type: 'public', party_type: 'third_party' }]];
    pool.getConnection = async () => connection;
    tokenStore.revokeAccessTokensForUserClient = async (userId, clientId) => { invalidated.push([userId, clientId]); };

    await assert.deepEqual(await deleteOwnerApplication(9, 15), { deleted: true });
    assert.ok(mutations.some(({ sql, params }) => sql.startsWith('UPDATE clients SET status = ?') && params[0] === 'deleted'));
    assert.ok(mutations.some(({ sql }) => sql.startsWith('UPDATE refresh_tokens SET revoked = 1')));
    assert.ok(mutations.some(({ sql }) => sql.startsWith('DELETE FROM authorizations')));
    assert.deepEqual(invalidated, [[9, 'never-reused-id'], [12, 'never-reused-id']]);
  } finally {
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
    tokenStore.revokeAccessTokensForUserClient = originalRevoke;
  }
});

test('blocks RFC1918 private ranges (SSRF)', () => {
  for (const uri of [
    'http://10.0.0.5/cb',
    'http://172.16.4.9/cb',
    'http://172.31.255.1/cb',
    'http://192.168.1.100/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, false, `${uri} must be blocked`);
  }
});

test('allows public IPs adjacent to private ranges', () => {
  // 172.32.x is outside the 172.16-31 private block
  assert.equal(validateRedirectUri('http://172.32.0.1/cb').valid, true);
  assert.equal(validateRedirectUri('http://11.0.0.1/cb').valid, true);
});

test('blocks link-local and cloud metadata endpoints (SSRF)', () => {
  for (const uri of [
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://169.254.1.1/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, false, `${uri} must be blocked`);
  }
});
