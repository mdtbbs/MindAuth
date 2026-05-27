import { test, expect } from '@playwright/test';

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

test.describe('用户认证流程', () => {
  test('注册新用户', async ({ page }) => {
    await page.goto('/#register');

    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', 'pw_user_' + Date.now());
    await page.fill('#email', 'pw_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('注册成功');
  });

  test('错误密码登录失败', async ({ page }) => {
    await page.goto('/#login');

    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', 'nonexistent_' + Date.now());
    await page.fill('#password', 'wrongpassword');
    await page.click('#login-form button[type="submit"]');

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('用户名或密码错误');
  });

  test('未登录访问Dashboard被拦截', async ({ page }) => {
    await page.goto('/#dashboard');

    await page.waitForSelector('#login-form', { timeout: 3000 });
    await expect(page.locator('#toast')).toBeVisible();
  });
});

test.describe('完整登录流程', () => {
  test('注册并登录查看Dashboard', async ({ page }) => {
    const username = 'pw_full_' + Date.now();

    // 注册
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#email', 'pw_full_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show');

    // 登录
    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');

    // 等待dashboard渲染
    await page.waitForSelector('#username-display', { timeout: 10000 });
    await expect(page.locator('#username-display')).toContainText(username);
    await expect(page.locator('#verified-badge')).toBeVisible();
  });
});

test.describe('密码重置流程', () => {
  test('请求密码重置页面', async ({ page }) => {
    await page.goto('/');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 通过hash导航
    await page.evaluate(() => location.hash = 'reset-request');
    await page.waitForSelector('#reset-request-form', { timeout: 5000 });

    await page.fill('#reset-request-form input[name="email"]', 'test@test.com');
    await page.click('#reset-request-form button[type="submit"]');

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toBeVisible();
  });
});

test.describe('管理员后台', () => {
  // Clear rate limits before this describe block to avoid admin login rate limiting
  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin.html');
    await page.waitForSelector('#admin-login-form', { timeout: 5000 });
    await page.fill('#username', 'testadmin');
    await page.fill('#password', 'AdminPass123');
    await page.click('#admin-login-form button[type="submit"]');
    await page.waitForSelector('#dashboard-view', { state: 'visible', timeout: 5000 });
  });

  // Clear rate limits after each test to prevent rate limiting between tests
  test.afterEach(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test('管理员登录成功', async ({ page }) => {
    await expect(page.locator('.dashboard-header h1')).toContainText('MindAuth Admin');
  });

  test('查看邮件配置', async ({ page }) => {
    await expect(page.locator('#email-config-form')).toBeVisible();
    await expect(page.locator('#smtp-host')).toBeVisible();
    await expect(page.locator('#smtp-port')).toBeVisible();
    await expect(page.locator('#smtp-user')).toBeVisible();
  });

  test('创建新应用', async ({ page }) => {
    // 使用evaluate直接执行onclick的逻辑
    await page.evaluate(() => {
      document.getElementById('create-client-form').style.display = 'flex';
    });
    await page.waitForTimeout(500);

    // 等待创建应用表单显示
    await page.waitForSelector('#create-client-form', { state: 'visible', timeout: 5000 });

    // 填写表单
    await page.fill('#name', 'Playwright测试应用_' + Date.now());
    await page.fill('#redirect_uri', 'http://localhost:3000/callback');
    await page.click('#create-client-form button[type="submit"]');

    await page.waitForSelector('#secret-display', { state: 'visible', timeout: 10000 });
    await expect(page.locator('#new-client-id')).toBeVisible();
    await expect(page.locator('#new-client-secret')).toBeVisible();

    // 关闭secret显示
    await page.click('#close-secret-btn');
  });

  test('查看应用列表', async ({ page }) => {
    await expect(page.locator('#clients-container')).toBeVisible();
    const clients = await page.locator('.client-card[data-id]').count();
    expect(clients).toBeGreaterThan(0);
  });

  test('退出登录', async ({ page }) => {
    // 使用JavaScript直接调用logout API并切换视图
    await page.evaluate(async () => {
      await apiFetch('/api/admin/logout', { method: 'POST' });
      showLoginView();
    });
    await page.waitForTimeout(1000);

    // 验证dashboard视图被隐藏
    await expect(page.locator('#dashboard-view')).toBeHidden();
    // 验证登录表单可见
    await expect(page.locator('#admin-login-form')).toBeVisible();
  });
});

test.describe('邮箱验证状态', () => {
  test('新用户显示未验证状态', async ({ page }) => {
    const username = 'pw_verify_' + Date.now();

    // 注册
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#email', 'pw_verify_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show');
    await page.waitForTimeout(1000);

    // 登录
    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');

    // 等待dashboard渲染（与成功的测试使用相同模式）
    await page.waitForSelector('#username-display', { timeout: 10000 });
    await expect(page.locator('#username-display')).toContainText(username);

    // 验证验证状态徽章显示
    await expect(page.locator('#verified-badge')).toBeVisible();
    // 新用户应该显示未验证状态（包含"未验证"文本或warn类）
    const badge = page.locator('#verified-badge');
    const badgeText = await badge.textContent();
    expect(badgeText).toContain('未验证');
  });
});

test.describe.serial('管理员用户管理', () => {
  // Clear rate limits before this describe block
  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin.html');
    await page.waitForSelector('#admin-login-form', { timeout: 5000 });
    await page.fill('#username', 'testadmin');
    await page.fill('#password', 'AdminPass123');
    await page.click('#admin-login-form button[type="submit"]');
    await page.waitForSelector('#dashboard-view', { state: 'visible', timeout: 5000 });

    // 等待页面完全加载（包括用户列表API调用）
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('查看用户列表', async ({ page }) => {
    // 等待用户容器加载
    await page.waitForSelector('#users-container', { timeout: 10000 });

    // 检查用户容器有内容（可能没有 .user-card 类）
    const usersContainer = page.locator('#users-container');
    await expect(usersContainer).not.toBeEmpty({ timeout: 10000 });

    // 检查有任何用户相关元素
    const userElements = await page.locator('#users-container > *').count();
    expect(userElements).toBeGreaterThan(0);
  });

  test('搜索用户', async ({ page }) => {
    // 用户渲染使用user-row类，不是user-card
    await page.waitForSelector('.user-row', { timeout: 10000 });
    await page.fill('#user-search', 'test');
    await page.click('#user-search-btn');
    await page.waitForLoadState('networkidle');

    const users = await page.locator('.user-row').count();
    expect(users).toBeGreaterThanOrEqual(1);
  });

  test('按角色筛选', async ({ page }) => {
    await page.waitForSelector('.user-row', { timeout: 10000 });
    await page.selectOption('#user-role-filter', 'admin');

    // Wait for the API response and re-render
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Wait for user rows to be updated (admin users should have .tag.admin)
    await page.waitForSelector('.tag.admin', { timeout: 5000 });

    const adminTags = await page.locator('.tag.admin').count();
    expect(adminTags).toBeGreaterThan(0);
  });
});

test.describe('API端点测试', () => {
  // Clear rate limits before this describe block
  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test('GET /api/health 健康检查', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.services.database).toContain('connected');
  });

  test('GET /api/me 未登录返回401', async ({ page }) => {
    const response = await page.request.get('/api/me');
    expect(response.status()).toBe(401);
  });

  test('POST /api/register 成功', async ({ page }) => {
    const response = await page.request.post('/api/register', {
      data: {
        username: 'api_user_' + Date.now(),
        email: 'api_' + Date.now() + '@test.com',
        password: 'TestPass123'
      }
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test('POST /api/admin/login 成功', async ({ page }) => {
    const response = await page.request.post('/api/admin/login', {
      data: {
        username: 'testadmin',
        password: 'AdminPass123'
      }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test('GET /api/admin/email-config 需认证', async ({ page }) => {
    const response = await page.request.get('/api/admin/email-config');
    expect(response.status()).toBe(401);
  });

  test('GET /api/admin/clients 需认证', async ({ page }) => {
    const response = await page.request.get('/api/admin/clients');
    expect(response.status()).toBe(401);
  });

  test('GET /api/admin/stats 需认证', async ({ page }) => {
    const response = await page.request.get('/api/admin/stats');
    expect(response.status()).toBe(401);
  });
});

test.describe.serial('账户自助功能', () => {
  test('访问账户设置页面需登录', async ({ page }) => {
    await page.goto('/#account-settings');
    await page.waitForSelector('#login-form', { timeout: 3000 });
    await expect(page.locator('#toast')).toBeVisible();
  });

  test('登录后访问账户设置页面', async ({ page }) => {
    const username = 'pw_account_' + Date.now();

    // 注册并登录
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#email', 'pw_account_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show');

    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#username-display', { timeout: 5000 });

    // 访问账户设置
    await page.goto('/#account-settings');
    await page.waitForSelector('.settings-card', { timeout: 5000 });

    // 验证三个设置卡片存在
    await expect(page.locator('#change-password-form')).toBeVisible();
    await expect(page.locator('#change-email-form')).toBeVisible();
    await expect(page.locator('#delete-account-form')).toBeVisible();
  });

  test('修改密码功能', async ({ page }) => {
    const username = 'pw_pwd_' + Date.now();

    // 注册
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#email', 'pw_pwd_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show');
    await page.waitForTimeout(500); // 等待toast消失

    // 登录
    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#username-display', { timeout: 5000 });
    await page.waitForTimeout(500);

    // 修改密码
    await page.goto('/#account-settings');
    await page.waitForSelector('#change-password-form', { timeout: 5000 });
    await page.fill('#old_password', 'TestPass123');
    await page.fill('#new_password', 'NewPass123');
    await page.click('#change-password-form button[type="submit"]');

    // 等待新的toast出现
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await page.waitForTimeout(500);

    const toast = await page.locator('#toast').textContent();
    expect(toast).toContain('密码已更新');
  });

  test('错误旧密码修改失败', async ({ page }) => {
    const username = 'pw_pwd_err_' + Date.now();

    // 注册并登录
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#email', 'pw_pwd_err_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show');
    await page.waitForTimeout(500);

    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#username-display', { timeout: 5000 });
    await page.waitForTimeout(500);

    // 尝试用错误旧密码修改
    await page.goto('/#account-settings');
    await page.waitForSelector('#change-password-form', { timeout: 5000 });
    await page.fill('#old_password', 'wrongpassword');
    await page.fill('#new_password', 'NewPass123');
    await page.click('#change-password-form button[type="submit"]');
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await page.waitForTimeout(500);

    const toast = await page.locator('#toast').textContent();
    expect(toast).toContain('旧密码错误');
  });
});

test.describe('Dashboard日志和授权', () => {
  test('登录后显示登录记录', async ({ page }) => {
    const username = 'pw_logs_' + Date.now();

    // 注册
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#email', 'pw_logs_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show');
    await page.waitForTimeout(500);

    // 登录
    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#username-display', { timeout: 5000 });

    // 等待登录日志加载
    await page.waitForSelector('#login-logs-container', { timeout: 5000 });
    await page.waitForTimeout(1000);

    // 应显示登录记录
    const logs = await page.locator('.log-item').count();
    expect(logs).toBeGreaterThanOrEqual(1);
  });

  test('登录后显示授权应用', async ({ page }) => {
    const username = 'pw_auth_' + Date.now();

    // 注册并登录
    await page.goto('/#register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#email', 'pw_auth_' + Date.now() + '@test.com');
    await page.fill('#password', 'TestPass123');
    await page.click('#register-form button[type="submit"]');
    await page.waitForSelector('#toast.show');
    await page.waitForTimeout(500);

    await page.goto('/#login');
    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector('#username-display', { timeout: 5000 });

    // 等待授权应用加载
    await page.waitForSelector('#authorizations-container', { timeout: 5000 });
    await page.waitForTimeout(1000);

    // 新用户应该暂无授权应用
    const container = await page.locator('#authorizations-container').textContent();
    expect(container).toContain('暂无授权应用');
  });
});