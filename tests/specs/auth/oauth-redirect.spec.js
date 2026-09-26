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

// React 版登录页通过 URL 参数（redirect_uri/client_id/state）保留 OAuth 上下文，
// 登录成功后跳转 /api/authorize 继续授权（旧版 sessionStorage 机制已移除）。
test.describe('OAuth 登录后跳转回原页面', () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    }).catch(() => {});
  });

  test('模拟论坛完整登录流程：登录后应跳转到回调地址（带 code）', async ({ page }) => {
    // Step 1: 通过 API 注册用户（避免注册页自动登录干扰未登录前提）
    const testUser = `oauth_e2e_${Date.now()}`;
    const testEmail = `${testUser}@test.com`;

    const sendCode = await page.request.post('/api/register/send-code', {
      data: { email: testEmail }
    });
    expect(sendCode.status()).toBe(200);
    const sendBody = await sendCode.json();

    const reg = await page.request.post('/api/register', {
      data: { username: testUser, email: testEmail, password: 'TestPass123', email_code: sendBody.code }
    });
    expect(reg.status()).toBe(201);

    // Step 2: 论坛式入口 —— 带 OAuth 参数打开登录页
    const loginUrl = `/login?redirect_uri=${encodeURIComponent(FORUM_CALLBACK)}&client_id=${FORUM_CLIENT_ID}&state=%2F`;
    await page.goto(loginUrl);
    await page.waitForSelector('#login-form', { timeout: 5000 });

    const loginResponsePromise = page.waitForResponse(response =>
      response.url().includes('/api/login') && response.request().method() === 'POST',
      { timeout: 20000 }
    );
    const authorizeRequestPromise = page.waitForRequest(request =>
      request.url().includes('/api/authorize?'),
      { timeout: 20000 }
    );
    const callbackRequestPromise = page.waitForRequest(request =>
      request.url().startsWith(FORUM_CALLBACK) && request.url().includes('code='),
      { timeout: 20000 }
    );

    // Step 3: 登录
    await page.fill('#username', testUser);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');

    const loginResponse = await loginResponsePromise;
    expect(loginResponse.ok()).toBe(true);

    // Step 4: 登录后应自动携带原始参数进入授权端点，并重定向到回调地址
    const authorizeRequest = await authorizeRequestPromise;
    expect(authorizeRequest.url()).toContain(`client_id=${FORUM_CLIENT_ID}`);

    // First-time grants now use an explicit consent page.
    await page.getByRole('button', { name: '允许' }).click();

    const callbackRequest = await callbackRequestPromise;
    const finalUrl = callbackRequest.url();
    expect(finalUrl).toContain('code=');
    expect(finalUrl).toContain('state=');
  });

  test('带 OAuth 参数的登录页应展示授权上下文并保留注册跳转参数', async ({ page }) => {
    const loginUrl = `/login?redirect_uri=${encodeURIComponent(FORUM_CALLBACK)}&client_id=${FORUM_CLIENT_ID}&client_name=${encodeURIComponent('MindFourm')}&state=%2F`;
    await page.goto(loginUrl);
    await page.waitForSelector('#login-form', { timeout: 5000 });

    // OAuth 上下文提示可见
    await expect(page.locator('.status-badge', { hasText: '正在连接应用' })).toBeVisible();

    // 「注册」链接应透传 OAuth 参数，注册后可继续授权
    const registerHref = await page.locator('.auth-panel__footer a', { hasText: '注册' }).getAttribute('href');
    expect(registerHref).toContain('/register?');
    expect(registerHref).toContain(`client_id=${FORUM_CLIENT_ID}`);
    expect(registerHref).toContain('redirect_uri=');
  });

  // MindFourm 历史上使用 `redirect` 作为参数名（非 OAuth 标准的 `redirect_uri`）。
  // MindAuth LoginPage/RegisterPage 已兼容两种名字，避免登录完停留在 MindAuth。
  test('登录页使用 `redirect` 参数名也能正确进入 OAuth 流程', async ({ page }) => {
    const testUser = `oauth_redir_${Date.now()}`;
    const testEmail = `${testUser}@test.com`;

    const sendCode = await page.request.post('/api/register/send-code', {
      data: { email: testEmail }
    });
    expect(sendCode.status()).toBe(200);
    const sendBody = await sendCode.json();

    const reg = await page.request.post('/api/register', {
      data: { username: testUser, email: testEmail, password: 'TestPass123', email_code: sendBody.code }
    });
    expect(reg.status()).toBe(201);

    // Note: uses `redirect=` instead of `redirect_uri=`
    const loginUrl = `/login?redirect=${encodeURIComponent(FORUM_CALLBACK)}&client_id=${FORUM_CLIENT_ID}&state=%2F`;
    await page.goto(loginUrl);
    await page.waitForSelector('#login-form', { timeout: 5000 });

    const callbackRequestPromise = page.waitForRequest(request =>
      request.url().startsWith(FORUM_CALLBACK) && request.url().includes('code='),
      { timeout: 20000 }
    );

    await page.fill('#username', testUser);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');

    await page.getByRole('button', { name: '允许' }).click();

    const callbackRequest = await callbackRequestPromise;
    const finalUrl = callbackRequest.url();
    expect(finalUrl).toContain('code=');
    expect(finalUrl).toContain('state=');
  });
});
