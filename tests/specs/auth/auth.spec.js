import { test, expect } from '@playwright/test';

const ADMIN_SECRET = 'admin123';

// ─── 共享工具 ────────────────────────────────────────────────────────────────

/** React ToastProvider 渲染 .toast-container > .toast（无 #toast 旧 id） */
function toastWith(page, text) {
  return page.locator('.toast', { hasText: text }).first();
}

/** 注册一个新用户；注册成功后应用会自动登录并跳转 /dashboard */
async function registerUser(page, prefix) {
  // 注册限流为 5/小时，本文件会注册多个用户，先清理限流计数
  await page.request.post('/api/admin/test/clear-rate-limits', {
    data: { secret: ADMIN_SECRET }
  }).catch(() => {});
  const username = `${prefix}_${Date.now()}`;
  await page.goto('/register');
  await page.waitForSelector('#register-form', { timeout: 5000 });
  await page.fill('#username', username);
  await page.fill('#email', `${username}@test.com`);
  await page.fill('#password', 'TestPass123');
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
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  return username;
}

/** 管理员登录（React 管理 SPA，表单无 id，用 placeholder 定位） */
async function adminLogin(page) {
  await page.goto('/admin');
  await page.getByPlaceholder('管理员用户名').fill('testadmin');
  await page.getByPlaceholder('管理员密码').fill('AdminPass123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForSelector('.admin-sidebar__brand-title', { timeout: 8000 });
}

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
    await page.goto('/register');

    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', 'pw_user_' + Date.now());
    await page.fill('#email', 'pw_' + Date.now() + '@test.com');
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

    await expect(toastWith(page, '注册成功')).toBeVisible({ timeout: 5000 });
    // 注册成功后自动登录进入 dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
  });

  test('错误密码登录失败', async ({ page }) => {
    await page.goto('/login');

    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', 'nonexistent_' + Date.now());
    await page.fill('#password', 'wrongpassword');
    await page.click('#login-form button[type="submit"]');

    await expect(toastWith(page, '用户名/邮箱或密码错误')).toBeVisible({ timeout: 5000 });
    // 表单内也应展示错误提示
    await expect(page.locator('.auth-form__alert')).toBeVisible();
  });

  test('未登录访问Dashboard被拦截', async ({ page }) => {
    await page.goto('/dashboard');

    // 未认证时 DashboardPage 重定向到登录页
    await page.waitForURL('**/login', { timeout: 5000 });
    await page.waitForSelector('#login-form', { timeout: 5000 });
  });
});

test.describe('完整登录流程', () => {
  test('注册并登录查看Dashboard', async ({ page }) => {
    const username = await registerUser(page, 'pw_full');

    // 退出登录，再手动登录一次验证登录流程
    await page.click('[data-testid="logout-btn"]');
    await page.waitForURL('**/login', { timeout: 5000 });

    await page.waitForSelector('#login-form', { timeout: 5000 });
    await page.fill('#username', username);
    await page.fill('#password', 'TestPass123');
    await page.click('#login-form button[type="submit"]');

    // dashboard 渲染并展示用户信息
    await page.waitForSelector('#username-display', { timeout: 10000 });
    await expect(page.locator('#username-display')).toContainText(username);
    await expect(page.locator('#verified-badge')).toBeVisible();
  });
});

test.describe('密码重置流程', () => {
  test('请求密码重置页面', async ({ page }) => {
    await page.goto('/reset-request');
    await page.waitForSelector('#reset-request-form', { timeout: 5000 });

    await page.fill('#reset-request-form input[name="email"]', 'test@test.com');
    await page.click('#reset-request-form button[type="submit"]');

    // 提交后页面切换为「已发送」状态
    await expect(page.getByText('重置邮件已发送')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('管理员后台', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test.afterEach(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test('管理员登录成功', async ({ page }) => {
    await expect(page.locator('.admin-sidebar__brand-title')).toContainText('MindAuth Admin');
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  });

  test('查看邮件配置', async ({ page }) => {
    await page.goto('/admin#/settings');
    await expect(page.getByPlaceholder('smtp.example.com')).toBeVisible({ timeout: 8000 });
    await expect(page.getByPlaceholder('SMTP 用户名')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存配置' })).toBeVisible();
  });

  test('创建新应用', async ({ page }) => {
    await page.goto('/admin#/clients');
    await page.getByRole('button', { name: '创建客户端' }).click({ timeout: 8000 });

    await page.getByPlaceholder('例如: MindFourm').fill('Playwright测试应用_' + Date.now());
    await page.getByPlaceholder('https://example.com/callback').fill('https://example.com/callback');
    await page.getByRole('button', { name: '创建', exact: true }).click();

    // 一次性 Secret 展示对话框
    await expect(page.getByText('客户端创建成功')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Client Secret', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '我已保存，关闭' }).click();
  });

  test('查看应用列表', async ({ page }) => {
    await page.goto('/admin#/clients');
    // 开发种子至少包含 forum 与 E2E 测试客户端
    await page.waitForSelector('table tbody tr', { timeout: 8000 });
    const clients = await page.locator('table tbody tr').count();
    expect(clients).toBeGreaterThan(0);
  });

  test('退出登录', async ({ page }) => {
    // 窄屏（mobile 项目）下侧栏折叠在「显示菜单」里
    const menuToggle = page.getByRole('button', { name: '显示菜单' });
    if (await menuToggle.isVisible().catch(() => false)) {
      await menuToggle.click();
    }
    await page.getByRole('button', { name: '退出登录' }).click();
    // 回到管理员登录表单
    await expect(page.getByPlaceholder('管理员用户名')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('邮箱验证状态', () => {
  test('完成邮箱验证码注册的新用户显示已验证状态', async ({ page }) => {
    await registerUser(page, 'pw_verify');

    // 注册流程已完成邮箱验证码校验，邮箱状态摘要卡应显示「已验证」。
    await expect(page.getByText('已验证', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#verified-badge')).toBeVisible();
  });
});

test.describe.serial('管理员用户管理', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin#/users');
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
  });

  test('查看用户列表', async ({ page }) => {
    // 列表分页展示（testadmin 可能不在第一页，用搜索用例单独覆盖）
    const users = await page.locator('table tbody tr').count();
    expect(users).toBeGreaterThan(0);
  });

  test('搜索用户', async ({ page }) => {
    await page.getByPlaceholder('搜索用户名或邮箱').fill('testadmin');
    await page.getByRole('button', { name: '搜索' }).click();
    await expect(page.locator('table tbody tr', { hasText: 'testadmin' }).first()).toBeVisible({ timeout: 8000 });
  });

  test('按角色筛选', async ({ page }) => {
    // 前面的用例注册过普通用户，按「普通用户」过滤应有结果
    await page.locator('select').first().selectOption('user');
    await page.getByRole('button', { name: '搜索' }).click();
    await page.waitForLoadState('networkidle');
    const users = await page.locator('table tbody tr').count();
    expect(users).toBeGreaterThan(0);
  });
});

test.describe('API端点测试', () => {
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
  });

  test('GET /api/me 未登录返回401', async ({ page }) => {
    const response = await page.request.get('/api/me');
    expect(response.status()).toBe(401);
  });

  test('POST /api/register 成功', async ({ page }) => {
    const email = 'api_' + Date.now() + '@test.com';
    const username = 'api_user_' + Date.now();
    const sendRes = await page.request.post('/api/register/send-code', {
      data: { email }
    });
    expect(sendRes.status()).toBe(200);
    const sendBody = await sendRes.json();
    expect(sendBody.code).toBeTruthy();

    const response = await page.request.post('/api/register', {
      data: {
        username,
        email,
        password: 'TestPass123',
        email_code: sendBody.code
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
    await page.goto('/account-settings');
    await page.waitForURL('**/login', { timeout: 5000 });
    await page.waitForSelector('#login-form', { timeout: 5000 });
  });

  test('登录后访问账户设置页面', async ({ page }) => {
    await registerUser(page, 'pw_account');

    await page.goto('/account-settings');
    // 账号与安全 tab：修改密码 + 修改邮箱（页头另有同名快捷按钮，需限定侧栏导航）
    await page.locator('.settings-nav__button', { hasText: '账号与安全' }).click({ timeout: 8000 });
    await expect(page.locator('#change-password-form')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#change-email-form')).toBeVisible();
    // 危险操作 tab：删除账户
    await page.locator('.settings-nav__button', { hasText: '危险操作' }).click();
    await expect(page.locator('[data-testid="delete-account-form"]')).toBeVisible({ timeout: 5000 });
  });

  test('修改密码功能', async ({ page }) => {
    await registerUser(page, 'pw_pwd');

    await page.goto('/account-settings');
    await page.locator('.settings-nav__button', { hasText: '账号与安全' }).click({ timeout: 8000 });
    await page.waitForSelector('#change-password-form', { timeout: 5000 });
    await page.fill('#old_password', 'TestPass123');
    await page.fill('#new_password', 'NewPass123');
    await page.click('#change-password-form button[type="submit"]');

    // 后端返回「密码已更新，请重新登录」并吊销全部会话
    await expect(toastWith(page, '密码已更新')).toBeVisible({ timeout: 5000 });
  });

  test('错误旧密码修改失败', async ({ page }) => {
    await registerUser(page, 'pw_pwd_err');

    await page.goto('/account-settings');
    await page.locator('.settings-nav__button', { hasText: '账号与安全' }).click({ timeout: 8000 });
    await page.waitForSelector('#change-password-form', { timeout: 5000 });
    await page.fill('#old_password', 'wrongpassword');
    await page.fill('#new_password', 'NewPass123');
    await page.click('#change-password-form button[type="submit"]');

    await expect(toastWith(page, '旧密码错误')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Dashboard日志和授权', () => {
  test('登录后显示登录记录', async ({ page }) => {
    await registerUser(page, 'pw_logs');

    // 注册时自动登录会产生一条 Web 登录记录
    await page.waitForSelector('#login-logs-container', { timeout: 8000 });
    const logs = await page.locator('.log-item').count();
    expect(logs).toBeGreaterThanOrEqual(1);
  });

  test('登录后显示授权应用', async ({ page }) => {
    await registerUser(page, 'pw_auth');

    await page.waitForSelector('#authorizations-container', { timeout: 8000 });
    const container = await page.locator('#authorizations-container').textContent();
    expect(container).toContain('暂无授权应用');
  });
});
