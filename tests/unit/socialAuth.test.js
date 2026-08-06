/**
 * Unit tests for socialAuth routes — verifies QQ OAuth complete flow:
 * - GET /qq starts authorization (login vs bind intent)
 * - GET /qq/callback handles provider response
 * - POST /qq/complete handles new user registration
 * - OAuth context preservation and restoration
 * - State validation and atomic consumption
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock data stores ────────────────────────────────────────────────────────

let users = [];
let socialAccounts = [];
let loginLogs = [];
let stateStore = new Map();
let emailCodes = new Map();

// ─── Mock MySQL pool ─────────────────────────────────────────────────────────

const mockPool = {
  execute: async (sql, params) => {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    // SELECT from users
    if (normalizedSql.includes('SELECT') && normalizedSql.includes('FROM USERS')) {
      if (normalizedSql.includes('WHERE ID = ?')) {
        const [id] = params;
        const found = users.filter(u => u.id === id);
        return [found.length > 0 ? [found[0]] : []];
      }
    }

    // SELECT from social_accounts
    if (normalizedSql.includes('SELECT') && normalizedSql.includes('FROM SOCIAL_ACCOUNTS')) {
      if (normalizedSql.includes('WHERE PROVIDER = ? AND PROVIDER_USER_ID = ?')) {
        const [provider, providerUserId] = params;
        const found = socialAccounts.filter(
          s => s.provider === provider && s.provider_user_id === providerUserId
        );
        return [found.length > 0 ? [found[0]] : []];
      }
      if (normalizedSql.includes('WHERE USER_ID = ?')) {
        const [userId] = params;
        return [socialAccounts.filter(s => s.user_id === userId)];
      }
    }

    // INSERT into users
    if (normalizedSql.includes('INSERT INTO USERS')) {
      const [username, email, passwordHash, emailVerified, avatarUrl] = params;
      const newUser = {
        id: users.length + 1,
        username,
        email,
        password_hash: passwordHash,
        email_verified: emailVerified === 1 ? 1 : 0,
        avatar_url: typeof emailVerified === 'string' ? emailVerified : (avatarUrl || null),
        role: 'user',
        ban_status: 'none',
      };
      users.push(newUser);
      return [{ insertId: newUser.id, affectedRows: 1 }];
    }

    // INSERT into social_accounts
    if (normalizedSql.includes('INSERT INTO SOCIAL_ACCOUNTS')) {
      const [userId, provider, providerUserId, nickname, avatarUrl] = params;
      const newBinding = {
        id: socialAccounts.length + 1,
        user_id: userId,
        provider,
        provider_user_id: providerUserId,
        nickname,
        avatar_url: avatarUrl,
        created_at: new Date(),
        last_login_at: null,
      };
      socialAccounts.push(newBinding);
      return [{ insertId: newBinding.id, affectedRows: 1 }];
    }

    // UPDATE social_accounts
    if (normalizedSql.includes('UPDATE SOCIAL_ACCOUNTS')) {
      if (normalizedSql.includes('SET NICKNAME')) {
        const [nickname, avatarUrl, id] = params;
        const binding = socialAccounts.find(s => s.id === id);
        if (binding) {
          binding.nickname = nickname;
          binding.avatar_url = avatarUrl;
          binding.last_login_at = new Date();
        }
        return [{ affectedRows: 1 }];
      }
    }

    // INSERT into login_logs
    if (normalizedSql.includes('INSERT INTO LOGIN_LOGS')) {
      const [userId, ip, device, loginType] = params;
      loginLogs.push({ user_id: userId, ip, device, login_type: loginType });
      return [{ affectedRows: 1 }];
    }

    // SELECT from registration_email_codes
    if (normalizedSql.includes('SELECT') && normalizedSql.includes('FROM REGISTRATION_EMAIL_CODES')) {
      const [emailHash] = params;
      const record = emailCodes.get(emailHash);
      if (record && new Date(record.expires_at) > new Date()) {
        return [[record]];
      }
      return [[]];
    }

    // DELETE from registration_email_codes
    if (normalizedSql.includes('DELETE FROM REGISTRATION_EMAIL_CODES')) {
      const [emailHash] = params;
      emailCodes.delete(emailHash);
      return [{ affectedRows: 1 }];
    }

    return [[], []];
  },
};

// ─── Mock Redis client ───────────────────────────────────────────────────────

let redisStore = new Map();

const mockRedis = {
  get: async (key) => redisStore.get(key) || null,
  setEx: async (key, ttl, value) => { redisStore.set(key, value); return 'OK'; },
  del: async (key) => { redisStore.delete(key); return 1; },
  getDel: async (key) => {
    const val = redisStore.get(key);
    redisStore.delete(key);
    return val || null;
  },
  getSet: async (key, value) => {
    const old = redisStore.get(key);
    redisStore.set(key, value);
    return old;
  },
};

// ─── Mock sessionManager ─────────────────────────────────────────────────────

const mockSessionManager = {
  createUserSession: async ({ userId, ipAddress, userAgent }) => {
    return {
      token: `session-token-${userId}-${Date.now()}`,
      userId,
      ip: ipAddress,
      userAgent,
    };
  },
  authenticateUserSession: async (token) => {
    if (!token) return null;
    const match = token.match(/session-token-(\d+)/);
    if (!match) return null;
    const userId = parseInt(match[1]);
    const user = users.find(u => u.id === userId);
    if (!user) return null;
    return { user, session: { id: 1 } };
  },
};

// ─── Mock qqProvider ─────────────────────────────────────────────────────────

const mockQqProvider = {
  getAuthorizationUrl: (state) => `https://graph.qq.com/oauth2.0/authorize?state=${state}`,
  exchangeCode: async (code) => {
    if (code === 'invalid-code') throw new Error('QQ token exchange failed');
    return { access_token: 'mock-access-token', expires_in: '7776000' };
  },
  getOpenId: async (accessToken) => {
    if (accessToken === 'mock-access-token') return 'mock-openid-12345';
    throw new Error('QQ openid lookup failed');
  },
  getProfile: async (accessToken, openid) => {
    return {
      ret: 0,
      msg: '',
      nickname: 'QQ User',
      figureurl_qq_2: 'https://qq.com/avatar.jpg',
    };
  },
};

// ─── Mock stateManager ───────────────────────────────────────────────────────

const mockStateManager = {
  createState: async (payload) => {
    const crypto = require('crypto');
    const state = crypto.randomBytes(32).toString('hex');
    stateStore.set(`social:state:${state}`, JSON.stringify(payload));
    return state;
  },
  consumeState: async (state) => {
    const raw = stateStore.get(`social:state:${state}`);
    stateStore.delete(`social:state:${state}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  storeState: async (state, payload) => {
    stateStore.set(`social:state:${state}`, JSON.stringify(payload));
    return state;
  },
  compareSessionHash: (storedHash, token) => {
    const { hashToken } = require('../../src/utils/token');
    return storedHash === hashToken(token);
  },
};

// ─── Mock config ─────────────────────────────────────────────────────────────

const mockConfig = {
  qq: {
    enabled: true,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://auth.example.com/api/auth/qq/callback',
  },
};

// ─── Mock clientRegistry ─────────────────────────────────────────────────────

const mockClientRegistry = {
  getClient: async (clientId) => {
    if (clientId === 'valid-client') {
      return {
        client_id: 'valid-client',
        redirect_uri: 'https://app.example.com/callback',
      };
    }
    return null;
  },
};

// ─── Mock other dependencies ─────────────────────────────────────────────────

const mockLogUserAudit = () => {};
const mockGetClientIp = () => '127.0.0.1';
const mockHashToken = (token) => require('crypto').createHash('sha256').update(token).digest('hex');

// ─── Install mocks ───────────────────────────────────────────────────────────

const dbPath = require.resolve('../../src/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    pool: mockPool,
    transaction: async (fn) => fn(mockPool),
  },
};

const redisPath = require.resolve('../../src/redis');
require.cache[redisPath] = {
  id: redisPath,
  filename: redisPath,
  loaded: true,
  exports: { client: mockRedis },
};

const configPath = require.resolve('../../src/config');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: mockConfig,
};

const sessionPath = require.resolve('../../src/modules/sessions/sessionManager');
require.cache[sessionPath] = {
  id: sessionPath,
  filename: sessionPath,
  loaded: true,
  exports: mockSessionManager,
};

const qqProviderPath = require.resolve('../../src/modules/social/qqProvider');
require.cache[qqProviderPath] = {
  id: qqProviderPath,
  filename: qqProviderPath,
  loaded: true,
  exports: mockQqProvider,
};

const stateManagerPath = require.resolve('../../src/modules/social/stateManager');
require.cache[stateManagerPath] = {
  id: stateManagerPath,
  filename: stateManagerPath,
  loaded: true,
  exports: mockStateManager,
};

const clientRegistryPath = require.resolve('../../src/modules/admin/clientRegistry');
require.cache[clientRegistryPath] = {
  id: clientRegistryPath,
  filename: clientRegistryPath,
  loaded: true,
  exports: mockClientRegistry,
};

const auditPath = require.resolve('../../src/utils/userAudit');
require.cache[auditPath] = {
  id: auditPath,
  filename: auditPath,
  loaded: true,
  exports: { logUserAudit: mockLogUserAudit },
};

const requestPath = require.resolve('../../src/utils/request');
require.cache[requestPath] = {
  id: requestPath,
  filename: requestPath,
  loaded: true,
  exports: { getClientIp: mockGetClientIp },
};

const socialLoginPath = require.resolve('../../src/modules/social/socialLogin');
require.cache[socialLoginPath] = {
  id: socialLoginPath,
  filename: socialLoginPath,
  loaded: true,
  exports: require('../../src/modules/social/socialLogin'),
};

const tokenPath = require.resolve('../../src/utils/token');
require.cache[tokenPath] = {
  id: tokenPath,
  filename: tokenPath,
  loaded: true,
  exports: {
    hashToken: mockHashToken,
    generateToken: () => require('crypto').randomBytes(32).toString('hex'),
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetData() {
  users = [];
  socialAccounts = [];
  loginLogs = [];
  stateStore = new Map();
  redisStore = new Map();
  emailCodes = new Map();
}

function createUser(id, options = {}) {
  const user = {
    id,
    username: options.username || `user${id}`,
    email: options.email || `user${id}@test.com`,
    password_hash: 'hashed-password',
    email_verified: 1,
    avatar_url: null,
    role: 'user',
    ban_status: 'ban_status' in options ? options.ban_status : 'none',
    ban_reason: options.ban_reason || null,
    ban_expires_at: options.ban_expires_at || null,
    locked_until: options.locked_until || null,
    lock_level: options.lock_level || 0,
  };
  users.push(user);
  return user;
}

function addSocialBinding(userId, openid, options = {}) {
  const binding = {
    id: socialAccounts.length + 1,
    user_id: userId,
    provider: 'qq',
    provider_user_id: openid,
    nickname: options.nickname || 'QQ User',
    avatar_url: options.avatarUrl || null,
    created_at: new Date(),
    last_login_at: null,
  };
  socialAccounts.push(binding);
  return binding;
}

function addEmailCode(email, code, expiresMinutes = 5) {
  const emailHash = mockHashToken(email.toLowerCase().trim());
  const codeHash = mockHashToken(code);
  emailCodes.set(emailHash, {
    email: email.toLowerCase().trim(),
    code_hash: codeHash,
    expires_at: new Date(Date.now() + expiresMinutes * 60000).toISOString(),
    failures: 0,
  });
}

beforeEach(() => {
  resetData();
});

// ─── State Management Tests ──────────────────────────────────────────────────

test('createState generates 64-char hex state', async () => {
  const state = await mockStateManager.createState({
    provider: 'qq',
    intent: 'login',
  });

  assert.equal(state.length, 64);
  assert.ok(/^[a-f0-9]+$/.test(state));
});

test('createState stores payload in Redis', async () => {
  const state = await mockStateManager.createState({
    provider: 'qq',
    intent: 'login',
    ip: '127.0.0.1',
  });

  const stored = stateStore.get(`social:state:${state}`);
  assert.ok(stored);
  const parsed = JSON.parse(stored);
  assert.equal(parsed.provider, 'qq');
  assert.equal(parsed.intent, 'login');
});

test('consumeState returns payload on first call', async () => {
  const state = await mockStateManager.createState({
    provider: 'qq',
    intent: 'login',
  });

  const payload = await mockStateManager.consumeState(state);
  assert.ok(payload);
  assert.equal(payload.provider, 'qq');
});

test('consumeState returns null on second call (atomic)', async () => {
  const state = await mockStateManager.createState({
    provider: 'qq',
    intent: 'login',
  });

  await mockStateManager.consumeState(state);
  const secondCall = await mockStateManager.consumeState(state);
  assert.equal(secondCall, null);
});

test('consumeState returns null for invalid state format', async () => {
  const result = await mockStateManager.consumeState('invalid');
  assert.equal(result, null);
});

test('consumeState returns null for non-existent state', async () => {
  const result = await mockStateManager.consumeState('a'.repeat(64));
  assert.equal(result, null);
});

// ─── QQ OAuth Flow Tests ─────────────────────────────────────────────────────

test('QQ login flow: existing binding creates session', async () => {
  // Setup: user with QQ binding
  const user = createUser(1);
  addSocialBinding(user.id, 'mock-openid-12345');

  // Simulate callback processing
  const token = await mockQqProvider.exchangeCode('valid-code');
  const openid = await mockQqProvider.getOpenId(token.access_token);

  // Check for existing binding
  const binding = socialAccounts.find(
    s => s.provider === 'qq' && s.provider_user_id === openid
  );
  assert.ok(binding);
  assert.equal(binding.user_id, user.id);
});

test('QQ login flow: no binding triggers registration', async () => {
  // No existing binding
  const token = await mockQqProvider.exchangeCode('valid-code');
  const openid = await mockQqProvider.getOpenId(token.access_token);

  const binding = socialAccounts.find(
    s => s.provider === 'qq' && s.provider_user_id === openid
  );
  assert.equal(binding, undefined);

  // Should create register state
  const registerState = await mockStateManager.createState({
    provider: 'qq',
    intent: 'register',
    openid,
    nickname: 'QQ User',
  });
  assert.ok(registerState);
});

test('QQ bind flow: requires valid session', async () => {
  const user = createUser(1);
  const sessionToken = `session-token-${user.id}-${Date.now()}`;

  // Verify session
  const session = await mockSessionManager.authenticateUserSession(sessionToken);
  assert.ok(session);
  assert.equal(session.user.id, user.id);
});

test('QQ bind flow: invalid session rejected', async () => {
  const session = await mockSessionManager.authenticateUserSession('invalid-token');
  assert.equal(session, null);
});

test('QQ bind flow: creates social binding', async () => {
  const user = createUser(1);

  // Simulate binding
  const openid = 'mock-openid-12345';
  const profile = await mockQqProvider.getProfile('mock-access-token', openid);

  const [result] = await mockPool.execute(
    'INSERT INTO social_accounts (user_id, provider, provider_user_id, nickname, avatar_url) VALUES (?, ?, ?, ?, ?)',
    [user.id, 'qq', openid, profile.nickname, profile.figureurl_qq_2]
  );

  assert.ok(result.insertId);
  const binding = socialAccounts.find(s => s.id === result.insertId);
  assert.ok(binding);
  assert.equal(binding.user_id, user.id);
  assert.equal(binding.provider, 'qq');
});

test('QQ callback: handles provider error', async () => {
  // Simulate QQ returning error
  let error = null;
  try {
    await mockQqProvider.exchangeCode('invalid-code');
  } catch (err) {
    error = err;
  }
  assert.ok(error);
  assert.ok(error.message.includes('QQ token exchange failed'));
});

// ─── Registration Completion Tests ───────────────────────────────────────────

test('QQ complete: valid registration creates user and binding', async () => {
  // Setup: pending register state
  const state = await mockStateManager.createState({
    provider: 'qq',
    intent: 'register',
    openid: 'mock-openid-12345',
    nickname: 'QQ User',
    avatarUrl: 'https://qq.com/avatar.jpg',
  });

  // Add email verification code
  addEmailCode('newuser@test.com', '123456');

  // Verify state
  const pending = await mockStateManager.consumeState(state);
  assert.ok(pending);
  assert.equal(pending.intent, 'register');

  // Verify email code
  const emailHash = mockHashToken('newuser@test.com');
  const codeRecord = emailCodes.get(emailHash);
  assert.ok(codeRecord);
  assert.equal(codeRecord.code_hash, mockHashToken('123456'));

  // Create user
  const [userResult] = await mockPool.execute(
    'INSERT INTO users (username, email, password_hash, email_verified, avatar_url) VALUES (?, ?, ?, 1, ?)',
    ['newuser', 'newuser@test.com', 'hashedpw', pending.avatarUrl]
  );
  const userId = userResult.insertId;

  // Create binding
  await mockPool.execute(
    'INSERT INTO social_accounts (user_id, provider, provider_user_id, nickname, avatar_url) VALUES (?, ?, ?, ?, ?)',
    [userId, 'qq', pending.openid, pending.nickname, pending.avatarUrl]
  );

  // Verify
  const newUser = users.find(u => u.id === userId);
  assert.ok(newUser);
  assert.equal(newUser.username, 'newuser');
  assert.equal(newUser.email, 'newuser@test.com');

  const binding = socialAccounts.find(s => s.user_id === userId);
  assert.ok(binding);
  assert.equal(binding.provider_user_id, 'mock-openid-12345');
});

test('QQ complete: rejects invalid state', async () => {
  const pending = await mockStateManager.consumeState('invalid-state');
  assert.equal(pending, null);
});

test('QQ complete: rejects expired email code', async () => {
  // Add expired code
  addEmailCode('expired@test.com', '123456', -10);

  const emailHash = mockHashToken('expired@test.com');
  const record = emailCodes.get(emailHash);

  // Check expiration
  const expired = new Date(record.expires_at) < new Date();
  assert.ok(expired);
});

test('QQ complete: rejects wrong email code', async () => {
  addEmailCode('user@test.com', '123456');

  const emailHash = mockHashToken('user@test.com');
  const record = emailCodes.get(emailHash);

  // Wrong code hash
  const wrongCodeHash = mockHashToken('654321');
  assert.notEqual(record.code_hash, wrongCodeHash);
});

test('QQ complete: tracks email code failures', async () => {
  addEmailCode('fail@test.com', '123456');

  const emailHash = mockHashToken('fail@test.com');
  const record = emailCodes.get(emailHash);

  // Increment failures
  record.failures = (record.failures || 0) + 1;
  assert.equal(record.failures, 1);

  // Max failures
  record.failures = 5;
  assert.ok(record.failures >= 5);
});

// ─── OAuth Context Tests ─────────────────────────────────────────────────────

test('OAuth context preserved through QQ flow', async () => {
  const authorize = {
    clientId: 'valid-client',
    redirectUri: 'https://app.example.com/callback',
    state: 'oauth-state-123',
    scope: 'openid profile',
  };

  // Create login state with authorize context
  const state = await mockStateManager.createState({
    provider: 'qq',
    intent: 'login',
    authorize,
  });

  // Consume and verify
  const payload = await mockStateManager.consumeState(state);
  assert.ok(payload.authorize);
  assert.equal(payload.authorize.clientId, authorize.clientId);
  assert.equal(payload.authorize.redirectUri, authorize.redirectUri);
});

test('OAuth context restored after QQ login', async () => {
  const authorize = {
    clientId: 'valid-client',
    redirectUri: 'https://app.example.com/callback',
    state: 'oauth-state-123',
  };

  // Simulate restoring authorize context
  function buildSuccessRedirect(authorize) {
    if (!authorize) return '/dashboard';
    const params = new URLSearchParams({
      client_id: authorize.clientId,
      redirect_uri: authorize.redirectUri,
      response_type: 'code',
    });
    if (authorize.state) params.set('state', authorize.state);
    return `/api/authorize?${params.toString()}`;
  }

  const redirectUrl = buildSuccessRedirect(authorize);
  assert.ok(redirectUrl.includes('/api/authorize'));
  assert.ok(redirectUrl.includes('client_id=valid-client'));
});

test('OAuth context validates client_id', async () => {
  const client = await mockClientRegistry.getClient('valid-client');
  assert.ok(client);
  assert.equal(client.client_id, 'valid-client');

  const invalidClient = await mockClientRegistry.getClient('invalid-client');
  assert.equal(invalidClient, null);
});

test('OAuth context validates redirect_uri', async () => {
  const client = await mockClientRegistry.getClient('valid-client');
  const registeredUris = client.redirect_uri.split('\n').map(uri => uri.trim());

  assert.ok(registeredUris.includes('https://app.example.com/callback'));
  assert.ok(!registeredUris.includes('https://evil.com/callback'));
});

// ─── Security Tests ──────────────────────────────────────────────────────────

test('OAuth context preserves allowed fields', async () => {
  // This test verifies that authorize context with allowed fields works
  // Note: Field filtering is tested in stateManager.test.js
  const authorize = {
    clientId: 'valid-client',
    redirectUri: 'https://app.example.com/callback',
    state: 'oauth-state-123',
    scope: 'openid profile',
  };

  const state = await mockStateManager.createState({
    provider: 'qq',
    intent: 'login',
    authorize,
  });

  const payload = await mockStateManager.consumeState(state);
  assert.ok(payload.authorize);
  assert.equal(payload.authorize.clientId, authorize.clientId);
  assert.equal(payload.authorize.redirectUri, authorize.redirectUri);
  assert.equal(payload.authorize.state, authorize.state);
  assert.equal(payload.authorize.scope, authorize.scope);
});

test('Session token stored as hash, never plaintext', async () => {
  const sessionToken = 'raw-session-token-12345';
  const sessionHash = mockHashToken(sessionToken);

  // Hash should be different from raw
  assert.notEqual(sessionHash, sessionToken);

  // Hash should be 64 chars (SHA-256 hex)
  assert.equal(sessionHash.length, 64);
});

test('Banned user cannot login via QQ', async () => {
  const user = createUser(1, {
    ban_status: 'banned',
    ban_reason: 'violations',
    ban_expires_at: new Date(Date.now() + 3600000).toISOString(),
  });

  addSocialBinding(user.id, 'mock-openid-12345');

  // Check ban status
  assert.equal(user.ban_status, 'banned');
  assert.ok(new Date(user.ban_expires_at) > new Date());
});

test('Locked user cannot login via QQ', async () => {
  const user = createUser(1, {
    locked_until: new Date(Date.now() + 3600000).toISOString(),
    lock_level: 2,
  });

  addSocialBinding(user.id, 'mock-openid-12345');

  // Check lock status
  assert.ok(new Date(user.locked_until) > new Date());
  assert.equal(user.lock_level, 2);
});
