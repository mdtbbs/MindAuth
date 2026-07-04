import { test, expect } from '@playwright/test';

const ADMIN_SECRET = 'admin123';

async function adminLogin(request) {
  // Clear rate limits
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  } catch {}
  // Admin login (exempt from CSRF)
  await request.post('/api/admin/login', {
    data: { username: 'testadmin', password: 'AdminPass123' },
  });
}

async function getCsrf(request) {
  const res = await request.get('/api/csrf-token');
  const data = await res.json();
  return data.csrf_token || '';
}

async function registerAndLoginUser(request, prefix = 'e2e_user') {
  const suffix = Date.now() + '_' + Math.floor(Math.random() * 10000);
  const username = `${prefix}_${suffix}`;
  const password = 'TestPass123';
  const email = `${username}@test.com`;

  const registerRes = await request.post('/api/register', {
    data: { username, email, password },
  });
  expect(registerRes.status()).toBe(201);

  const loginRes = await request.post('/api/login', {
    data: { username, password },
  });
  expect(loginRes.status()).toBe(200);

  const meRes = await request.get('/api/me');
  const me = await meRes.json();
  expect(me.success).toBe(true);

  return { id: me.id, username, email, password };
}

// Run login before each test to ensure fresh auth
test.beforeEach(async ({ request }) => {
  await adminLogin(request);
});

test.describe('Admin API - Audit Logs', () => {
  test('GET /api/admin/audit-logs returns list', async ({ request }) => {
    const res = await request.get('/api/admin/audit-logs');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('logs');
    expect(Array.isArray(data.logs)).toBe(true);
  });

  test('GET /api/admin/audit-logs supports pagination', async ({ request }) => {
    const res = await request.get('/api/admin/audit-logs?page=1&limit=10');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.pagination).toBeDefined();
    expect(data.pagination.page).toBe(1);
  });

  test('GET /api/admin/audit-logs supports action filter', async ({ request }) => {
    const res = await request.get('/api/admin/audit-logs?action=user.ban');
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

test.describe('Admin API - SMS Audit Logs', () => {
  test('GET /api/admin/sms-audit-logs returns list', async ({ request }) => {
    const res = await request.get('/api/admin/sms-audit-logs');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('logs');
    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.pagination).toBeDefined();
  });

  test('GET /api/admin/sms-audit-logs supports filters', async ({ request }) => {
    const res = await request.get('/api/admin/sms-audit-logs?page=1&limit=10&action=send_code&success=1&phone_last4=8000');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.pagination.page).toBe(1);
  });

  test('GET /api/admin/sms-audit-logs rejects invalid phone suffix', async ({ request }) => {
    const res = await request.get('/api/admin/sms-audit-logs?phone_last4=abcd');
    expect(res.status()).toBe(400);
  });
});

test.describe('Admin API - SMS Config', () => {
  test('GET /api/admin/sms-config returns masked config', async ({ request }) => {
    const res = await request.get('/api/admin/sms-config');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.config).toBeDefined();
    expect(data.config).toHaveProperty('has_access_key_secret');
    expect(data.config).not.toHaveProperty('access_key_secret');
  });

  test('PUT /api/admin/sms-config saves config without echoing secret', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.put('/api/admin/sms-config', {
      headers: { 'X-CSRF-Token': csrf },
      data: {
        enabled: false,
        access_key_id: 'test-access-key',
        access_key_secret: 'test-secret',
        sign_name: 'MindProject',
        template_code: 'SMS_TEST_001'
      }
    });
    const data = await res.json();
    expect(data.success).toBe(true);

    const getRes = await request.get('/api/admin/sms-config');
    const getData = await getRes.json();
    expect(getData.success).toBe(true);
    expect(getData.config.access_key_id).toBe('test-access-key');
    expect(getData.config.sign_name).toBe('MindProject');
    expect(getData.config.template_code).toBe('SMS_TEST_001');
    expect(getData.config.has_access_key_secret).toBe(true);
    expect(getData.config).not.toHaveProperty('access_key_secret');
  });

  test('POST /api/admin/test-sms rejects invalid phone', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.post('/api/admin/test-sms', {
      headers: { 'X-CSRF-Token': csrf },
      data: { phone: '12345' }
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('Admin API - IP Bans', () => {
  let banId = null;

  test('POST creates ban', async ({ request }) => {
    const csrf = await getCsrf(request);
    const uniqueIp = '192.0.2.' + (Date.now() % 255);
    const res = await request.post('/api/admin/ip-bans', {
      data: { ip: uniqueIp, reason: 'E2E test ban' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();
    // Clean up
    if (data.id) {
      const delCsrf = await getCsrf(request);
      await request.delete(`/api/admin/ip-bans/${data.id}`, { headers: { 'X-CSRF-Token': delCsrf } });
    }
  });

  test('GET lists bans', async ({ request }) => {
    const res = await request.get('/api/admin/ip-bans');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.bans).toBeDefined();
    expect(data.pagination).toBeDefined();
  });

  test('POST rejects invalid IP', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.post('/api/admin/ip-bans', {
      data: { ip: 'not-an-ip', reason: 'invalid' },
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(res.status()).toBe(400);
  });

  test('POST accepts CIDR prefix and cleans up', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.post('/api/admin/ip-bans', {
      data: { ip: '198.51.100.0', cidr_prefix: 24, reason: 'CIDR test' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    if (data.id) {
      const delCsrf = await getCsrf(request);
      await request.delete(`/api/admin/ip-bans/${data.id}`, { headers: { 'X-CSRF-Token': delCsrf } });
    }
  });

  test('DELETE removes ban', async ({ request }) => {
    // Create a ban first (since banId might not carry across tests)
    const csrf = await getCsrf(request);
    const createRes = await request.post('/api/admin/ip-bans', {
      data: { ip: '203.0.113.50', reason: 'temp' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const createData = await createRes.json();
    if (!createData.id) return;

    const delCsrf = await getCsrf(request);
    const res = await request.delete(`/api/admin/ip-bans/${createData.id}`, { headers: { 'X-CSRF-Token': delCsrf } });
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

test.describe('Admin API - Challenge Questions', () => {
  test('POST creates question', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.post('/api/admin/challenges', {
      data: { question: 'E2E: 1+1=?', answer: '2' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();
    // Clean up
    const delCsrf = await getCsrf(request);
    await request.delete(`/api/admin/challenges/${data.id}`, { headers: { 'X-CSRF-Token': delCsrf } });
  });

  test('GET lists questions without answer_hash', async ({ request }) => {
    const res = await request.get('/api/admin/challenges');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.challenges)).toBe(true);
    for (const q of data.challenges) {
      expect(q).not.toHaveProperty('answer_hash');
    }
  });

  test('PUT + PATCH + DELETE lifecycle', async ({ request }) => {
    const csrf = await getCsrf(request);
    // Create
    const createRes = await request.post('/api/admin/challenges', {
      data: { question: 'Lifecycle Q', answer: 'ans' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const { id } = await createRes.json();
    expect(id).toBeDefined();

    // Update
    const putCsrf = await getCsrf(request);
    const putRes = await request.put(`/api/admin/challenges/${id}`, {
      data: { question: 'Updated Q' },
      headers: { 'X-CSRF-Token': putCsrf },
    });
    expect((await putRes.json()).success).toBe(true);

    // Toggle
    const patchCsrf = await getCsrf(request);
    const patchRes = await request.patch(`/api/admin/challenges/${id}/toggle`, {
      data: { enabled: false },
      headers: { 'X-CSRF-Token': patchCsrf },
    });
    expect((await patchRes.json()).success).toBe(true);

    // Delete
    const delCsrf = await getCsrf(request);
    const delRes = await request.delete(`/api/admin/challenges/${id}`, { headers: { 'X-CSRF-Token': delCsrf } });
    expect((await delRes.json()).success).toBe(true);
  });
});

test.describe('Admin API - User Fields', () => {
  test('POST creates field', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.post('/api/admin/user-fields', {
      data: { field_key: 'e2e_test_' + Date.now(), field_label: 'E2E Field', field_type: 'text' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();
    // Clean up
    const delCsrf = await getCsrf(request);
    await request.delete(`/api/admin/user-fields/${data.id}`, { headers: { 'X-CSRF-Token': delCsrf } });
  });

  test('GET lists fields', async ({ request }) => {
    const res = await request.get('/api/admin/user-fields');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(Array.isArray(data.fields)).toBe(true);
  });

  test('POST rejects invalid field_key', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.post('/api/admin/user-fields', {
      data: { field_key: 'INVALID!', field_label: 'Bad' },
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(res.status()).toBe(400);
  });

  test('POST rejects invalid field_type', async ({ request }) => {
    const csrf = await getCsrf(request);
    const res = await request.post('/api/admin/user-fields', {
      data: { field_key: 'e2e_badtype', field_label: 'Bad', field_type: 'nope' },
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(res.status()).toBe(400);
  });

  test('Full lifecycle: create + sort + delete', async ({ request }) => {
    const csrf = await getCsrf(request);
    const createRes = await request.post('/api/admin/user-fields', {
      data: { field_key: 'e2e_lifecycle_' + Date.now(), field_label: 'Lifecycle' },
      headers: { 'X-CSRF-Token': csrf },
    });
    const { id } = await createRes.json();
    expect(id).toBeDefined();

    // Sort
    const sortCsrf = await getCsrf(request);
    const sortRes = await request.patch('/api/admin/user-fields/sort', {
      data: { orders: [{ id, sort_order: 50 }] },
      headers: { 'X-CSRF-Token': sortCsrf },
    });
    expect((await sortRes.json()).success).toBe(true);

    // Delete
    const delCsrf = await getCsrf(request);
    const delRes = await request.delete(`/api/admin/user-fields/${id}`, { headers: { 'X-CSRF-Token': delCsrf } });
    expect((await delRes.json()).success).toBe(true);
  });
});

test.describe('Public API - Challenge', () => {
  test('GET /api/challenge/random works without auth', async ({ request }) => {
    const res = await request.get('/api/challenge/random');
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

test.describe('User API - Auth required', () => {
  test('GET /api/sessions returns 401 without user session', async ({ request }) => {
    const res = await request.get('/api/sessions');
    expect(res.status()).toBe(401);
  });

  test('GET /api/notifications returns 401 without user session', async ({ request }) => {
    const res = await request.get('/api/notifications');
    expect(res.status()).toBe(401);
  });

  test('GET /api/notifications/unread-count returns 401', async ({ request }) => {
    const res = await request.get('/api/notifications/unread-count');
    expect(res.status()).toBe(401);
  });
});

test.describe('Admin API - User Detail and Errors', () => {
  test('GET /api/admin/users/:id returns detail collections', async ({ request }) => {
    const usersRes = await request.get('/api/admin/users?search=testadmin');
    const usersData = await usersRes.json();
    expect(usersData.success).toBe(true);
    const admin = usersData.users.find((user) => user.username === 'testadmin');
    expect(admin).toBeDefined();

    const detailRes = await request.get(`/api/admin/users/${admin.id}`);
    const detailData = await detailRes.json();
    expect(detailData.success).toBe(true);
    expect(detailData.user.username).toBe('testadmin');
    expect(Array.isArray(detailData.authorizations)).toBe(true);
    expect(Array.isArray(detailData.login_logs)).toBe(true);
    expect(Array.isArray(detailData.sms_logs)).toBe(true);
    expect(Array.isArray(detailData.notifications)).toBe(true);
    expect(Array.isArray(detailData.audit_logs)).toBe(true);
    expect(Array.isArray(detailData.sessions)).toBe(true);
  });

  test('unknown API route returns JSON 404', async ({ request }) => {
    const res = await request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.code).toBe('NOT_FOUND');
  });

  test('non-super admin cannot grant super admin role', async ({ request }) => {
    const delegatedAdmin = await registerAndLoginUser(request, 'delegated_admin');
    const targetUser = await registerAndLoginUser(request, 'target_user');

    await adminLogin(request);
    const csrf = await getCsrf(request);
    const promoteRes = await request.put(`/api/admin/users/${delegatedAdmin.id}`, {
      headers: { 'X-CSRF-Token': csrf },
      data: { role: 'user_admin' },
    });
    expect((await promoteRes.json()).success).toBe(true);

    await request.post('/api/admin/logout', { headers: { 'X-CSRF-Token': await getCsrf(request) } });
    const loginDelegatedRes = await request.post('/api/admin/login', {
      data: { username: delegatedAdmin.username, password: delegatedAdmin.password },
    });
    expect(loginDelegatedRes.status()).toBe(200);

    const delegatedCsrf = await getCsrf(request);
    const escalationRes = await request.put(`/api/admin/users/${targetUser.id}`, {
      headers: { 'X-CSRF-Token': delegatedCsrf },
      data: { role: 'super_admin' },
    });
    expect(escalationRes.status()).toBe(403);
    const escalationData = await escalationRes.json();
    expect(escalationData.success).toBe(false);
  });

  test('PATCH requests require CSRF token', async ({ request }) => {
    const res = await request.patch('/api/admin/user-fields/sort', {
      data: { orders: [] },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('User API - Notification lifecycle', () => {
  test('user can read unread count, mark notification read, and delete it', async ({ request }) => {
    const user = await registerAndLoginUser(request, 'notify_user');

    await adminLogin(request);
    const adminCsrf = await getCsrf(request);
    const banRes = await request.post(`/api/admin/users/${user.id}/ban`, {
      headers: { 'X-CSRF-Token': adminCsrf },
      data: { reason: 'E2E notification test', duration: '24h' },
    });
    expect((await banRes.json()).success).toBe(true);

    const listRes = await request.get('/api/notifications');
    const listData = await listRes.json();
    expect(listData.success).toBe(true);
    const notification = listData.notifications.find((item) => item.type === 'account_banned');
    expect(notification).toBeDefined();
    expect(notification.is_read === 0 || notification.is_read === false).toBe(true);

    const countRes = await request.get('/api/notifications/unread-count');
    const countData = await countRes.json();
    expect(countData.success).toBe(true);
    expect(countData.count).toBeGreaterThanOrEqual(1);

    const userCsrf = await getCsrf(request);
    const readRes = await request.patch(`/api/notifications/${notification.id}/read`, {
      headers: { 'X-CSRF-Token': userCsrf },
    });
    expect((await readRes.json()).success).toBe(true);

    const deleteRes = await request.delete(`/api/notifications/${notification.id}`, {
      headers: { 'X-CSRF-Token': await getCsrf(request) },
    });
    expect((await deleteRes.json()).success).toBe(true);

    const afterDeleteRes = await request.get('/api/notifications');
    const afterDeleteData = await afterDeleteRes.json();
    expect(afterDeleteData.notifications.some((item) => item.id === notification.id)).toBe(false);
  });
});

test.describe('Error pages', () => {
  test('oauth error page renders mapped message', async ({ page }) => {
    await page.goto('/oauth-error.html?error=invalid_client');
    await expect(page.locator('#error-title')).toHaveText('应用不存在');
    await expect(page.locator('#error-code')).toHaveText('INVALID_CLIENT');
  });

  test('generic error page renders 404 state', async ({ page }) => {
    await page.goto('/error.html?code=404');
    await expect(page.locator('#error-title')).toHaveText('页面不存在');
    await expect(page.locator('#error-code')).toHaveText('404');
  });
});
