const { test, expect } = require('@playwright/test');

const ADMIN_SECRET = 'admin123';
const FORUM_CLIENT_ID = 'forum';
const FORUM_CALLBACK = 'http://localhost:4000/api/auth/callback';

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

test.describe('OAuth 登录后跳转回原页面', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('模拟论坛完整登录流程：登录后应跳转到回调地址（带 code）', async ({ page }) => {
    // Step 1: 先注册一个用户
    const testUser = `oauth_e2e_${Date.now()}`;
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', testUser);
    await page.fill('#email', `${testUser}@test.com`);
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await page.waitForSelector('#login-form', { timeout: 5000 });

    // Step 2: 模拟论坛登录按钮跳转（构造带 redirect 参数的 URL）
    const redirectUrl = encodeURIComponent(FORUM_CALLBACK);
    const state = encodeURIComponent('/');
    const loginUrl = `/login?redirect=${redirectUrl}&client_id=${FORUM_CLIENT_ID}&state=${state}`;

    // 导航到登录页（这会触发 302 重定向到 /#/login?redirect=...）
    await page.goto(loginUrl);
    await page.waitForSelector('#login-form', { timeout: 5000 });

    // Step 3: 验证 sessionStorage 正确存储了 redirect 参数
    const storedBefore = await page.evaluate(() => ({
      redirectUri: sessionStorage.getItem('oauth_redirect_uri'),
      clientId: sessionStorage.getItem('oauth_client_id'),
      state: sessionStorage.getItem('oauth_state')
    }));
    console.log('登录前 sessionStorage:', storedBefore);
    expect(storedBefore.redirectUri).toBe(FORUM_CALLBACK);
    expect(storedBefore.clientId).toBe(FORUM_CLIENT_ID);
    expect(storedBefore.state).toBe('/');

    // Step 4: 登录
    await page.fill('#username', testUser);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');

    // Step 5: 等待导航完成
    // 登录后应跳转到 /api/authorize，然后 302 到回调地址
    // 回调地址可能不可达，但 URL 应该离开 MindAuth 的 #dashboard
    await page.waitForURL(url => {
      const u = url.toString();
      // 不应该停在 #dashboard
      if (u.includes('#dashboard')) return false;
      // 应该跳转到回调地址（带 code 参数）或者离开 MindAuth
      return u.includes(FORUM_CALLBACK) || u.includes('code=') || !u.includes('localhost:4001');
    }, { timeout: 10000 }).catch(() => {
      // 如果超时，打印当前 URL 用于调试
      console.log('超时，当前 URL:', page.url());
    });

    const finalUrl = page.url();
    console.log('登录后最终 URL:', finalUrl);

    // 核心断言：不应该停在 #dashboard
    expect(finalUrl).not.toContain('#dashboard');

    // sessionStorage 应该已清空（参数使用后删除）
    const storedAfter = await page.evaluate(() => ({
      redirectUri: sessionStorage.getItem('oauth_redirect_uri'),
      clientId: sessionStorage.getItem('oauth_client_id'),
      state: sessionStorage.getItem('oauth_state')
    }));
    console.log('登录后 sessionStorage:', storedAfter);
    expect(storedAfter.redirectUri).toBeNull();
    expect(storedAfter.clientId).toBeNull();
    expect(storedAfter.state).toBeNull();

    // 如果回调地址可达，应该跳到了回调地址并带 code 参数
    if (finalUrl.startsWith(FORUM_CALLBACK)) {
      expect(finalUrl).toContain('code=');
      expect(finalUrl).toContain('state=');
      console.log('✅ 成功跳转到论坛回调地址');
    }
  });

  test('验证 sessionStorage 在登录前正确存储 redirect 参数', async ({ page }) => {
    // 注册
    const testUser = `session_test_${Date.now()}`;
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', testUser);
    await page.fill('#email', `${testUser}@test.com`);
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await page.waitForSelector('#login-form', { timeout: 5000 });

    // 构造带 redirect 参数的登录 URL
    const redirectUrl = encodeURIComponent(FORUM_CALLBACK);
    const loginUrl = `/login?redirect=${redirectUrl}&client_id=${FORUM_CLIENT_ID}&state=%2F`;

    // 导航到登录页
    await page.goto(loginUrl);
    await page.waitForSelector('#login-form', { timeout: 5000 });

    // 验证 sessionStorage 中已存储了 redirect 参数
    const stored = await page.evaluate(() => ({
      redirectUri: sessionStorage.getItem('oauth_redirect_uri'),
      clientId: sessionStorage.getItem('oauth_client_id'),
      state: sessionStorage.getItem('oauth_state')
    }));

    console.log('sessionStorage:', stored);

    expect(stored.redirectUri).toBe(FORUM_CALLBACK);
    expect(stored.clientId).toBe(FORUM_CLIENT_ID);
    expect(stored.state).toBe('/');
  });
});
