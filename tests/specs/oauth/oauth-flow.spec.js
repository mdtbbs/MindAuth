const { test, expect } = require('@playwright/test');

const CLIENT_ID = '6d875cc521f1c60ba17dd53c7b9edc5a';
const CLIENT_SECRET = '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1';
const ADMIN_SECRET = 'admin123';

// Clear rate limits before all tests
test.beforeAll(async ({ request }) => {
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  } catch (err) {
    // Ignore if endpoint doesn't exist
  }
});

test.describe('OAuth Authorization Code Flow', () => {
  test('完整OAuth授权流程', async ({ page }) => {
    const testUsername = 'oauth_' + Date.now();
    const testEmail = testUsername + '@test.com';
    const testPassword = 'TestPass123';

    // Step 1: 注册用户（通过 UI）
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', testUsername);
    await page.fill('#email', testEmail);
    await page.fill('#password', testPassword);
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show', { timeout: 5000 });

    // Step 2: 登录（通过 UI）- 浏览器上下文保持 session cookie
    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', testUsername);
    await page.fill('#password', testPassword);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('.auth-shell', { timeout: 5000 });

    // 验证登录成功 - 检查 /api/me 返回用户信息
    const meResponse = await page.request.get('/api/me');
    expect(meResponse.ok()).toBeTruthy();
    const meData = await meResponse.json();
    expect(meData.success).toBe(true);
    expect(meData.username).toBe(testUsername);

    // Step 3: 访问 authorize 端点 - 使用 page.request 处理重定向
    const redirectUri = encodeURIComponent('http://localhost:4500/api/auth/callback');
    const state = encodeURIComponent('/');
    const authorizeUrl = `/api/authorize?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;

    // 使用 page.request 获取 authorize 响应（携带 session cookie）
    const authRes = await page.request.get(authorizeUrl, { maxRedirects: 0 });
    expect(authRes.status()).toBe(302);

    const location = authRes.headers()['location'];
    expect(location).toBeTruthy();
    expect(location).toContain('code=');

    // 提取授权码
    const codeMatch = location.match(/code=([^&]+)/);
    expect(codeMatch).toBeTruthy();
    const authCode = codeMatch[1];

    // Step 4: 用 code 交换 token（使用 page.request 保持认证上下文）
    const tokenRes = await page.request.post('/api/token', {
      data: {
        code: authCode,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code'
      }
    });

    expect(tokenRes.ok()).toBeTruthy();
    const tokenData = await tokenRes.json();
    // OAuth 2.0 标准响应格式
    expect(tokenData.access_token).toBeTruthy();
    expect(tokenData.token_type).toBe('Bearer');
    expect(tokenData.refresh_token).toBeTruthy();
    expect(tokenData.expires_in).toBe(3600);

    // Step 5: 验证 access_token（使用 introspect 端点）
    const introspectRes = await page.request.post('/api/introspect', {
      data: {
        token: tokenData.access_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }
    });
    expect(introspectRes.ok()).toBeTruthy();
    const introspectData = await introspectRes.json();
    expect(introspectData.active).toBe(true);
    expect(introspectData.token_type).toBe('Bearer');

    // Step 6: 刷新 token
    const refreshRes = await page.request.post('/api/refresh', {
      data: {
        refresh_token: tokenData.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });
    expect(refreshRes.ok()).toBeTruthy();
    const refreshData = await refreshRes.json();
    expect(refreshData.access_token).toBeTruthy();
    expect(refreshData.token_type).toBe('Bearer');
  });

  test('API端点直接测试', async ({ request }) => {
    // 健康检查
    const healthRes = await request.get('/api/health');
    expect(healthRes.ok()).toBeTruthy();
    const healthData = await healthRes.json();
    expect(healthData.status).toBe('ok');

    // 无效token验证失败
    const invalidRes = await request.post('/api/verify', {
      data: { session_token: 'invalid-token' }
    });
    expect(invalidRes.status()).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// Redirect URI rejection (contract: SSRF protection)
// ─────────────────────────────────────────────────────────────
test.describe('Redirect URI rejection — admin client management', () => {
  let adminCookieHeader;
  let csrfToken;

  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
    const res = await request.post('/api/admin/login', {
      data: { username: 'testadmin', password: 'AdminPass123' }
    });
    expect(res.ok()).toBeTruthy();
    const state = await request.storageState();
    adminCookieHeader = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    csrfToken = state.cookies.find(c => c.name === 'csrf_token')?.value;
  });

  async function adminPost(request, url, data) {
    return request.post(url, {
      data,
      headers: { cookie: adminCookieHeader, 'X-CSRF-Token': csrfToken }
    });
  }

  test('rejects localhost redirect_uri on client creation', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test Localhost',
      redirect_uri: 'http://localhost:3000/callback'
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('内部网络');
  });

  test('rejects 127.0.0.1 redirect_uri on client creation', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test 127',
      redirect_uri: 'http://127.0.0.1:3000/callback'
    });
    expect(res.status()).toBe(400);
  });

  test('rejects private IP 192.168.x redirect_uri', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'SSRF Test Private',
      redirect_uri: 'http://192.168.1.1/callback'
    });
    expect(res.status()).toBe(400);
  });

  test('rejects invalid URL format redirect_uri', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'Bad URL',
      redirect_uri: 'not-a-valid-url'
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('格式不正确');
  });

  test('rejects non-http(s) protocol', async ({ request }) => {
    const res = await adminPost(request, '/api/admin/clients', {
      name: 'FTP Test',
      redirect_uri: 'ftp://example.com/callback'
    });
    expect(res.status()).toBe(400);
  });
});