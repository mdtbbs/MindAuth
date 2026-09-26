import { test, expect } from '@playwright/test';

// Seeded test client (src/db/seeds/testSeeds.js)
const CLIENT_ID = '6d875cc521f1c60ba17dd53c7b9edc5a';
const CLIENT_SECRET = '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1';
const REDIRECT_URI = 'http://localhost:4000/api/auth/callback';
const ADMIN_SECRET = 'admin123';

async function clearRateLimits(request) {
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET },
    });
  } catch {}
}

async function adminLogin(request) {
  await clearRateLimits(request);
  const res = await request.post('/api/admin/login', {
    data: { username: 'testadmin', password: 'AdminPass123' },
  });
  expect(res.status()).toBe(200);
}

async function getCsrf(request) {
  const res = await request.get('/api/csrf-token');
  const data = await res.json();
  return data.csrf_token || '';
}

async function registerAndLoginUser(request, prefix) {
  const username = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const password = 'TestPass123';
  const email = `${username}@test.com`;

  const sendRes = await request.post('/api/register/send-code', {
    data: { email },
  });
  expect(sendRes.status()).toBe(200);
  const sendBody = await sendRes.json();

  const registerRes = await request.post('/api/register', {
    data: { username, email, password, email_code: sendBody.code },
  });
  expect(registerRes.status()).toBe(201);

  const loginRes = await request.post('/api/login', {
    data: { username, password },
  });
  expect(loginRes.status()).toBe(200);

  const me = await (await request.get('/api/me')).json();
  expect(me.success).toBe(true);
  return { id: me.id, username, password };
}

// Authorize with the session cookie in this request context and return the auth code
async function getAuthCode(request, clientId, redirectUri) {
  const authorizeUrl = `/api/authorize?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&state=${encodeURIComponent('/')}`;
  const authRes = await request.get(authorizeUrl, { maxRedirects: 0 });
  expect(authRes.status()).toBe(302);
  const location = new URL(authRes.headers()['location'], 'http://localhost');
  if (location.pathname === '/authorize') {
    const csrf = await getCsrf(request);
    const consentRes = await request.post('/api/authorize/consent', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        decision: 'approve', client_id: location.searchParams.get('client_id'),
        redirect_uri: location.searchParams.get('redirect_uri'), response_type: location.searchParams.get('response_type'),
        state: location.searchParams.get('state'), scope: location.searchParams.get('scope'),
        code_challenge: location.searchParams.get('code_challenge'), code_challenge_method: location.searchParams.get('code_challenge_method'),
      },
    });
    expect(consentRes.status()).toBe(200);
    const result = await consentRes.json();
    expect(result.success).toBe(true);
    const consentLocation = new URL(result.redirect_to, 'http://localhost');
    const consentCode = consentLocation.searchParams.get('code');
    expect(consentCode).toBeTruthy();
    return consentCode;
  }
  const code = location.searchParams.get('code');
  expect(code).toBeTruthy();
  return code;
}

test.beforeEach(async ({ request }) => {
  await clearRateLimits(request);
});

test.describe('Admin revoke authorization cascades token revocation', () => {
  test('after admin DELETE /authorizations/:id, refresh_token and access_token are dead', async ({ request }) => {
    const user = await registerAndLoginUser(request, 'revoke_user');

    // User completes OAuth flow with the seeded client
    const code = await getAuthCode(request, CLIENT_ID, REDIRECT_URI);
    const tokenRes = await request.post('/api/token', {
      data: {
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      },
    });
    expect(tokenRes.ok()).toBeTruthy();
    const tokenData = await tokenRes.json();
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.refresh_token).toBeTruthy();

    // Admin finds and revokes the authorization record
    await adminLogin(request);
    const listRes = await request.get(`/api/admin/authorizations?user_id=${user.id}`);
    const listData = await listRes.json();
    expect(listData.success).toBe(true);
    const authRecord = listData.authorizations.find(
      (a) => a.user_id === user.id && a.client_id === CLIENT_ID
    );
    expect(authRecord).toBeDefined();

    const delRes = await request.delete(`/api/admin/authorizations/${authRecord.id}`, {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
    expect((await delRes.json()).success).toBe(true);

    // Old refresh_token must now fail with invalid_grant
    await clearRateLimits(request);
    const refreshRes = await request.post('/api/refresh', {
      data: {
        refresh_token: tokenData.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
      },
    });
    expect(refreshRes.status()).toBe(401);
    const refreshData = await refreshRes.json();
    expect(refreshData.error).toBe('invalid_grant');

    // Old access_token must introspect as inactive
    const introspectRes = await request.post('/api/introspect', {
      data: {
        token: tokenData.access_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      },
    });
    const introspectData = await introspectRes.json();
    expect(introspectData.active).toBe(false);
  });

  test('DELETE /authorizations/:id returns 404 for unknown id', async ({ request }) => {
    await adminLogin(request);
    const res = await request.delete('/api/admin/authorizations/99999999', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('Admin client secret rotation', () => {
  test('rotate-secret invalidates old secret and returns working new secret', async ({ request }) => {
    await adminLogin(request);

    // Create a dedicated client so the seeded client used by other specs is untouched
    const redirectUri = 'https://example.com/oauth/callback';
    const createRes = await request.post('/api/admin/clients', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
      data: { name: 'Rotation E2E ' + Date.now(), redirect_uri: redirectUri },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.client_id).toBeTruthy();
    expect(created.client_secret).toBeTruthy();

    // Find numeric id for the rotate endpoint
    const clientsData = await (await request.get('/api/admin/clients')).json();
    const clientRow = clientsData.clients.find((c) => c.client_id === created.client_id);
    expect(clientRow).toBeDefined();

    // User authorizes the new client; original secret works for code exchange
    await registerAndLoginUser(request, 'rotate_user');
    const code1 = await getAuthCode(request, created.client_id, redirectUri);
    const token1Res = await request.post('/api/token', {
      data: {
        code: code1,
        client_id: created.client_id,
        client_secret: created.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
    });
    expect(token1Res.ok()).toBeTruthy();

    // Rotate the secret
    const rotateRes = await request.post(`/api/admin/clients/${clientRow.id}/rotate-secret`, {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
    expect(rotateRes.status()).toBe(200);
    const rotated = await rotateRes.json();
    expect(rotated.success).toBe(true);
    expect(rotated.client_id).toBe(created.client_id);
    expect(rotated.client_secret).toBeTruthy();
    expect(rotated.client_secret).not.toBe(created.client_secret);

    // Old secret must fail token exchange
    await clearRateLimits(request);
    const code2 = await getAuthCode(request, created.client_id, redirectUri);
    const oldSecretRes = await request.post('/api/token', {
      data: {
        code: code2,
        client_id: created.client_id,
        client_secret: created.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
    });
    expect(oldSecretRes.ok()).toBeFalsy();
    const oldSecretData = await oldSecretRes.json();
    expect(oldSecretData.error).toBe('invalid_client');

    // New secret must succeed
    const code3 = await getAuthCode(request, created.client_id, redirectUri);
    const newSecretRes = await request.post('/api/token', {
      data: {
        code: code3,
        client_id: created.client_id,
        client_secret: rotated.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
    });
    expect(newSecretRes.ok()).toBeTruthy();
    const newTokenData = await newSecretRes.json();
    expect(newTokenData.access_token).toBeTruthy();

    // Clean up: delete the throwaway client
    await request.delete(`/api/admin/clients/${clientRow.id}`, {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
  });

  test('rotate-secret returns 404 for unknown client', async ({ request }) => {
    await adminLogin(request);
    const res = await request.post('/api/admin/clients/99999999/rotate-secret', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('Admin IP bans accept IPv6', () => {
  test('creates an IPv6 CIDR ban visible in the list, then cleans up', async ({ request }) => {
    await adminLogin(request);

    const res = await request.post('/api/admin/ip-bans', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
      data: { ip: '2001:db8::', cidr_prefix: 32, reason: 'IPv6 E2E test' },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();

    const listData = await (await request.get('/api/admin/ip-bans?limit=100')).json();
    const ban = listData.bans.find((b) => b.id === data.id);
    expect(ban).toBeDefined();
    expect(ban.ip_address).toBe('2001:db8::');
    expect(ban.cidr_prefix).toBe(32);

    const delRes = await request.delete(`/api/admin/ip-bans/${data.id}`, {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
    expect((await delRes.json()).success).toBe(true);
  });

  test('creates a single-address IPv6 ban without prefix', async ({ request }) => {
    await adminLogin(request);
    const res = await request.post('/api/admin/ip-bans', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
      data: { ip: '2001:db8::dead:beef', reason: 'single IPv6' },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    if (data.id) {
      await request.delete(`/api/admin/ip-bans/${data.id}`, {
        headers: { 'X-CSRF-Token': await getCsrf(request) },
      });
    }
  });

  test('rejects out-of-range CIDR per family', async ({ request }) => {
    await adminLogin(request);

    // IPv6 prefix > 128
    const v6Res = await request.post('/api/admin/ip-bans', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
      data: { ip: '2001:db8::', cidr_prefix: 129 },
    });
    expect(v6Res.status()).toBe(400);

    // IPv4 prefix > 32 still rejected
    const v4Res = await request.post('/api/admin/ip-bans', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
      data: { ip: '192.0.2.0', cidr_prefix: 33 },
    });
    expect(v4Res.status()).toBe(400);
  });
});
