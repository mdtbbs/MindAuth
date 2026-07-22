/**
 * Security Contract Tests
 *
 * Locks down CSRF protection rules, IP ban behavior, and redirect URI validation.
 * These tests form the safety net for all subsequent refactor tasks.
 *
 * Tested:
 *   - CSRF: state-changing routes require valid token
 *   - CSRF: exempt paths skip validation
 *   - IP ban CRUD (exact and CIDR)
 *   - Redirect URI rejection in admin client creation/update
 */

const { test, expect } = require('@playwright/test');

const ADMIN_SECRET = 'admin123';

/** Helper: clear rate limits */
async function clearRateLimits(request) {
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  } catch { /* ignore */ }
}

/** Helper: login as admin and return cookie header string */
async function getAdminCookieHeader(request) {
  await clearRateLimits(request);
  const res = await request.post('/api/admin/login', {
    data: { username: 'testadmin', password: 'AdminPass123' }
  });
  expect(res.ok()).toBeTruthy();
  const state = await request.storageState();
  return state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/** Helper: get CSRF token from cookie on a given request context */
async function getCsrfToken(request) {
  // Any response from the server sets the csrf_token cookie
  await request.get('/api/health');
  const state = await request.storageState();
  const csrfCookie = state.cookies.find(c => c.name === 'csrf_token');
  return csrfCookie ? csrfCookie.value : null;
}

test.beforeAll(async ({ request }) => {
  await clearRateLimits(request);
});

// ─────────────────────────────────────────────────────────────
// CSRF Protection
// ─────────────────────────────────────────────────────────────
test.describe('CSRF protection — state-changing routes require token', () => {
  test('POST to protected route without CSRF token returns 403', async ({ request }) => {
    // Register a user first (we need an authenticated context)
    const ts = Date.now();
    await request.post('/api/register', {
      data: { username: `csrf_test_${ts}`, email: `csrf_${ts}@test.com`, password: 'TestPass123' }
    });

    // Login (sets session cookie)
    await request.post('/api/login', {
      data: { username: `csrf_test_${ts}`, password: 'TestPass123' }
    });

    // POST to a CSRF-protected route without X-CSRF-Token header
    // /api/logout requires auth + CSRF
    const res = await request.post('/api/logout');
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('CSRF');
  });

  test('POST to protected route WITH valid CSRF token succeeds', async ({ request }) => {
    const ts = Date.now();
    const username = `csrf_ok_${ts}`;

    await request.post('/api/register', {
      data: { username, email: `${username}@test.com`, password: 'TestPass123' }
    });

    await request.post('/api/login', {
      data: { username, password: 'TestPass123' }
    });

    // Get CSRF token from cookie
    const csrfToken = await getCsrfToken(request);
    expect(csrfToken).toBeTruthy();

    // POST with valid CSRF token
    const res = await request.post('/api/logout', {
      headers: { 'X-CSRF-Token': csrfToken }
    });
    // Should NOT be 403 (CSRF passed)
    expect(res.status()).not.toBe(403);
    expect(res.ok()).toBeTruthy();
  });

  test('POST with wrong CSRF token returns 403', async ({ request }) => {
    const ts = Date.now();
    const username = `csrf_bad_${ts}`;

    await request.post('/api/register', {
      data: { username, email: `${username}@test.com`, password: 'TestPass123' }
    });

    await request.post('/api/login', {
      data: { username, password: 'TestPass123' }
    });

    // Get CSRF token (to ensure cookie is set)
    await getCsrfToken(request);

    // POST with wrong CSRF token
    const res = await request.post('/api/logout', {
      headers: { 'X-CSRF-Token': 'definitely_wrong_token_value' }
    });
    expect(res.status()).toBe(403);
  });

  test('admin endpoint without CSRF returns 403', async ({ request }) => {
    const cookieHeader = await getAdminCookieHeader(request);

    // Try to access admin stats without CSRF token
    const res = await request.get('/api/admin/stats', {
      headers: { cookie: cookieHeader }
    });
    // GET is not CSRF-protected — should succeed
    // Actually admin stats is GET so it's not CSRF-protected
    // Let's use a POST admin endpoint instead
    // The CSRF cookie header is needed for state-changing requests

    // Use a DELETE to test CSRF on admin
    const deleteRes = await request.delete('/api/admin/clients/nonexistent', {
      headers: { cookie: cookieHeader }
    });
    expect(deleteRes.status()).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// CSRF Exempt Paths
// ─────────────────────────────────────────────────────────────
test.describe('CSRF exempt paths — no CSRF token required', () => {
  test('POST /api/token does not require CSRF', async ({ request }) => {
    // Even with invalid data, should NOT get 403 (CSRF error)
    const res = await request.post('/api/token', {
      data: { code: 'x', client_id: 'bad', client_secret: 'bad', grant_type: 'authorization_code' }
    });
    expect(res.status()).not.toBe(403);
    // Should get a normal OAuth error instead
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/refresh does not require CSRF', async ({ request }) => {
    const res = await request.post('/api/refresh', {
      data: { refresh_token: 'x', client_id: 'bad', client_secret: 'bad', grant_type: 'refresh_token' }
    });
    expect(res.status()).not.toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/revoke does not require CSRF', async ({ request }) => {
    const res = await request.post('/api/revoke', {
      data: { token: 'x', client_id: 'bad', client_secret: 'bad' }
    });
    expect(res.status()).not.toBe(403);
  });

  test('POST /api/verify does not require CSRF', async ({ request }) => {
    const res = await request.post('/api/verify', {
      data: { session_token: 'invalid' }
    });
    expect(res.status()).not.toBe(403);
    // Should get 401 (invalid token), not 403 (CSRF)
    expect(res.status()).toBe(401);
  });

  test('POST /api/introspect does not require CSRF', async ({ request }) => {
    const res = await request.post('/api/introspect', {
      data: { token: 'x', client_id: 'bad', client_secret: 'bad' }
    });
    expect(res.status()).not.toBe(403);
  });

  test('POST /api/register does not require CSRF', async ({ request }) => {
    const ts = Date.now();
    const res = await request.post('/api/register', {
      data: { username: `csrf_exempt_${ts}`, email: `csrf_exempt_${ts}@test.com`, password: 'TestPass123' }
    });
    expect(res.status()).not.toBe(403);
    expect(res.status()).toBe(201);
  });

  test('POST /api/login does not require CSRF', async ({ request }) => {
    const res = await request.post('/api/login', {
      data: { username: 'nonexistent', password: 'x' }
    });
    expect(res.status()).not.toBe(403);
    // Should get 401 (invalid credentials), not 403
    expect(res.status()).toBe(401);
  });

  test('POST /api/admin/login does not require CSRF', async ({ request }) => {
    await clearRateLimits(request);
    const res = await request.post('/api/admin/login', {
      data: { username: 'testadmin', password: 'AdminPass123' }
    });
    expect(res.status()).not.toBe(403);
    expect(res.ok()).toBeTruthy();
  });

  test('POST /api/challenge/random does not require CSRF', async ({ request }) => {
    // This endpoint might return 200 or 404 depending on whether questions exist
    // Either way, it should NOT return 403 (CSRF)
    const res = await request.post('/api/challenge/random', { data: {} });
    expect(res.status()).not.toBe(403);
  });

  test('POST /api/challenge/verify does not require CSRF', async ({ request }) => {
    const res = await request.post('/api/challenge/verify', {
      data: { id: 1, answer: 'wrong' }
    });
    expect(res.status()).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────
// CSRF cookie is set on all responses
// ─────────────────────────────────────────────────────────────
test.describe('CSRF cookie behavior', () => {
  test('csrf_token cookie is set on initial request', async ({ request }) => {
    await request.get('/api/health');
    const state = await request.storageState();
    const csrfCookie = state.cookies.find(c => c.name === 'csrf_token');
    expect(csrfCookie).toBeTruthy();
    expect(csrfCookie.httpOnly).toBe(false); // Must be readable by JS
    expect(csrfCookie.value.length).toBeGreaterThan(0);
  });

  test('GET /api/csrf-token returns token in body', async ({ request }) => {
    const res = await request.get('/api/csrf-token');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('csrf_token');
    expect(typeof body.csrf_token).toBe('string');
    expect(body.csrf_token.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// IP Ban CRUD
// ─────────────────────────────────────────────────────────────
test.describe('IP ban management — CRUD contract', () => {
  let adminCookieHeader;
  let adminCsrfToken;
  const createdBanIds = [];

  test.beforeAll(async ({ request }) => {
    adminCookieHeader = await getAdminCookieHeader(request);
    // Get CSRF token for admin state-changing requests
    const state = await request.storageState();
    adminCsrfToken = state.cookies.find(c => c.name === 'csrf_token')?.value;
  });

  /** Helper: admin request with CSRF */
  async function adminReq(request, method, url, data) {
    const opts = {
      headers: { cookie: adminCookieHeader, 'X-CSRF-Token': adminCsrfToken }
    };
    if (data) opts.data = data;
    return request[method](url, opts);
  }

  // Cleanup any created bans after all tests
  test.afterAll(async ({ request }) => {
    for (const id of createdBanIds) {
      try {
        await adminReq(request, 'delete', `/api/admin/ip-bans/${id}`);
      } catch { /* ignore cleanup errors */ }
    }
  });

  test('GET /api/admin/ip-bans requires admin auth', async ({ request }) => {
    const res = await request.get('/api/admin/ip-bans');
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/ip-bans returns paginated list', async ({ request }) => {
    const res = await request.get('/api/admin/ip-bans', {
      headers: { cookie: adminCookieHeader }
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('bans');
    expect(Array.isArray(body.bans)).toBe(true);
    expect(body).toHaveProperty('pagination');
    expect(body.pagination).toHaveProperty('page');
    expect(body.pagination).toHaveProperty('total');
    expect(body.pagination).toHaveProperty('totalPages');
  });

  test('POST /api/admin/ip-bans creates exact IP ban', async ({ request }) => {
    const res = await adminReq(request, 'post', '/api/admin/ip-bans', {
      ip: '203.0.113.50',
      reason: 'Contract test ban',
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('id');
    createdBanIds.push(body.id);
  });

  test('POST /api/admin/ip-bans creates CIDR ban', async ({ request }) => {
    const res = await adminReq(request, 'post', '/api/admin/ip-bans', {
      ip: '198.51.100.0',
      cidr_prefix: 24,
      reason: 'Contract test CIDR ban',
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('id');
    createdBanIds.push(body.id);
  });

  test('POST /api/admin/ip-bans rejects invalid IP format', async ({ request }) => {
    const res = await adminReq(request, 'post', '/api/admin/ip-bans', {
      ip: 'not-a-valid-ip',
      reason: 'Should fail',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('IP');
  });

  test('POST /api/admin/ip-bans rejects invalid CIDR prefix', async ({ request }) => {
    const res = await adminReq(request, 'post', '/api/admin/ip-bans', {
      ip: '203.0.113.0',
      cidr_prefix: 99,
      reason: 'Should fail',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('PUT /api/admin/ip-bans/:id updates ban reason', async ({ request }) => {
    if (createdBanIds.length === 0) return;
    const banId = createdBanIds[0];

    const res = await adminReq(request, 'put', `/api/admin/ip-bans/${banId}`, {
      reason: 'Updated reason'
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('DELETE /api/admin/ip-bans/:id removes ban', async ({ request }) => {
    // Create a temporary ban to delete
    const createRes = await adminReq(request, 'post', '/api/admin/ip-bans', {
      ip: '192.0.2.100',
      reason: 'Temporary ban for delete test',
    });
    expect(createRes.ok()).toBeTruthy();
    const { id } = await createRes.json();

    const deleteRes = await adminReq(request, 'delete', `/api/admin/ip-bans/${id}`);
    expect(deleteRes.ok()).toBeTruthy();
    const body = await deleteRes.json();
    expect(body.success).toBe(true);

    // Verify it's gone — trying to delete again should 404
    const againRes = await adminReq(request, 'delete', `/api/admin/ip-bans/${id}`);
    expect(againRes.status()).toBe(404);
  });

  test('DELETE nonexistent ban returns 404', async ({ request }) => {
    const res = await adminReq(request, 'delete', '/api/admin/ip-bans/999999');
    expect(res.status()).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// Redirect URI validation in client management
// ─────────────────────────────────────────────────────────────
test.describe('Redirect URI rejection — client create and update', () => {
  let adminCookieHeader;
  let adminCsrfToken;
  const createdClientIds = [];

  test.beforeAll(async ({ request }) => {
    adminCookieHeader = await getAdminCookieHeader(request);

    // Get CSRF token for admin requests
    const state = await request.storageState();
    adminCsrfToken = state.cookies.find(c => c.name === 'csrf_token')?.value;
  });

  test.afterAll(async ({ request }) => {
    // Cleanup created clients
    for (const id of createdClientIds) {
      try {
        await request.delete(`/api/admin/clients/${id}`, {
          headers: {
            cookie: adminCookieHeader,
            'X-CSRF-Token': adminCsrfToken
          }
        });
      } catch { /* ignore */ }
    }
  });

  /** Helper: admin POST with CSRF */
  async function adminPost(request, url, data) {
    return request.post(url, {
      data,
      headers: {
        cookie: adminCookieHeader,
        'X-CSRF-Token': adminCsrfToken
      }
    });
  }

  /** Helper: admin PUT with CSRF */
  async function adminPut(request, url, data) {
    return request.put(url, {
      data,
      headers: {
        cookie: adminCookieHeader,
        'X-CSRF-Token': adminCsrfToken
      }
    });
  }

  test('rejects localhost redirect_uri on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test',
      redirect_uri: 'http://localhost:3000/callback'
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('内部网络');
  });

  test('rejects 127.0.0.1 redirect_uri on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test 2',
      redirect_uri: 'http://127.0.0.1:3000/callback'
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('内部网络');
  });

  test('rejects private IP 10.x redirect_uri on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test 3',
      redirect_uri: 'http://10.0.0.1/callback'
    });
    expect(res.status()).toBe(400);
  });

  test('rejects private IP 172.16.x redirect_uri on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test 4',
      redirect_uri: 'http://172.16.0.1/callback'
    });
    expect(res.status()).toBe(400);
  });

  test('rejects private IP 192.168.x redirect_uri on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test 5',
      redirect_uri: 'http://192.168.1.1/callback'
    });
    expect(res.status()).toBe(400);
  });

  test('rejects invalid URL format on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'Bad URL',
      redirect_uri: 'not-a-url'
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('格式不正确');
  });

  test('rejects non-http(s) protocol on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'FTP Test',
      redirect_uri: 'ftp://example.com/callback'
    });
    expect(res.status()).toBe(400);
  });

  test('accepts valid https redirect_uri on create', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'Valid Client',
      redirect_uri: 'https://example.com/callback'
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('client_id');
    expect(body).toHaveProperty('client_secret');
    createdClientIds.push(body.client_id);
  });

  test('rejects localhost redirect_uri on update', async ({ request }) => {
    // First create a valid client
    const createRes = await adminPost(request, '/api/admin/clients', {
      name: 'Update Test',
      redirect_uri: 'https://example.com/old-callback'
    });
    expect(createRes.status()).toBe(201);
    const { client_id } = await createRes.json();
    createdClientIds.push(client_id);

    // Now try to update with localhost
    // We need the numeric ID, not client_id. Let's list clients to find it.
    const listRes = await request.get('/api/admin/clients', {
      headers: { cookie: adminCookieHeader }
    });
    const listBody = await listRes.json();
    const client = listBody.clients.find(c => c.client_id === client_id);
    expect(client).toBeTruthy();

    const updateRes = await adminPut(request, `/api/admin/clients/${client.id}`, {
      name: 'Update Test',
      redirect_uri: 'http://localhost:3000/callback'
    });
    expect(updateRes.status()).toBe(400);
    const body = await updateRes.json();
    expect(body.message).toContain('内部网络');
  });

  test('rejects private IP redirect_uri on update', async ({ request }) => {
    // Create valid client
    const createRes = await adminPost(request, '/api/admin/clients', {
      name: 'Update Test 2',
      redirect_uri: 'https://example.com/callback'
    });
    const { client_id } = await createRes.json();
    createdClientIds.push(client_id);

    const listRes = await request.get('/api/admin/clients', {
      headers: { cookie: adminCookieHeader }
    });
    const listBody = await listRes.json();
    const client = listBody.clients.find(c => c.client_id === client_id);

    const updateRes = await adminPut(request, `/api/admin/clients/${client.id}`, {
      name: 'Update Test 2',
      redirect_uri: 'http://10.0.0.5/callback'
    });
    expect(updateRes.status()).toBe(400);
  });
});
