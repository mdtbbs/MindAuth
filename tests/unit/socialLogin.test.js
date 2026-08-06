/**
 * Unit tests for socialLogin — verifies QQ social login business logic:
 * - findByQq returns binding or null
 * - loginExisting handles banned/locked users
 * - bindQq prevents duplicate binding
 * - unbindQq protects last login method
 * - checkLoginAllowed validates ban/lock status
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock data stores ────────────────────────────────────────────────────────

let socialAccounts = [];
let users = [];
let loginLogs = [];

// ─── Mock MySQL pool ─────────────────────────────────────────────────────────

const mockPool = {
  execute: async (sql, params) => {
    // Normalize SQL for routing
    const normalizedSql = sql.replace(/\s+/g, ' ').trim().toUpperCase();

    // SELECT from social_accounts
    if (normalizedSql.includes('SELECT') && normalizedSql.includes('SOCIAL_ACCOUNTS')) {
      if (normalizedSql.includes('WHERE PROVIDER = ? AND PROVIDER_USER_ID = ?')) {
        const [provider, providerUserId] = params;
        const found = socialAccounts.filter(
          (s) => s.provider === provider && s.provider_user_id === providerUserId
        );
        return [found.length > 0 ? [found[0]] : []];
      }
      // More specific condition must be checked before generic WHERE USER_ID = ?
      if (normalizedSql.includes('WHERE USER_ID = ? AND ID != ?')) {
        const [userId, excludeId] = params;
        const found = socialAccounts.filter(
          (s) => s.user_id === userId && s.id !== excludeId
        );
        return [[{ count: found.length }]];
      }
      if (normalizedSql.includes('WHERE ID = ? AND USER_ID = ?')) {
        const [id, userId] = params;
        const found = socialAccounts.filter(
          (s) => s.id === id && s.user_id === userId
        );
        return [found.length > 0 ? [found[0]] : []];
      }
      if (normalizedSql.includes('WHERE USER_ID = ?')) {
        const [userId] = params;
        const found = socialAccounts.filter((s) => s.user_id === userId);
        return [found];
      }
    }

    // SELECT password_hash (must be before general USERS SELECT)
    if (normalizedSql.includes('SELECT PASSWORD_HASH')) {
      const [userId] = params;
      const found = users.filter((u) => u.id === userId);
      return [found.length > 0 ? [{ password_hash: found[0].password_hash }] : []];
    }

    // SELECT from users
    if (normalizedSql.includes('SELECT') && normalizedSql.includes('USERS')) {
      if (normalizedSql.includes('WHERE ID = ?')) {
        const [id] = params;
        const found = users.filter((u) => u.id === id);
        return [found.length > 0 ? [found[0]] : []];
      }
    }

    // INSERT into social_accounts
    if (normalizedSql.includes('INSERT INTO SOCIAL_ACCOUNTS')) {
      const [userId, provider, providerUserId, nickname, avatarUrl] = params;

      // Check unique constraints
      const existingByProvider = socialAccounts.find(
        (s) => s.user_id === userId && s.provider === provider
      );
      if (existingByProvider) {
        const err = new Error('Duplicate entry');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      const existingByUser = socialAccounts.find(
        (s) => s.provider === provider && s.provider_user_id === providerUserId
      );
      if (existingByUser) {
        const err = new Error('Duplicate entry');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }

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
      if (normalizedSql.includes('SET NICKNAME = ?, AVATAR_URL = ?, LAST_LOGIN_AT')) {
        const [nickname, avatarUrl, id] = params;
        const found = socialAccounts.find((s) => s.id === id);
        if (found) {
          found.nickname = nickname;
          found.avatar_url = avatarUrl;
          found.last_login_at = new Date();
        }
        return [{ affectedRows: 1 }];
      }
    }

    // DELETE from social_accounts
    if (normalizedSql.includes('DELETE FROM SOCIAL_ACCOUNTS')) {
      const [id] = params;
      const idx = socialAccounts.findIndex((s) => s.id === id);
      if (idx >= 0) {
        socialAccounts.splice(idx, 1);
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }

    // INSERT into login_logs
    if (normalizedSql.includes('INSERT INTO LOGIN_LOGS')) {
      const [userId, ip, device, loginType] = params;
      loginLogs.push({
        user_id: userId,
        ip,
        device,
        login_type: loginType,
        created_at: new Date(),
      });
      return [{ affectedRows: 1 }];
    }

    // UPDATE users ban/lock
    if (normalizedSql.includes('UPDATE USERS SET BAN_STATUS')) {
      const [userId] = params;
      const found = users.find((u) => u.id === userId);
      if (found) {
        found.ban_status = 'none';
      }
      return [{ affectedRows: 1 }];
    }
    if (normalizedSql.includes('UPDATE USERS SET LOCKED_UNTIL = NULL')) {
      const [userId] = params;
      const found = users.find((u) => u.id === userId);
      if (found) {
        found.locked_until = null;
      }
      return [{ affectedRows: 1 }];
    }

    // Default: return empty
    return [[], []];
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
};

// ─── Mock logUserAudit ───────────────────────────────────────────────────────

const mockLogUserAudit = () => {}; // No-op for tests

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

const sessionPath = require.resolve('../../src/modules/sessions/sessionManager');
require.cache[sessionPath] = {
  id: sessionPath,
  filename: sessionPath,
  loaded: true,
  exports: mockSessionManager,
};

const auditPath = require.resolve('../../src/utils/userAudit');
require.cache[auditPath] = {
  id: auditPath,
  filename: auditPath,
  loaded: true,
  exports: { logUserAudit: mockLogUserAudit },
};

const socialLogin = require('../../src/modules/social/socialLogin');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetData() {
  socialAccounts = [];
  users = [];
  loginLogs = [];
}

function createUser(id, options = {}) {
  const user = {
    id,
    username: `user${id}`,
    email: `user${id}@test.com`,
    password_hash: 'password_hash' in options ? options.password_hash : 'hashed-password',
    role: 'user',
    ban_status: 'ban_status' in options ? options.ban_status : 'none',
    ban_reason: 'ban_reason' in options ? options.ban_reason : null,
    ban_expires_at: 'ban_expires_at' in options ? options.ban_expires_at : null,
    locked_until: 'locked_until' in options ? options.locked_until : null,
    lock_level: 'lock_level' in options ? options.lock_level : null,
  };
  users.push(user);
  return user;
}

beforeEach(() => {
  resetData();
});

// ─── findByQq ────────────────────────────────────────────────────────────────

test('findByQq returns binding when found', async () => {
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
    nickname: 'Test User',
  });

  const result = await socialLogin.findByQq('openid-123');

  assert.equal(result.id, 1);
  assert.equal(result.user_id, 100);
  assert.equal(result.provider, 'qq');
});

test('findByQq returns null when not found', async () => {
  const result = await socialLogin.findByQq('non-existent');

  assert.equal(result, null);
});

// ─── loginExisting ───────────────────────────────────────────────────────────

test('loginExisting creates session for bound user', async () => {
  createUser(100);
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  const result = await socialLogin.loginExisting({
    openid: 'openid-123',
    nickname: 'Updated Name',
    ipAddress: '127.0.0.1',
    userAgent: 'Test Agent',
  });

  assert.ok(result);
  assert.equal(result.user.id, 100);
  assert.ok(result.session.token);
});

test('loginExisting returns null when no binding', async () => {
  const result = await socialLogin.loginExisting({
    openid: 'non-existent',
  });

  assert.equal(result, null);
});

test('loginExisting throws when user is banned', async () => {
  createUser(100, { ban_status: 'banned', ban_reason: 'violations' });
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  await assert.rejects(
    () => socialLogin.loginExisting({ openid: 'openid-123' }),
    (err) => err.code === 'USER_BANNED'
  );
});

test('loginExisting throws when user is locked', async () => {
  createUser(100, {
    locked_until: new Date(Date.now() + 3600000).toISOString(),
    lock_level: 2,
  });
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  await assert.rejects(
    () => socialLogin.loginExisting({ openid: 'openid-123' }),
    (err) => err.code === 'ACCOUNT_LOCKED'
  );
});

test('loginExisting allows when ban is expired', async () => {
  createUser(100, {
    ban_status: 'banned',
    ban_expires_at: new Date(Date.now() - 3600000).toISOString(), // expired
  });
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  const result = await socialLogin.loginExisting({ openid: 'openid-123' });

  assert.ok(result, 'login should succeed after ban expires');
});

test('loginExisting allows when lock is expired', async () => {
  createUser(100, {
    locked_until: new Date(Date.now() - 3600000).toISOString(), // expired
  });
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  const result = await socialLogin.loginExisting({ openid: 'openid-123' });

  assert.ok(result, 'login should succeed after lock expires');
});

test('loginExisting records login_type as social', async () => {
  createUser(100);
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  await socialLogin.loginExisting({
    openid: 'openid-123',
    ipAddress: '192.168.1.1',
    userAgent: 'Mozilla/5.0',
  });

  assert.equal(loginLogs.length, 1);
  assert.equal(loginLogs[0].login_type, 'social');
});

// ─── bindQq ──────────────────────────────────────────────────────────────────

test('bindQq creates new binding', async () => {
  const result = await socialLogin.bindQq(100, {
    openid: 'openid-new',
    nickname: 'New User',
    avatarUrl: 'http://avatar.url',
  });

  assert.equal(result.user_id, 100);
  assert.equal(result.provider, 'qq');
  assert.equal(result.provider_user_id, 'openid-new');
});

test('bindQq throws when QQ bound to other user', async () => {
  socialAccounts.push({
    id: 1,
    user_id: 200, // different user
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  await assert.rejects(
    () => socialLogin.bindQq(100, { openid: 'openid-123' }),
    (err) => err.code === 'QQ_ALREADY_BOUND_TO_OTHER' && err.status === 409
  );
});

test('bindQq returns existing when same user already bound', async () => {
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  const result = await socialLogin.bindQq(100, { openid: 'openid-123' });

  assert.equal(result.id, 1);
  assert.equal(result.user_id, 100);
});

// ─── listBindings ────────────────────────────────────────────────────────────

test('listBindings returns all bindings for user', async () => {
  socialAccounts.push(
    { id: 1, user_id: 100, provider: 'qq', provider_user_id: 'openid-1' },
    { id: 2, user_id: 100, provider: 'github', provider_user_id: 'gh-1' }
  );

  const bindings = await socialLogin.listBindings(100);

  assert.equal(bindings.length, 2);
});

test('listBindings returns empty array when no bindings', async () => {
  const bindings = await socialLogin.listBindings(100);

  assert.deepEqual(bindings, []);
});

// ─── unbindQq ────────────────────────────────────────────────────────────────

test('unbindQq removes binding when user has password', async () => {
  createUser(100, { password_hash: 'hashed-password' });
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  const result = await socialLogin.unbindQq(1, 100);

  assert.equal(result, true);
  assert.equal(socialAccounts.length, 0);
});

test('unbindQq throws when binding not found', async () => {
  await assert.rejects(
    () => socialLogin.unbindQq(999, 100),
    (err) => err.code === 'BINDING_NOT_FOUND' && err.status === 404
  );
});

test('unbindQq throws when binding belongs to other user', async () => {
  socialAccounts.push({
    id: 1,
    user_id: 200, // different user
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  await assert.rejects(
    () => socialLogin.unbindQq(1, 100),
    (err) => err.code === 'BINDING_NOT_FOUND'
  );
});

test('unbindQq throws when QQ is only login method (no password)', async () => {
  createUser(100, { password_hash: '' });
  socialAccounts.push({
    id: 1,
    user_id: 100,
    provider: 'qq',
    provider_user_id: 'openid-123',
  });

  await assert.rejects(
    () => socialLogin.unbindQq(1, 100),
    (err) => err.code === 'CANNOT_UNBIND_LAST_LOGIN' && err.status === 400
  );
});

test('unbindQq allows when user has other bindings', async () => {
  createUser(100, { password_hash: '' });
  socialAccounts.push(
    { id: 1, user_id: 100, provider: 'qq', provider_user_id: 'openid-123' },
    { id: 2, user_id: 100, provider: 'github', provider_user_id: 'gh-1' }
  );

  const result = await socialLogin.unbindQq(1, 100);

  assert.equal(result, true);
  assert.equal(socialAccounts.length, 1);
  assert.equal(socialAccounts[0].provider, 'github');
});

// ─── checkLoginAllowed ───────────────────────────────────────────────────────

test('checkLoginAllowed returns allowed for normal user', async () => {
  const user = createUser(100);

  const result = await socialLogin.checkLoginAllowed(user);

  assert.equal(result.allowed, true);
});

test('checkLoginAllowed returns false for banned user', async () => {
  const user = createUser(100, {
    ban_status: 'banned',
    ban_reason: 'violations',
    ban_expires_at: new Date(Date.now() + 3600000).toISOString(),
  });

  const result = await socialLogin.checkLoginAllowed(user);

  assert.equal(result.allowed, false);
  assert.equal(result.error.code, 'USER_BANNED');
  assert.equal(result.error.ban_reason, 'violations');
});

test('checkLoginAllowed returns false for locked user', async () => {
  const user = createUser(100, {
    locked_until: new Date(Date.now() + 3600000).toISOString(),
    lock_level: 2,
  });

  const result = await socialLogin.checkLoginAllowed(user);

  assert.equal(result.allowed, false);
  assert.equal(result.error.code, 'ACCOUNT_LOCKED');
  assert.equal(result.error.lock_level, 2);
});

test('checkLoginAllowed clears expired ban', async () => {
  const user = createUser(100, {
    ban_status: 'banned',
    ban_expires_at: new Date(Date.now() - 3600000).toISOString(), // expired
  });

  const result = await socialLogin.checkLoginAllowed(user);

  assert.equal(result.allowed, true);
  // User should be updated
  assert.equal(users[0].ban_status, 'none');
});

test('checkLoginAllowed clears expired lock', async () => {
  const user = createUser(100, {
    locked_until: new Date(Date.now() - 3600000).toISOString(), // expired
  });

  const result = await socialLogin.checkLoginAllowed(user);

  assert.equal(result.allowed, true);
  // User should be updated
  assert.equal(users[0].locked_until, null);
});
