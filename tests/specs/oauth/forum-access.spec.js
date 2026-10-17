const { test, expect } = require('@playwright/test');
const { randomBytes, createHash } = require('node:crypto');

const redirectUri = 'https://forum-access-test.example/callback';
const password = 'AdminPass123';
async function csrf(request) {
  return (await (await request.get('/api/csrf-token')).json()).csrf_token;
}
async function write(request, method, url, data) {
  return request[method](url, { headers: { 'X-CSRF-Token': await csrf(request) }, data });
}
async function setup(page, forumAccess) {
  const request = page.request;
  await request.post('/api/admin/test/clear-rate-limits', { data: { secret: 'admin123' } });
  expect((await request.post('/api/admin/login', { data: { username: 'testadmin', password } })).status()).toBe(200);
  expect((await request.post('/api/login', { data: { username: 'testadmin', password } })).status()).toBe(200);
  const created = await write(request, 'post', '/api/developer/clients', {
    name: `Forum access ${Date.now()}`, description: 'OAuth two-level integration test',
    ecosystem: 'global', redirect_uris: [redirectUri], forum_access: forumAccess,
  });
  expect(created.status()).toBe(201);
  const app = (await created.json()).application;
  expect(app.status).toBe('pending');
  expect((await write(request, 'patch', `/api/admin/developer-applications/${app.id}/review`, { status: 'approved' })).status()).toBe(200);
  return app;
}
function authorizeRequest(app, scope) {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, params: {
    client_id: app.client_id, redirect_uri: redirectUri, response_type: 'code', state: randomBytes(24).toString('hex'),
    scope, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ui_locales: 'zh-CN',
  } };
}
async function consentAndExchange(request, auth) {
  const consent = await write(request, 'post', '/api/authorize/consent', { ...auth.params, decision: 'approve' });
  expect(consent.status()).toBe(200);
  const code = new URL((await consent.json()).redirect_to).searchParams.get('code');
  const token = await request.post('/api/token', { data: {
    grant_type: 'authorization_code', client_id: auth.params.client_id, redirect_uri: redirectUri, code, code_verifier: auth.verifier,
  } });
  expect(token.status()).toBe(200);
  return token.json();
}

test('sign-in-only application grants basic information and rejects all forum requests', async ({ page }, testInfo) => {
  const app = await setup(page, false);
  try {
    const auth = authorizeRequest(app, 'openid profile');
    await page.goto(`/authorize?${new URLSearchParams(auth.params)}`);
    await expect(page.getByText('允许此应用读取你的昵称、头像和账户标识。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '允许并继续' })).toBeVisible();
    await expect(page.locator('.public-scope-list, .oauth-scope-identifiers')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/mindauth-forum-access-${testInfo.project.name}-basic.png`, fullPage: true });
    const tokens = await consentAndExchange(page.request, auth);
    expect(tokens.scope).toBe('openid profile');
    const userinfo = await page.request.get('/api/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    expect(userinfo.status()).toBe(200);
    expect(await userinfo.json()).not.toHaveProperty('email');
    for (const scope of ['forum', 'forum.read', 'forum.write', 'multiplayer.write', 'game_content.saves.delete']) {
      const invalid = authorizeRequest(app, scope);
      const preview = await page.request.get(`/api/authorize/consent-info?${new URLSearchParams(invalid.params)}`);
      expect(preview.status()).toBe(400);
      expect((await preview.json()).error).toBe('invalid_scope');
    }
    await page.goto('/developer/new');
    await expect(page.getByRole('checkbox', { name: '接入论坛功能' })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(1);
  } finally {
    await write(page.request, 'delete', `/api/developer/clients/${app.id}`);
  }
});

test('forum application grants the complete group, keeps refresh narrow, and revokes tokens on downgrade', async ({ page }, testInfo) => {
  const app = await setup(page, true);
  try {
    // An identity-only login remains narrow even when the application supports forum access.
    const narrow = await consentAndExchange(page.request, authorizeRequest(app, 'openid profile'));
    const refreshed = await page.request.post('/api/token', { data: {
      grant_type: 'refresh_token', client_id: app.client_id, refresh_token: narrow.refresh_token,
    } });
    expect(refreshed.status()).toBe(200);
    expect((await refreshed.json()).scope).toBe('openid profile');
    const auth = authorizeRequest(app, 'profile forum.write');
    await page.goto(`/authorize?${new URLSearchParams(auth.params)}`);
    await expect(page.getByText('允许此应用读取基本资料，并以你的身份使用论坛功能，包括发帖、回复、资源、私信、云存档和联机。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '允许并继续' })).toBeVisible();
    await expect(page.locator('.public-scope-list, .public-scope-sensitive')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/mindauth-forum-access-${testInfo.project.name}-forum.png`, fullPage: true });
    const tokens = await consentAndExchange(page.request, auth);
    expect(tokens.scope.split(' ')).toEqual(expect.arrayContaining(['forum', 'forum.write', 'resource.upload', 'presence.write', 'multiplayer.write', 'game_content.saves.delete']));
    const publicApp = await (await page.request.get(`/api/public/apps/${app.client_id}`)).json();
    expect(publicApp.application).toMatchObject({ supports_presence: true, supports_multiplayer: true, forum_access: true });
    const outstanding = authorizeRequest(app, 'openid profile forum');
    const consent = await write(page.request, 'post', '/api/authorize/consent', { ...outstanding.params, decision: 'approve' });
    const outstandingCode = new URL((await consent.json()).redirect_to).searchParams.get('code');
    expect((await write(page.request, 'put', `/api/admin/clients/${app.id}`, {
      name: app.name || 'Downgraded app', redirect_uris: [redirectUri], forum_access: false, require_pkce: false,
    })).status()).toBe(200);
    expect((await page.request.get('/api/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status()).toBe(401);
    expect((await page.request.post('/api/token', { data: {
      grant_type: 'refresh_token', client_id: app.client_id, refresh_token: tokens.refresh_token,
    } })).status()).toBe(401);
    expect((await page.request.post('/api/token', { data: {
      grant_type: 'authorization_code', client_id: app.client_id, redirect_uri: redirectUri,
      code: outstandingCode, code_verifier: outstanding.verifier,
    } })).status()).toBe(401);
    const clients = (await (await page.request.get('/api/admin/clients')).json()).clients;
    expect(clients.find(client => client.id === app.id)).toMatchObject({ require_pkce: true, approved_scopes: ['openid', 'profile'] });
  } finally {
    await write(page.request, 'delete', `/api/developer/clients/${app.id}`);
  }
});

test('admin creates public and server-side web apps through the same form', async ({ page }, testInfo) => {
  const app = await setup(page, false);
  const managedIds = [];
  try {
    await page.goto('/admin#/clients');
    for (const clientType of ['public', 'confidential']) {
      await page.getByRole('button', { name: '创建客户端', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('combobox', { name: /^应用类型/ }).selectOption(clientType);
      await dialog.getByLabel('客户端名称', { exact: true }).fill(`Admin ${clientType} ${Date.now()}`);
      await dialog.getByLabel(/^回调地址/).fill(clientType === 'public' ? 'http://127.0.0.1:0/callback' : redirectUri);
      await dialog.getByRole('checkbox', { name: /接入论坛功能/ }).check();
      const pkce = dialog.getByRole('checkbox', { name: /PKCE/ });
      if (clientType === 'public') { await expect(pkce).toBeChecked(); await expect(pkce).toBeDisabled(); }
      else await expect(pkce).toBeEnabled();
      const [response] = await Promise.all([
        page.waitForResponse(res => res.url().endsWith('/api/admin/clients') && res.request().method() === 'POST'),
        dialog.getByRole('button', { name: '创建', exact: true }).click(),
      ]);
      expect(response.status()).toBe(201);
      const created = await response.json();
      if (clientType === 'public') {
        expect(created.client_secret).toBeNull();
        await expect(page.getByText('应用已创建。公开客户端无需密钥，登录时使用 PKCE。', { exact: true })).toBeVisible();
        await page.screenshot({ path: `/tmp/mindauth-admin-public-${testInfo.project.name}.png`, fullPage: false });
      } else expect(created.client_secret).toEqual(expect.any(String));
      const listed = (await (await page.request.get('/api/admin/clients')).json()).clients;
      const managed = listed.find(client => client.client_id === created.client_id);
      managedIds.push(managed.id);
      expect(managed).toMatchObject({ client_type: clientType, party_type: 'third_party', forum_access: true });
      await page.getByRole('button', { name: '我已保存，关闭', exact: true }).click();
    }
  } finally {
    for (const id of managedIds) await write(page.request, 'delete', `/api/admin/clients/${id}`);
    await write(page.request, 'delete', `/api/developer/clients/${app.id}`);
  }
});
