const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

const states = new Map();
const redisValues = new Map();
const insertedUsers = [];
const insertedSocialAccounts = [];
let nextUserId = 1;
let nextStateId = 1;
let listenServer;
let baseUrl;

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
const mockClient = {
  get: async (key) => redisValues.get(key) || null,
  setEx: async (key, _ttl, value) => { redisValues.set(key, value); return 'OK'; },
  del: async (key) => { const existed = redisValues.has(key); redisValues.delete(key); return existed ? 1 : 0; },
  ttl: async (key) => redisValues.has(key) ? 300 : -2,
};
const mockPool = {
  execute: async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase();
    if (normalized.includes('INSERT INTO USERS')) {
      const [username, email, passwordHash, avatarUrl] = params;
      const user = { id: nextUserId++, username, email, password_hash: passwordHash, avatar_url: avatarUrl };
      insertedUsers.push(user);
      return [{ insertId: user.id, affectedRows: 1 }];
    }
    if (normalized.includes('INSERT INTO SOCIAL_ACCOUNTS')) {
      const [userId, provider, providerUserId, nickname, avatarUrl] = params;
      insertedSocialAccounts.push({ user_id: userId, provider, provider_user_id: providerUserId, nickname, avatar_url: avatarUrl });
      return [{ insertId: insertedSocialAccounts.length, affectedRows: 1 }];
    }
    return [[], []];
  },
};
const providerAdapter = {
  getAuthorizationUrl: (state) => `https://github.com/login/oauth/authorize?state=${state}`,
  exchangeCode: async (code) => { assert.equal(code, 'provider-code'); return 'temporary-provider-token'; },
  getProfile: async (token) => {
    assert.equal(token, 'temporary-provider-token');
    return { providerUserId: 'github-42', nickname: 'Player', avatarUrl: null };
  },
};
const mockProviders = {
  get: () => providerAdapter,
  isEnabled: (provider) => ['github', 'discord'].includes(provider),
  listEnabled: () => ['github', 'discord'],
};
const mockStateManager = {
  createState: async (payload) => {
    const state = `${String(nextStateId++).padStart(64, '0')}`;
    states.set(state, payload);
    return state;
  },
  consumeState: async (state) => {
    const value = states.get(state) || null;
    states.delete(state);
    return value;
  },
  compareSessionHash: () => true,
};

function mockModule(relativePath, exportsValue) {
  const filename = require.resolve(relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports: exportsValue };
}

mockModule('../../src/modules/social/providerRegistry', mockProviders);
mockModule('../../src/modules/social/stateManager', mockStateManager);
mockModule('../../src/modules/social/socialLogin', {
  loginProvider: async () => null,
  bindProvider: async () => ({}),
  unbindSocial: async () => true,
});
mockModule('../../src/modules/sessions/sessionManager', {
  authenticateUserSession: async () => null,
  createUserSession: async ({ userId }) => ({ token: `session-${userId}` }),
});
mockModule('../../src/modules/admin/clientRegistry', {
  getClient: async (clientId) => clientId === 'club-app' ? {
    client_id: 'club-app',
    redirect_uri: 'https://club.example/callback',
    redirect_uris: [{ redirect_uri: 'https://club.example/callback' }],
    approved_scopes: ['openid', 'profile', 'email', 'forum.read'],
  } : null,
});
mockModule('../../src/utils/request', { getClientIp: () => '127.0.0.1' });
mockModule('../../src/redis', { client: mockClient });
mockModule('../../src/db', { pool: mockPool, transaction: async (callback) => callback(mockPool) });
mockModule('../../src/modules/emailPolicy/emailPolicyService', { checkEmail: async () => ({ allowed: true }) });
mockModule('../../src/utils/userAudit', { logUserAudit: () => {} });
mockModule('../../src/modules/challenges/challengeManager', {
  isChallengeRequired: async () => false,
  verifyForRegistration: async () => ({ success: true }),
});
mockModule('../../src/middleware/rateLimit', { createRateLimiter: () => (_req, _res, next) => next() });
mockModule('../../src/config', {
  qq: { enabled: false, clientId: '', clientSecret: '', redirectUri: '' },
  social: { github: {}, discord: {} },
  rateLimit: { register: { maxAttempts: 5, windowMs: 3600000, keyPrefix: 'test' } },
});

const router = require('../../src/routes/socialProviders');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.cookies = {}; next(); });
app.use('/api/auth/social', router);

before(async () => {
  listenServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listenServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${listenServer.address().port}`;
});

after(async () => {
  if (listenServer) await new Promise((resolve) => listenServer.close(resolve));
});

beforeEach(() => {
  states.clear();
  redisValues.clear();
  insertedUsers.length = 0;
  insertedSocialAccounts.length = 0;
  nextUserId = 1;
  nextStateId = 1;
});

test('lists configured social providers and rejects binding without a session', async () => {
  const listed = await fetch(`${baseUrl}/api/auth/social/providers`).then((response) => response.json());
  assert.deepEqual(listed.providers, ['github', 'discord']);
  const bind = await fetch(`${baseUrl}/api/auth/social/github?intent=bind`, { redirect: 'manual' });
  assert.equal(bind.status, 401);
});

test('starts OAuth with approved community scopes and preserves ui_locales in one-time state', async () => {
  const query = new URLSearchParams({
    client_id: 'club-app', redirect_uri: 'https://club.example/callback', scope: 'openid forum.read',
    code_challenge: 'A'.repeat(43), code_challenge_method: 'S256', state: 'upstream-state', ui_locales: 'ja',
  });
  const response = await fetch(`${baseUrl}/api/auth/social/github?${query}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const payload = [...states.values()][0];
  assert.equal(payload.authorize.scope, 'openid forum.read');
  assert.equal(payload.authorize.uiLocales, 'ja');
  assert.equal(payload.authorize.codeChallengeMethod, 'S256');
});

test('rejects an unregistered OAuth redirect instead of falling back to direct sign-in', async () => {
  const query = new URLSearchParams({ client_id: 'club-app', redirect_uri: 'https://attacker.example/callback' });
  const response = await fetch(`${baseUrl}/api/auth/social/github?${query}`, { redirect: 'manual' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_OAUTH_CONTEXT');
  assert.equal(states.size, 0);
});

test('callback sends first-time accounts to the localized email-verification form', async () => {
  states.set('callback-state', {
    provider: 'github', intent: 'login',
    authorize: { clientId: 'club-app', redirectUri: 'https://club.example/callback', scope: 'openid forum.read', uiLocales: 'ja' },
  });
  const response = await fetch(`${baseUrl}/api/auth/social/github/callback?code=provider-code&state=callback-state`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'), baseUrl);
  assert.equal(location.pathname, '/social-register');
  assert.equal(location.searchParams.get('provider'), 'github');
  assert.equal(location.searchParams.get('ui_locales'), 'ja');
  assert.equal(states.get(location.searchParams.get('state')).providerUserId, 'github-42');
});

test('social account registration verifies email before consuming provider state', async () => {
  const email = 'player@example.test';
  const emailHash = hash(email);
  redisValues.set(`register_email_code:${emailHash}`, JSON.stringify({ email, codeHash: hash('123456'), failures: 0 }));
  states.set('register-state', {
    provider: 'github', intent: 'register', providerUserId: 'github-42', nickname: 'Player', authorize: null,
  });
  const response = await fetch(`${baseUrl}/api/auth/social/complete`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'register-state', username: 'player', email, email_code: '123456', password: 'Password123' }),
  });
  assert.equal(response.status, 201);
  assert.equal(insertedUsers.length, 1);
  assert.equal(insertedUsers[0].email, email);
  assert.deepEqual(insertedSocialAccounts[0], {
    user_id: 1, provider: 'github', provider_user_id: 'github-42', nickname: 'Player', avatar_url: null,
  });
  assert.equal(states.has('register-state'), false);
});
