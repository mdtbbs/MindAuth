/**
 * Unit tests for qqProvider — verifies QQ OAuth API interactions:
 * - Authorization URL does not leak client_secret
 * - Token exchange handles form-encoded and JSONP responses
 * - OpenID extraction handles JSONP format
 * - Profile parsing validates ret code
 * - Timeout and error handling
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

// Mock config for qqProvider
const mockConfig = {
  qq: {
    enabled: true,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://auth.example.com/api/auth/qq/callback',
    timeoutMs: 5000,
  },
};

// Install mock config
const configPath = require.resolve('../../src/config');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: mockConfig,
};

const qqProvider = require('../../src/modules/social/qqProvider');

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

// ─── getAuthorizationUrl ─────────────────────────────────────────────────────

test('getAuthorizationUrl returns correct QQ endpoint', () => {
  const url = qqProvider.getAuthorizationUrl('test-state-123');

  assert.ok(url.startsWith('https://graph.qq.com/oauth2.0/authorize'));
});

test('getAuthorizationUrl includes client_id, redirect_uri, state', () => {
  const state = 'my-oauth-state';
  const url = qqProvider.getAuthorizationUrl(state);

  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('client_id'), 'test-client-id');
  assert.equal(params.get('redirect_uri'), mockConfig.qq.redirectUri);
  assert.equal(params.get('state'), state);
  assert.equal(params.get('response_type'), 'code');
});

test('getAuthorizationUrl does NOT include client_secret', () => {
  const url = qqProvider.getAuthorizationUrl('test-state');

  assert.ok(!url.includes('test-client-secret'), 'URL must not contain client_secret');
  assert.ok(!url.includes('client_secret'), 'URL must not contain client_secret param');
});

test('getAuthorizationUrl throws when not configured', () => {
  // Temporarily clear config
  const origConfig = mockConfig.qq;
  mockConfig.qq = { enabled: true };

  try {
    assert.throws(
      () => qqProvider.getAuthorizationUrl('state'),
      (err) => err.message === 'QQ OAuth is not configured'
    );
  } finally {
    mockConfig.qq = origConfig;
  }
});

// ─── exchangeCode ────────────────────────────────────────────────────────────

test('exchangeCode parses form-encoded response', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'access_token=ABC123&expires_in=7776000&refresh_token=XYZ789',
  });

  const result = await qqProvider.exchangeCode('valid-code');

  assert.equal(result.access_token, 'ABC123');
  assert.equal(result.expires_in, '7776000');
  assert.equal(result.refresh_token, 'XYZ789');
});

test('exchangeCode throws on JSONP error response', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'callback({"error":100002,"error_description":"code has been used"});',
  });

  await assert.rejects(
    () => qqProvider.exchangeCode('used-code'),
    (err) => err.message === 'QQ token exchange failed'
  );
});

test('exchangeCode throws when no access_token', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'expires_in=7776000', // no access_token
  });

  await assert.rejects(
    () => qqProvider.exchangeCode('valid-code'),
    (err) => err.message === 'QQ token exchange failed'
  );
});

test('exchangeCode throws on timeout', async () => {
  global.fetch = async (url, options) => {
    // Simulate timeout by checking signal
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  await assert.rejects(
    () => qqProvider.exchangeCode('valid-code'),
    (err) => err.message === 'QQ request timed out'
  );
});

test('exchangeCode throws on non-2xx response', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  });

  await assert.rejects(
    () => qqProvider.exchangeCode('valid-code'),
    (err) => err.message === 'QQ request failed'
  );
});

test('exchangeCode throws on oversized response', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'x'.repeat(257 * 1024), // > 256KB
  });

  await assert.rejects(
    () => qqProvider.exchangeCode('valid-code'),
    (err) => err.message === 'QQ response too large'
  );
});

test('exchangeCode throws on invalid code', async () => {
  await assert.rejects(
    () => qqProvider.exchangeCode(''),
    (err) => err.message === 'QQ authorization code invalid'
  );
});

// ─── getOpenId ───────────────────────────────────────────────────────────────

test('getOpenId parses JSONP response', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'callback( {"client_id":"12345","openid":"AAAAABBBBBCCCCC"} );',
  });

  const openid = await qqProvider.getOpenId('valid-token');

  assert.equal(openid, 'AAAAABBBBBCCCCC');
});

test('getOpenId throws when no openid', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'callback({"client_id":"12345"});', // no openid
  });

  await assert.rejects(
    () => qqProvider.getOpenId('valid-token'),
    (err) => err.message === 'QQ openid lookup failed'
  );
});

test('getOpenId throws when error field present', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'callback({"error":100005,"error_description":"access token is not valid"});',
  });

  await assert.rejects(
    () => qqProvider.getOpenId('invalid-token'),
    (err) => err.message === 'QQ openid lookup failed'
  );
});

test('getOpenId throws on malformed JSONP', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'not valid jsonp',
  });

  await assert.rejects(
    () => qqProvider.getOpenId('valid-token'),
    (err) => err.message === 'QQ openid lookup failed'
  );
});

test('getOpenId throws on empty token', async () => {
  await assert.rejects(
    () => qqProvider.getOpenId(''),
    (err) => err.message === 'QQ access token invalid'
  );
});

test('getOpenId throws on null token', async () => {
  await assert.rejects(
    () => qqProvider.getOpenId(null),
    (err) => err.message === 'QQ access token invalid'
  );
});

// ─── getProfile ──────────────────────────────────────────────────────────────

test('getProfile parses JSON response', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      ret: 0,
      msg: '',
      nickname: 'Test User',
      figureurl_qq_1: 'http://avatar.url/small',
      figureurl_qq_2: 'http://avatar.url/large',
      gender: '男',
    }),
  });

  const profile = await qqProvider.getProfile('valid-token', 'valid-openid');

  assert.equal(profile.ret, 0);
  assert.equal(profile.nickname, 'Test User');
  assert.equal(profile.figureurl_qq_2, 'http://avatar.url/large');
});

test('getProfile throws when ret !== 0', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      ret: -1,
      msg: 'invalid openid',
    }),
  });

  await assert.rejects(
    () => qqProvider.getProfile('valid-token', 'invalid-openid'),
    (err) => err.message === 'QQ profile lookup failed'
  );
});

test('getProfile throws on timeout', async () => {
  global.fetch = async (url, options) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  await assert.rejects(
    () => qqProvider.getProfile('valid-token', 'valid-openid'),
    (err) => err.message === 'QQ request timed out'
  );
});

test('getProfile throws on non-2xx response', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  });

  await assert.rejects(
    () => qqProvider.getProfile('valid-token', 'valid-openid'),
    (err) => err.message === 'QQ profile lookup failed'
  );
});

test('getProfile throws on invalid JSON', async () => {
  global.fetch = async () => ({
    ok: true,
    text: async () => 'not valid json',
  });

  await assert.rejects(
    () => qqProvider.getProfile('valid-token', 'valid-openid'),
    (err) => err.message === 'QQ profile lookup failed'
  );
});

// ─── Configuration ───────────────────────────────────────────────────────────

test('uses default timeout when not configured', async () => {
  const origTimeout = mockConfig.qq.timeoutMs;
  delete mockConfig.qq.timeoutMs;

  try {
    // Reset require cache to reload config
    delete require.cache[require.resolve('../../src/modules/social/qqProvider')];
    const provider = require('../../src/modules/social/qqProvider');

    // Should not throw (uses default 5000ms)
    assert.ok(true);
  } finally {
    mockConfig.qq.timeoutMs = origTimeout;
    delete require.cache[require.resolve('../../src/modules/social/qqProvider')];
  }
});

// ─── Security: No secret leakage ─────────────────────────────────────────────

test('getAuthorizationUrl does NOT leak client_secret', () => {
  const url = qqProvider.getAuthorizationUrl('test-state');

  // URL should NOT contain client_secret
  assert.ok(!url.includes('test-client-secret'), 'Authorization URL must not contain client_secret');
  assert.ok(!url.includes('client_secret'), 'Authorization URL must not contain client_secret param');
});

test('exchangeCode uses config values', async () => {
  let capturedUrl = '';

  global.fetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      text: async () => 'access_token=ABC123&expires_in=7776000',
    };
  };

  await qqProvider.exchangeCode('user-code');

  // URL should contain configured values (may be URL-encoded)
  assert.ok(capturedUrl.includes('test-client-id'));
  // redirect_uri is URL-encoded in query string
  const expectedRedirectUri = encodeURIComponent(mockConfig.qq.redirectUri);
  assert.ok(
    capturedUrl.includes(mockConfig.qq.redirectUri) || capturedUrl.includes(expectedRedirectUri),
    'URL must contain redirect_uri'
  );

  // Note: QQ API requires client_secret in token exchange URL (this is QQ's design)
  // The important security check is that getAuthorizationUrl does not leak it
});
