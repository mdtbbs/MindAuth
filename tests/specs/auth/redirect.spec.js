const { test, expect } = require('@playwright/test');

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

/** 通过注册页 UI 注册新用户（新 email-code 流程） */
async function registerViaUI(page, testUser) {
  await page.goto('/#register');
  await page.waitForSelector('#register-form', { timeout: 5000 });
  await page.fill('#username', testUser);
  await page.fill('#email', `${testUser}@test.com`);
  await page.fill('#password', 'TestPass123');
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
}

test.describe('已登录用户自动跳转', () => {
  test.beforeEach(async ({ context }) => {
    // 清除所有 cookies，确保测试开始时用户未登录
    await context.clearCookies();
  });

  test('已登录用户访问登录页应跳转到Dashboard', async ({ page }) => {
    // 注册（注册成功后自动登录并进入 dashboard）
    const testUser = `redirect_test_${Date.now()}`;
    await registerViaUI(page, testUser);

    await expect(page.locator('.toast', { hasText: '注册成功' }).first()).toBeVisible({ timeout: 5000 });
    await page.waitForURL('**/dashboard', { timeout: 5000 });

    // 现在访问登录页 - 应自动跳转回 dashboard
    await page.goto('/#login');
    await page.waitForURL('**/dashboard', { timeout: 5000 });

    expect(page.url()).toContain('/dashboard');
  });

  test('已登录用户访问首页应跳转到Dashboard', async ({ page }) => {
    const testUser = `redirect_home_${Date.now()}`;
    await registerViaUI(page, testUser);
    await page.waitForURL('**/dashboard', { timeout: 8000 });

    // 访问首页 - 已登录应跳转到 dashboard
    await page.goto('/');
    await page.waitForURL('**/dashboard', { timeout: 5000 });

    expect(page.url()).toContain('/dashboard');
  });

  test('已登录用户访问注册页应跳转到Dashboard', async ({ page }) => {
    const testUser = `redirect_reg_${Date.now()}`;
    await registerViaUI(page, testUser);
    await page.waitForURL('**/dashboard', { timeout: 8000 });

    // 访问注册页 - 已登录应跳转到 dashboard
    await page.goto('/#register');
    await page.waitForURL('**/dashboard', { timeout: 5000 });

    expect(page.url()).toContain('/dashboard');
  });

  test('未登录用户访问登录页应正常显示', async ({ page }) => {
    await page.goto('/#login');

    // 等待页面加载，应该停留在登录页（旧 hash 链接归一化为路径路由）
    await page.waitForSelector('.auth-shell', { timeout: 3000 });
    await page.waitForSelector('#login-form', { timeout: 3000 });

    // 验证在登录页
    expect(page.url()).toContain('/login');
    expect(await page.isVisible('#username')).toBe(true);
    expect(await page.isVisible('#password')).toBe(true);
  });
});