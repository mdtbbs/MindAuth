import { test, expect } from '@playwright/test';

const ADMIN_SECRET = 'admin123';

async function getCsrf(request) {
  const response = await request.get('/api/csrf-token');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).csrf_token;
}

async function registerAndLogin(request) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const username = `qq_contract_${suffix}`;
  const email = `${username}@test.com`;
  const password = 'TestPass123';
  const codeResponse = await request.post('/api/register/send-code', { data: { email } });
  expect(codeResponse.status()).toBe(200);
  const code = (await codeResponse.json()).code;
  expect(code).toMatch(/^\d{6}$/);
  const registerResponse = await request.post('/api/register', {
    data: { username, email, password, email_code: code },
  });
  expect(registerResponse.status()).toBe(201);
  const loginResponse = await request.post('/api/login', { data: { username, password } });
  expect(loginResponse.status()).toBe(200);
}

async function adminLogin(request) {
  const response = await request.post('/api/admin/login', {
    data: { username: 'testadmin', password: 'AdminPass123' },
  });
  expect(response.status()).toBe(200);
}

test.describe.serial('QQ custom account field contract', () => {
  let createdFieldId = null;

  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET },
    }).catch(() => {});
    await adminLogin(request);
    const listResponse = await request.get('/api/admin/user-fields');
    expect(listResponse.ok()).toBeTruthy();
    const fields = (await listResponse.json()).fields;
    if (fields.some((field) => field.field_key === 'qq')) return;

    const createResponse = await request.post('/api/admin/user-fields', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
      data: { field_key: 'qq', field_label: 'QQ 号', field_type: 'text', is_required: false, is_public: true },
    });
    expect(createResponse.status()).toBe(200);
    createdFieldId = (await createResponse.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (!createdFieldId) return;
    await adminLogin(request);
    await request.delete(`/api/admin/user-fields/${createdFieldId}`, {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
  });

  test('user can read and update the QQ field through account API', async ({ request }) => {
    await registerAndLogin(request);
    const fieldsResponse = await request.get('/api/account/fields');
    expect(fieldsResponse.ok()).toBeTruthy();
    expect((await fieldsResponse.json()).fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field_key: 'qq', field_label: 'QQ 号', field_type: 'text', value: null }),
    ]));

    const updateResponse = await request.put('/api/account/fields', {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
      data: { values: { qq: '123456789' } },
    });
    expect(updateResponse.status()).toBe(200);
    const refreshed = await request.get('/api/account/fields');
    expect((await refreshed.json()).fields.find((field) => field.field_key === 'qq').value).toBe('123456789');
  });

  test('account field update requires CSRF', async ({ request }) => {
    await registerAndLogin(request);
    const response = await request.put('/api/account/fields', { data: { values: { qq: '123' } } });
    expect(response.status()).toBe(403);
  });
});
