import { test, expect } from '@playwright/test';

const CLIENT_ID = '6d875cc521f1c60ba17dd53c7b9edc5a';
const CLIENT_SECRET = '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1';
// Must exactly match the redirect_uri registered by src/db/seeds/testSeeds.js
const REDIRECT_URI = 'http://localhost:4000/api/auth/callback';
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

    // Step 1: 注册用户（通过 React UI）
    // 注册限流为 5/小时，先清理限流计数
    await page.request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    }).catch(() => {});

    await page.goto('/register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', testUsername);
    await page.fill('#email', testEmail);
    await page.fill('#password', testPassword);
    // 新流程：先点击发送验证码（dev 模式自动回填），再提交
    await page.click('[data-testid="register-send-code"]');
    await page.waitForSelector('[data-testid="register-email-code"]', { timeout: 5000 });
    await page.waitForFunction(
      () => {
        const input = document.querySelector('[data-testid="register-email-code"]');
        return input && input.value.length === 6;
      },
      { timeout: 5000 }
    );
    await page.click('#register-form button[type="submit"]');

    // Step 2: 注册成功后应用自动登录并跳转 /dashboard —
    // 浏览器上下文保持 session cookie
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // 验证登录成功 - 检查 /api/me 返回用户信息
    const meResponse = await page.request.get('/api/me');
    expect(meResponse.ok()).toBeTruthy();
    const meData = await meResponse.json();
    expect(meData.success).toBe(true);
    expect(meData.username).toBe(testUsername);

    // Step 3: 访问 authorize 端点 - 使用 page.request 处理重定向
    const authorizeUrl = `/api/authorize?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&state=${encodeURIComponent('/')}`;

    // 使用 page.request 获取 authorize 响应（携带 session cookie）
    const authRes = await page.request.get(authorizeUrl, { maxRedirects: 0 });
    expect(authRes.status()).toBe(302);

    let location = new URL(authRes.headers()['location'], 'http://localhost');
    expect(location).toBeTruthy();
    if (location.pathname === '/authorize') {
      const csrf = await (await page.request.get('/api/csrf-token')).json();
      const consent = await page.request.post('/api/authorize/consent', {
        headers: { 'X-CSRF-Token': csrf.csrf_token || '' },
        data: {
          decision: 'approve', client_id: location.searchParams.get('client_id'),
          redirect_uri: location.searchParams.get('redirect_uri'), response_type: location.searchParams.get('response_type'),
          state: location.searchParams.get('state'), scope: location.searchParams.get('scope'),
          code_challenge: location.searchParams.get('code_challenge'), code_challenge_method: location.searchParams.get('code_challenge_method'),
        },
      });
      expect(consent.status()).toBe(200);
      const result = await consent.json();
      expect(result.success).toBe(true);
      location = new URL(result.redirect_to, 'http://localhost');
    }
    expect(location.searchParams.get('code')).toBeTruthy();

    // 提取授权码
    const authCode = location.searchParams.get('code');

    // Step 4: 用 code 交换 token（使用 page.request 保持认证上下文）
    const tokenRes = await page.request.post('/api/token', {
      data: {
        code: authCode,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
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
