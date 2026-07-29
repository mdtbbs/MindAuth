const { test, expect } = require('@playwright/test');

const ADMIN_SECRET = 'admin123';
const FORUM_CLIENT_ID = 'forum';
const FORUM_CALLBACK = 'http://localhost:4000/api/auth/callback';

// GET /logout is an SLO endpoint — browser-initiated, cross-origin logout.
// It must:
//   - Revoke the MindAuth session (if any) idempotently
//   - Redirect to `redirect_uri` ONLY when it exactly matches the registered
//     value for the given `client_id`
//   - Silently redirect to /login for ANY validation failure (no open redirect)
test.describe('GET /logout (SLO endpoint)', () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    }).catch(() => {});
  });

  test('registered redirect_uri + client_id → redirect to callback', async ({ page }) => {
    const url = `/logout?redirect_uri=${encodeURIComponent(FORUM_CALLBACK)}&client_id=${FORUM_CLIENT_ID}`;
    const response = await page.goto(url, { waitUntil: 'commit' });

    // Express returns the 302 directly (no SPA interception).
    expect(response.status()).toBe(200);
    expect(page.url()).toBe(FORUM_CALLBACK + '/');
  });

  test('missing client_id → falls back to /login (no open redirect)', async ({ page }) => {
    const url = `/logout?redirect_uri=${encodeURIComponent(FORUM_CALLBACK)}`;
    const response = await page.goto(url, { waitUntil: 'commit' });

    expect(response.status()).toBe(200);
    const finalUrl = page.url();
    expect(finalUrl.endsWith('/login')).toBe(true);
  });

  test('missing redirect_uri → falls back to /login', async ({ page }) => {
    const url = `/logout?client_id=${FORUM_CLIENT_ID}`;
    const response = await page.goto(url, { waitUntil: 'commit' });

    expect(response.status()).toBe(200);
    const finalUrl = page.url();
    expect(finalUrl.endsWith('/login')).toBe(true);
  });

  test('unknown client_id → falls back to /login', async ({ page }) => {
    const url = `/logout?redirect_uri=${encodeURIComponent(FORUM_CALLBACK)}&client_id=does_not_exist`;
    const response = await page.goto(url, { waitUntil: 'commit' });

    expect(response.status()).toBe(200);
    const finalUrl = page.url();
    expect(finalUrl.endsWith('/login')).toBe(true);
  });

  test('redirect_uri not matching registered value → falls back to /login', async ({ page }) => {
    // Same client, but a DIFFERENT callback URL than what was registered.
    const url = `/logout?redirect_uri=${encodeURIComponent('http://localhost:4000/other/path')}&client_id=${FORUM_CLIENT_ID}`;
    const response = await page.goto(url, { waitUntil: 'commit' });

    expect(response.status()).toBe(200);
    const finalUrl = page.url();
    expect(finalUrl.endsWith('/login')).toBe(true);
  });

  test('redirect_uri pointing at an attacker origin → falls back to /login', async ({ page }) => {
    const url = `/logout?redirect_uri=${encodeURIComponent('https://evil.example.com/steal')}&client_id=${FORUM_CLIENT_ID}`;
    const response = await page.goto(url, { waitUntil: 'commit' });

    expect(response.status()).toBe(200);
    const finalUrl = page.url();
    expect(finalUrl.endsWith('/login')).toBe(true);
  });

  test('works when user has no active session (idempotent)', async ({ page }) => {
    // No session cookie — still a successful redirect to the registered URI.
    const url = `/logout?redirect_uri=${encodeURIComponent(FORUM_CALLBACK)}&client_id=${FORUM_CLIENT_ID}`;
    const response = await page.goto(url, { waitUntil: 'commit' });

    expect(response.status()).toBe(200);
    expect(page.url()).toBe(FORUM_CALLBACK + '/');
  });

  test('active session is revoked after GET /logout', async ({ page, request }) => {
    // 1. Create a fresh user and log in via the API to obtain a session cookie.
    const testUser = `slo_e2e_${Date.now()}`;
    const testEmail = `${testUser}@test.com`;

    const sendCode = await request.post('/api/register/send-code', {
      data: { email: testEmail }
    });
    expect(sendCode.status()).toBe(200);
    const sendBody = await sendCode.json();

    const reg = await request.post('/api/register', {
      data: { username: testUser, email: testEmail, password: 'TestPass123', email_code: sendBody.code }
    });
    expect(reg.status()).toBe(201);

    const login = await request.post('/api/login', {
      data: { username: testUser, password: 'TestPass123' }
    });
    expect(login.status()).toBe(200);
    const sessionCookie = login.headers()['set-cookie']
      ?.map((c) => c.split(';')[0])
      .find((c) => c.startsWith('session='));
    expect(sessionCookie).toBeTruthy();

    // 2. Sanity check: /api/me is reachable with the session cookie.
    const meBefore = await request.get('/api/me', {
      headers: { cookie: sessionCookie }
    });
    expect(meBefore.status()).toBe(200);

    // 3. Visit GET /logout in the browser (separate context from the API client)
    //    — since the browser has no session, this is a pure idempotency check on
    //    the redirect path. We assert the session revocation separately via /api/me
    //    on the same cookie (which is the point of the SLO flow).
    const url = `/logout?redirect_uri=${encodeURIComponent(FORUM_CALLBACK)}&client_id=${FORUM_CLIENT_ID}`;
    // Use a fresh context so we control cookies precisely.
    const ctx = await page.context().browser().newContext();
    try {
      const browserPage = await ctx.newPage();
      await browserPage.context().addCookies([{
        name: 'session',
        value: sessionCookie.split('=')[1],
        domain: 'localhost',
        path: '/'
      }]);
      const response = await browserPage.goto(url, { waitUntil: 'commit' });
      expect(response.status()).toBe(200);
      expect(browserPage.url()).toBe(FORUM_CALLBACK + '/');

      // 4. The same session cookie must now be rejected by /api/me.
      const meAfter = await request.get('/api/me', {
        headers: { cookie: sessionCookie }
      });
      expect([401, 403]).toContain(meAfter.status());
    } finally {
      await ctx.close();
    }
  });
});
