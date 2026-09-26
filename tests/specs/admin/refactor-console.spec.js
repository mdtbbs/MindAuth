import { test, expect } from '@playwright/test';

const ADMIN_SECRET = 'admin123';

async function clearRateLimits(request) {
  await request.post('/api/admin/test/clear-rate-limits', { data: { secret: ADMIN_SECRET } }).catch(() => {});
}

async function adminLogin(request) {
  await clearRateLimits(request);
  const response = await request.post('/api/admin/login', { data: { username: 'testadmin', password: 'AdminPass123' } });
  expect(response.status()).toBe(200);
}

async function csrf(request) {
  const response = await request.get('/api/csrf-token');
  return (await response.json()).csrf_token;
}

test.describe('Admin management refactor API', () => {
  test('Email Policy enforces CSRF, CRUD, generic rejection, suffix boundary and hit counts', async ({ request }) => {
    await adminLogin(request);
    const pattern = `policy-${Date.now()}.invalid`;
    const noCsrf = await request.post('/api/admin/email-policy', {
      data: { match_type: 'exact', pattern, policy: 'deny', reason: 'E2E policy test' },
    });
    expect(noCsrf.status()).toBe(403);

    const token = await csrf(request);
    const created = await request.post('/api/admin/email-policy', {
      headers: { 'X-CSRF-Token': token },
      data: { match_type: 'exact', pattern: `@${pattern.toUpperCase()}`, policy: 'deny', reason: 'E2E policy test' },
    });
    expect(created.status()).toBe(201);
    const ruleId = (await created.json()).id;

    const blocked = await request.post('/api/register/send-code', { data: { email: `blocked@${pattern}` } });
    expect(blocked.status()).toBe(400);
    expect(await blocked.json()).toEqual({ success: false, code: 'EMAIL_DOMAIN_BLOCKED', message: '暂不支持使用该邮箱' });

    const update = await request.put(`/api/admin/email-policy/${ruleId}`, {
      headers: { 'X-CSRF-Token': await csrf(request) },
      data: { match_type: 'suffix', pattern, policy: 'deny', reason: 'E2E suffix test', enabled: true },
    });
    expect(update.status()).toBe(200);
    const subdomain = await request.post('/api/register/send-code', { data: { email: `blocked@child.${pattern}` } });
    expect(subdomain.status()).toBe(400);
    const lookalike = await request.post('/api/register/send-code', { data: { email: `allowed@fake${pattern}` } });
    expect(lookalike.status()).toBe(200);

    let rule;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const list = await request.get(`/api/admin/email-policy?search=${encodeURIComponent(pattern)}`);
      rule = (await list.json()).rules.find(item => item.id === ruleId);
      if (Number(rule?.hit_count) >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(rule?.pattern).toBe(pattern);
    expect(Number(rule?.hit_count)).toBeGreaterThanOrEqual(2);

    const removed = await request.delete(`/api/admin/email-policy/${ruleId}`, { headers: { 'X-CSRF-Token': await csrf(request) } });
    expect(removed.status()).toBe(200);
  });

  test('OAuth client scope updates validate input and preserve the client response contract', async ({ request }) => {
    await adminLogin(request);
    const created = await request.post('/api/admin/clients', {
      headers: { 'X-CSRF-Token': await csrf(request) },
      data: { name: `Scope test ${Date.now()}`, redirect_uri: 'https://scope-test.example.com/callback', require_pkce: true },
    });
    expect(created.status()).toBe(201);
    const createdClient = await created.json();
    const clientsResponse = await request.get('/api/admin/clients');
    const client = (await clientsResponse.json()).clients.find(item => item.client_id === createdClient.client_id);
    expect(client).toBeTruthy();
    try {
      const badScopes = await request.put(`/api/admin/clients/${client.id}`, {
        headers: { 'X-CSRF-Token': await csrf(request) },
        data: { name: 'Invalid scope update', redirect_uri: 'https://scope-test.example.com/callback', scopes: [] },
      });
      expect(badScopes.status()).toBe(400);

      const updated = await request.put(`/api/admin/clients/${client.id}`, {
        headers: { 'X-CSRF-Token': await csrf(request) },
        data: {
          name: 'Scope test updated', redirect_uri: 'https://scope-test.example.com/callback', require_pkce: true,
          scopes: ['openid', 'profile', 'email', 'forum.read', 'resource.download'],
        },
      });
      expect(updated.status()).toBe(200);
      const listed = await request.get('/api/admin/clients');
      const stored = (await listed.json()).clients.find(item => item.id === client.id);
      expect(stored.approved_scopes).toEqual(['openid', 'profile', 'email', 'forum.read', 'resource.download']);
    } finally {
      if (client?.id) await request.delete(`/api/admin/clients/${client.id}`, { headers: { 'X-CSRF-Token': await csrf(request) } });
    }
  });
});

test('Admin SPA renders the operational routes on desktop and mobile layouts', async ({ page }) => {
  await page.goto('/admin');
  await page.getByPlaceholder('管理员用户名').fill('testadmin');
  await page.getByPlaceholder('管理员密码').fill('AdminPass123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('navigation', { name: '管理导航' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible();
  const userIdResponse = await page.request.post('/api/admin/test/get-user-id', {
    data: { secret: ADMIN_SECRET, username: 'testadmin' },
  });
  expect(userIdResponse.status()).toBe(200);
  const { user_id: adminUserId } = await userIdResponse.json();

  const routes = [
    ['/users', '用户'], [`/users/${adminUserId}`, 'testadmin'], ['/admins', '管理员'], ['/sessions', '会话与授权'],
    ['/risk', '风控中心'], ['/email-policy', '邮箱策略'], ['/ip-rules', 'IP 规则'],
    ['/applications', '应用申请'], ['/clients', 'OAuth 客户端管理'], ['/messaging', '邮件与短信'],
    ['/registration', '注册与认证'], ['/user-fields', '用户资料字段'], ['/appearance', '登录页外观'],
    ['/login-logs', '登录记录'], ['/admin-logs', '管理日志'], ['/sms-logs', '短信记录'],
  ];
  for (const [route, heading] of routes) {
    await page.goto(`/admin#${route}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 8000 });
  }

  if (await page.getByRole('button', { name: '菜单' }).isVisible()) {
    await page.getByRole('button', { name: '菜单' }).click();
    await expect(page.getByRole('navigation', { name: '管理导航' })).toBeVisible();
  }
});
