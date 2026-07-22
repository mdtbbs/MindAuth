/**
 * OAuth Contract Tests
 *
 * Locks down the response shapes and behaviors of all OAuth 2.0 / OIDC endpoints.
 * These tests form the safety net for all subsequent refactor tasks.
 *
 * Endpoints tested:
 *   GET  /.well-known/openid-configuration
 *   POST /api/token
 *   POST /api/refresh
 *   POST /api/revoke
 *   POST /api/introspect
 *   GET  /api/userinfo
 *   GET  /api/user
 *   POST /api/verify
 */

const { test, expect } = require('@playwright/test');

const ADMIN_SECRET = 'admin123';

// Seeded test OAuth client (see src/db/schema-mysql.js seedTestOAuthClient)
const CLIENT_ID = 'forum';
const CLIENT_SECRET = 'forum_secret_key_for_development';
const REDIRECT_URI = 'http://localhost:4500/api/auth/callback';

/** Helper: clear rate limits */
async function clearRateLimits(request) {
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  } catch { /* ignore */ }
}

/** Helper: register a fresh user via API and return credentials */
async function registerUser(request) {
  const ts = Date.now();
  const username = `oauth_contract_${ts}`;
  const email = `${username}@test.com`;
  const password = 'TestPass123';

  const res = await request.post('/api/register', {
    data: { username, email, password }
  });
  expect(res.status()).toBe(201);
  return { username, email, password };
}

/** Helper: login a user and return the session token from cookie */
async function loginUser(request, username, password) {
  const res = await request.post('/api/login', {
    data: { username, password }
  });
  expect(res.ok()).toBeTruthy();

  // Extract session cookie
  const cookies = await request.storageState();
  const sessionCookie = cookies.cookies.find(c => c.name === 'session');
  return sessionCookie ? sessionCookie.value : null;
}

/** Helper: perform OAuth authorize and return auth code */
async function getAuthCode(request, clientId = CLIENT_ID) {
  const redirectUri = encodeURIComponent(REDIRECT_URI);
  const url = `/api/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`;
  const res = await request.get(url, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const location = res.headers()['location'];
  const match = location.match(/code=([^&]+)/);
  expect(match).toBeTruthy();
  return match[1];
}

/** Helper: exchange auth code for tokens */
async function exchangeToken(request, code, clientId = CLIENT_ID, clientSecret = CLIENT_SECRET) {
  const res = await request.post('/api/token', {
    data: {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code'
    }
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test.beforeAll(async ({ request }) => {
  await clearRateLimits(request);
});

// ─────────────────────────────────────────────────────────────
// OIDC Discovery
// ─────────────────────────────────────────────────────────────
test.describe('OIDC Discovery (/.well-known/openid-configuration)', () => {
  test('returns discovery metadata with correct structure', async ({ request }) => {
    const res = await request.get('/.well-known/openid-configuration');
    expect(res.ok()).toBeTruthy();

    const body = await res.json();

    // Required OIDC discovery fields
    expect(body).toHaveProperty('issuer');
    expect(body).toHaveProperty('authorization_endpoint');
    expect(body).toHaveProperty('token_endpoint');
    expect(body).toHaveProperty('userinfo_endpoint');
    expect(body).toHaveProperty('response_types_supported');
    expect(body).toHaveProperty('subject_types_supported');
    expect(body).toHaveProperty('scopes_supported');
    expect(body).toHaveProperty('token_endpoint_auth_methods_supported');

    // Value assertions
    expect(body.response_types_supported).toEqual(['code']);
    expect(body.subject_types_supported).toEqual(['public']);
    expect(body.scopes_supported).toContain('openid');
    expect(body.scopes_supported).toContain('profile');
    expect(body.scopes_supported).toContain('email');
    expect(body.token_endpoint_auth_methods_supported).toContain('client_secret_post');
    expect(body.grant_types_supported).toContain('authorization_code');
    expect(body.grant_types_supported).toContain('refresh_token');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  // KNOWN ISSUE: Current discovery returns endpoints WITHOUT /api prefix
  // (e.g. /authorize instead of /api/authorize). This will be fixed during refactor.
  test('CURRENT BEHAVIOR: endpoints lack /api prefix (known issue to fix)', async ({ request }) => {
    const res = await request.get('/.well-known/openid-configuration');
    const body = await res.json();

    // Capture CURRENT behavior — endpoints do NOT have /api prefix
    expect(body.authorization_endpoint).toContain('/authorize');
    expect(body.authorization_endpoint).not.toContain('/api/authorize');

    expect(body.token_endpoint).toContain('/token');
    expect(body.token_endpoint).not.toContain('/api/token');

    expect(body.userinfo_endpoint).toContain('/userinfo');
    expect(body.userinfo_endpoint).not.toContain('/api/userinfo');

    expect(body.revocation_endpoint).toContain('/revoke');
    expect(body.revocation_endpoint).not.toContain('/api/revoke');

    expect(body.introspection_endpoint).toContain('/introspect');
    expect(body.introspection_endpoint).not.toContain('/api/introspect');
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/token
// ─────────────────────────────────────────────────────────────
test.describe('POST /api/token — response shape', () => {
  test('successful token exchange returns RFC 6749 compliant response', async ({ request }) => {
    await clearRateLimits(request);
    const { username, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    // RFC 6749 Section 5.1 required fields
    expect(tokenData).toHaveProperty('access_token');
    expect(tokenData).toHaveProperty('token_type');
    expect(tokenData).toHaveProperty('refresh_token');
    expect(tokenData).toHaveProperty('expires_in');
    expect(tokenData).toHaveProperty('scope');

    // Value assertions
    expect(typeof tokenData.access_token).toBe('string');
    expect(tokenData.access_token.length).toBeGreaterThan(0);
    expect(tokenData.token_type).toBe('Bearer');
    expect(typeof tokenData.refresh_token).toBe('string');
    expect(tokenData.refresh_token.length).toBeGreaterThan(0);
    expect(tokenData.expires_in).toBe(3600); // 1 hour in seconds
    expect(tokenData.scope).toContain('openid');
  });

  test('missing grant_type returns unsupported_grant_type error', async ({ request }) => {
    const res = await request.post('/api/token', {
      data: { code: 'x', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_grant_type');
    expect(body).toHaveProperty('error_description');
  });

  test('invalid client credentials return invalid_client error', async ({ request }) => {
    const res = await request.post('/api/token', {
      data: {
        code: 'x',
        client_id: 'bad_client',
        client_secret: 'bad_secret',
        grant_type: 'authorization_code'
      }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  test('expired/invalid code returns invalid_grant error', async ({ request }) => {
    const res = await request.post('/api/token', {
      data: {
        code: 'nonexistent_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code'
      }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
  });

  test('missing required params returns invalid_request error', async ({ request }) => {
    const res = await request.post('/api/token', {
      data: { grant_type: 'authorization_code' }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/refresh
// ─────────────────────────────────────────────────────────────
test.describe('POST /api/refresh — response shape', () => {
  test('successful refresh returns new tokens with rotation', async ({ request }) => {
    await clearRateLimits(request);
    const { username, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    // Refresh
    const refreshRes = await request.post('/api/refresh', {
      data: {
        refresh_token: tokenData.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });
    expect(refreshRes.ok()).toBeTruthy();
    const refreshData = await refreshRes.json();

    // Same shape as token response
    expect(refreshData).toHaveProperty('access_token');
    expect(refreshData).toHaveProperty('token_type', 'Bearer');
    expect(refreshData).toHaveProperty('refresh_token');
    expect(refreshData).toHaveProperty('expires_in', 3600);
    expect(refreshData).toHaveProperty('scope');

    // Refresh token rotation: new refresh token should differ from old
    expect(refreshData.refresh_token).not.toBe(tokenData.refresh_token);
    // New access token should also differ
    expect(refreshData.access_token).not.toBe(tokenData.access_token);
  });

  test('invalid refresh_token returns invalid_grant error', async ({ request }) => {
    const res = await request.post('/api/refresh', {
      data: {
        refresh_token: 'invalid_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
  });

  test('missing grant_type returns unsupported_grant_type error', async ({ request }) => {
    const res = await request.post('/api/refresh', {
      data: {
        refresh_token: 'x',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_grant_type');
  });

  test('replay of revoked refresh token is rejected', async ({ request }) => {
    await clearRateLimits(request);
    const { username, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    // First refresh succeeds
    const refreshRes = await request.post('/api/refresh', {
      data: {
        refresh_token: tokenData.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });
    expect(refreshRes.ok()).toBeTruthy();

    // Replay of old (now revoked) refresh token should fail
    const replayRes = await request.post('/api/refresh', {
      data: {
        refresh_token: tokenData.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });
    expect(replayRes.status()).toBe(401);
    const body = await replayRes.json();
    expect(body.error).toBe('invalid_grant');
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/introspect (RFC 7662)
// ─────────────────────────────────────────────────────────────
test.describe('POST /api/introspect — response shape', () => {
  test('active access token returns introspection with active=true', async ({ request }) => {
    await clearRateLimits(request);
    const { username, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    const introspectRes = await request.post('/api/introspect', {
      data: {
        token: tokenData.access_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    expect(introspectRes.ok()).toBeTruthy();
    const body = await introspectRes.json();

    expect(body.active).toBe(true);
    expect(body.token_type).toBe('Bearer');
    expect(body).toHaveProperty('scope');
    expect(body).toHaveProperty('client_id', CLIENT_ID);
    expect(body).toHaveProperty('sub'); // user ID as string
  });

  test('active refresh token returns introspection with token_type=refresh_token', async ({ request }) => {
    await clearRateLimits(request);
    const { username, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    const introspectRes = await request.post('/api/introspect', {
      data: {
        token: tokenData.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    expect(introspectRes.ok()).toBeTruthy();
    const body = await introspectRes.json();

    expect(body.active).toBe(true);
    expect(body.token_type).toBe('refresh_token');
    expect(body).toHaveProperty('client_id', CLIENT_ID);
  });

  test('unknown token returns active=false', async ({ request }) => {
    const res = await request.post('/api/introspect', {
      data: {
        token: 'nonexistent_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.active).toBe(false);
  });

  test('missing client credentials returns invalid_client', async ({ request }) => {
    const res = await request.post('/api/introspect', {
      data: { token: 'x' }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  test('missing token returns invalid_request', async ({ request }) => {
    const res = await request.post('/api/introspect', {
      data: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/userinfo (OIDC Core)
// ─────────────────────────────────────────────────────────────
test.describe('GET /api/userinfo — response shape', () => {
  test('returns user claims with Bearer token', async ({ request }) => {
    await clearRateLimits(request);
    const { username, email, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    const userinfoRes = await request.get('/api/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    expect(userinfoRes.ok()).toBeTruthy();
    const claims = await userinfoRes.json();

    // sub is always present (OIDC standard)
    expect(claims).toHaveProperty('sub');
    expect(typeof claims.sub).toBe('string');

    // With openid+profile+email scopes
    expect(claims).toHaveProperty('name', username);
    expect(claims).toHaveProperty('email', email);
    expect(claims).toHaveProperty('email_verified');
    expect(claims).toHaveProperty('username', username);
  });

  test('missing Authorization header returns 401', async ({ request }) => {
    const res = await request.get('/api/userinfo');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_token');
  });

  test('invalid Bearer token returns 401', async ({ request }) => {
    const res = await request.get('/api/userinfo', {
      headers: { Authorization: 'Bearer invalid_token_value' }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_token');
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/user (compatibility endpoint)
// ─────────────────────────────────────────────────────────────
test.describe('GET /api/user — compatibility endpoint response shape', () => {
  test('returns user data with Bearer token', async ({ request }) => {
    await clearRateLimits(request);
    const { username, email, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    const userRes = await request.get('/api/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    expect(userRes.ok()).toBeTruthy();
    const body = await userRes.json();

    // Compatibility endpoint returns flat user object
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('username', username);
    expect(body).toHaveProperty('email', email);
    expect(body).toHaveProperty('avatar_url');
    expect(body).toHaveProperty('phone_masked');
    expect(body).toHaveProperty('phone_verified');
    expect(body).toHaveProperty('created_at');
  });

  test('missing Bearer token returns 401', async ({ request }) => {
    const res = await request.get('/api/user');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_token');
  });

  test('invalid Bearer token returns 401', async ({ request }) => {
    const res = await request.get('/api/user', {
      headers: { Authorization: 'Bearer bad_token' }
    });
    expect(res.status()).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/revoke (RFC 7009)
// ─────────────────────────────────────────────────────────────
test.describe('POST /api/revoke — response shape', () => {
  test('revoking an access token returns success and invalidates token', async ({ request }) => {
    await clearRateLimits(request);
    const { username, password } = await registerUser(request);
    await loginUser(request, username, password);

    const code = await getAuthCode(request);
    const tokenData = await exchangeToken(request, code);

    const revokeRes = await request.post('/api/revoke', {
      data: {
        token: tokenData.access_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    expect(revokeRes.ok()).toBeTruthy();
    const body = await revokeRes.json();
    expect(body.success).toBe(true);

    // Introspect should now show token as inactive
    const introspectRes = await request.post('/api/introspect', {
      data: {
        token: tokenData.access_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    const introspectBody = await introspectRes.json();
    expect(introspectBody.active).toBe(false);
  });

  test('revoking nonexistent token still returns success (RFC 7009)', async ({ request }) => {
    const res = await request.post('/api/revoke', {
      data: {
        token: 'nonexistent_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('missing client credentials returns invalid_client', async ({ request }) => {
    const res = await request.post('/api/revoke', {
      data: { token: 'x' }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  test('missing token returns invalid_request', async ({ request }) => {
    const res = await request.post('/api/revoke', {
      data: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/verify (session verification)
// ─────────────────────────────────────────────────────────────
test.describe('POST /api/verify — session token verification response shape', () => {
  test('valid session token returns user info', async ({ request }) => {
    await clearRateLimits(request);
    const { username, email, password } = await registerUser(request);
    const sessionToken = await loginUser(request, username, password);

    const verifyRes = await request.post('/api/verify', {
      data: { session_token: sessionToken }
    });
    expect(verifyRes.ok()).toBeTruthy();
    const body = await verifyRes.json();

    expect(body.success).toBe(true);
    expect(body).toHaveProperty('user');
    expect(body.user).toHaveProperty('id');
    expect(body.user).toHaveProperty('username', username);
    expect(body.user).toHaveProperty('email', email);
  });

  test('invalid session token returns 401', async ({ request }) => {
    const res = await request.post('/api/verify', {
      data: { session_token: 'invalid_session_token' }
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_grant');
  });

  test('missing session_token returns invalid_request', async ({ request }) => {
    const res = await request.post('/api/verify', {
      data: {}
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });
});
