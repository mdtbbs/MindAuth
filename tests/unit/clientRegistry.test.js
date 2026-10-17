/**
 * Unit tests for clientRegistry.validateRedirectUri. Pure function; no
 * DB/Redis required.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createClient, validateRedirectUri, validateApplication, assertPhoneVerifiedDeveloper, createOwnerApplication, updateOwnerApplication, deleteOwnerApplication, updateClient, reviewClient } = require('../../src/modules/admin/clientRegistry');
const { pool } = require('../../src/db');
const tokenStore = require('../../src/modules/oauth/tokenStore');
const { normalizeScopes } = require('../../src/modules/oauth/scopes');

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

test('accepts loopback and internal-network HTTP(S) redirect URIs', () => {
  for (const uri of [
    'http://127.0.0.1:0/callback',
    'http://127.0.0.1:49152/callback',
    'http://[::1]:0/callback',
    'http://[::1]:49152/callback',
    'http://localhost:0/callback',
    'http://localhost:49152/callback',
    'http://0.0.0.0/cb',
    'http://192.168.1.2/cb',
    'http://10.0.0.1/cb',
    'https://api.localhost/cb',
    'https://service.internal/cb',
  ]) assert.equal(validateRedirectUri(uri).valid, true, `${uri} must be accepted`);
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
    requested_scopes: ['openid', 'profile', 'forum.read', 'game_content.saves.read', 'game_content.saves.write', 'game_content.saves.delete'],
  });
  assert.equal(valid.name, 'Desktop Client');
  assert.deepEqual(valid.requestedScopes, normalizeScopes(['openid', 'profile', 'forum']));
  assert.equal(validateApplication({
    name: 'Local App', description: 'Local development client', website_url: 'http://localhost:3000',
    redirect_uris: ['http://localhost:0/callback', 'http://192.168.1.2/callback', 'https://service.internal/callback'],
    requested_scopes: ['profile'],
  }).websiteUrl, 'http://localhost:3000');
  assert.throws(() => validateApplication({ name: 'Bad', redirect_uris: ['https://client.example.org/cb'], requested_scopes: ['openid', 'admin'] }));
  assert.throws(() => validateApplication({ name: 'Bad', description: 'No public HTTP callback', redirect_uris: ['http://example.org/cb'], requested_scopes: ['openid'] }));
  assert.throws(() => validateApplication({ name: 'Bad', description: '', redirect_uris: ['https://client.example.org/cb'], requested_scopes: ['openid'] }));
  assert.throws(() => validateApplication({ name: 'Bad', redirect_uris: ['https://client.example.org/cb'], requested_scopes: 'openid profile' }));
});

test('application approval enables the requested forum group and capabilities together', async () => {
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  const updates = [];
  try {
    pool.execute = async (sql, params) => {
      if (sql.includes('FROM clients WHERE id = ?')) return [[{
        id: 21, name: 'Launcher', client_id: 'launcher', status: 'pending', client_type: 'public',
        party_type: 'third_party', requested_scopes: '["openid","profile","forum"]',
        approved_scopes: '[]', launch_uri_template: 'xenon://join/{intent_id}',
      }]];
      if (sql.startsWith('UPDATE clients SET status = ?')) updates.push(params);
      return [{ affectedRows: 1 }];
    };
    pool.getConnection = async () => ({
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, execute: pool.execute,
    });
    // A legacy review payload cannot reduce or expand the applicant's access level.
    await reviewClient(21, { status: 'approved', approvedScopes: ['profile'] }, { adminId: 2 });
    assert.deepEqual(JSON.parse(updates[0][2]), normalizeScopes(['openid', 'profile', 'forum']));
    assert.deepEqual(updates[0].slice(3, 7), [1, 1, 1, 1]);
  } finally { pool.execute = originalExecute; pool.getConnection = originalGetConnection; }
});

test('requires a verified phone number before a user can create an application', async () => {
  const originalExecute = pool.execute;
  try {
    pool.execute = async () => [[{ email_verified: 1, phone_verified: 0 }]];
    await assert.rejects(assertPhoneVerifiedDeveloper(42), { code: 'PHONE_VERIFICATION_REQUIRED', statusCode: 403 });
    pool.execute = async () => [[{ email_verified: 1, phone_verified: 1 }]];
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
    pool.execute = async () => [[{ email_verified: 1, phone_verified: 1 }]];
    pool.getConnection = async () => connection;
    const body = {
      name: 'MDT Launcher', description: 'Community launcher', website_url: null,
      redirect_uris: ['http://localhost:0/oauth/callback'], requested_scopes: ['profile', 'forum.read'],
    };

    const first = await createOwnerApplication(9, body);
    const second = await createOwnerApplication(9, body);

    assert.equal(inserts.length, 2, 'the self-service flow does not impose an application count cap');
    assert.match(inserts[0].sql, /application_icon_url, launch_uri_template[\s\S]*client_id, client_secret, redirect_uri[\s\S]*VALUES \([\s\S]*NULL, \?, 1, 'public', 'third_party'/);
    assert.equal(inserts[0].params[8], first.client_id);
    assert.equal(inserts[0].params[11], 9);
    assert.deepEqual(JSON.parse(inserts[0].params[12]), normalizeScopes(['openid', 'profile', 'forum']));
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

test('international developer policy requires verified email but allows no phone', async () => {
  const { assertDeveloperEligibility } = require('../../src/modules/developer/DeveloperPolicy');
  const originalExecute = pool.execute;
  try {
    pool.execute = async () => [[{ email_verified: 1, phone_verified: 0 }]];
    await assert.doesNotReject(assertDeveloperEligibility(42, 'mindustry-club'));
    await assert.doesNotReject(assertDeveloperEligibility(42, 'global'));
    await assert.rejects(assertDeveloperEligibility(42, 'mdtbbs'), { code: 'PHONE_VERIFICATION_REQUIRED', statusCode: 403 });
    pool.execute = async () => [[{ email_verified: 0, phone_verified: 0 }]];
    await assert.rejects(assertDeveloperEligibility(42, 'mindustry-club'), { code: 'EMAIL_VERIFICATION_REQUIRED', statusCode: 403 });
  } finally {
    pool.execute = originalExecute;
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
      if (sql.includes('SELECT email_verified, phone_verified FROM users')) return [[{ email_verified: 1, phone_verified: 1 }]];
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
      && sql.includes('supports_join_intent_requested = ?') && params[0] === 'New Launcher'
      && JSON.parse(params[9]).includes('forum')));
    assert.ok(mutations.some(({ sql, params }) => sql.startsWith('UPDATE clients SET name = ?')
      && sql.includes("status = 'pending'") && JSON.parse(params[9]).includes('forum')));
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

test('accepts RFC1918 private ranges as registered redirect URIs', () => {
  for (const uri of [
    'http://10.0.0.5/cb',
    'http://172.16.4.9/cb',
    'http://172.31.255.1/cb',
    'http://192.168.1.100/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, true, `${uri} must be accepted`);
  }
});

test('allows public IPs adjacent to private ranges', () => {
  // 172.32.x is outside the 172.16-31 private block
  assert.equal(validateRedirectUri('http://172.32.0.1/cb').valid, true);
  assert.equal(validateRedirectUri('http://11.0.0.1/cb').valid, true);
});

test('accepts link-local and cloud metadata callback URI registration', () => {
  for (const uri of [
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://169.254.1.1/cb',
  ]) {
    assert.equal(validateRedirectUri(uri).valid, true, `${uri} must be accepted`);
  }
});

test('admin can create a secretless public client or a server-held-secret web client', async () => {
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  const inserts = [];
  try {
    pool.execute = async () => [{ affectedRows: 1 }];
    pool.getConnection = async () => ({
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
      execute: async (sql, params) => {
        if (sql.startsWith('INSERT INTO clients')) { inserts.push(params); return [{ insertId: 31 }]; }
        return [{ affectedRows: 1 }];
      },
    });
    const base = { name: 'App', redirect_uris: ['https://app.example/callback'], forum_access: true };
    const publicApp = await createClient({ ...base, client_type: 'public', require_pkce: false }, { adminId: 1 });
    assert.equal(publicApp.client_secret, null);
    assert.equal(inserts[0][2], null);
    assert.equal(inserts[0][4], 1, 'public clients always require PKCE');
    assert.equal(inserts[0][6], 'third_party', 'admin creation is not proof of an official app');
    const webApp = await createClient({ ...base, client_type: 'confidential' }, { adminId: 1 });
    assert.ok(webApp.client_secret);
    assert.match(inserts[1][2], /^sha256:/);
    assert.notEqual(inserts[1][2], webApp.client_secret);
  } finally { pool.execute = originalExecute; pool.getConnection = originalGetConnection; }
});
