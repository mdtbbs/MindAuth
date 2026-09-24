import { test, expect } from '@playwright/test';
import { registerUser } from '../../helpers/test-setup.js';

test('official Mindustry Mod logs in without CSRF, rotates tokens, reads minimal profile, and logs out', async ({ request }) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const username = `mod_${suffix}`;
  const email = `${username}@test.invalid`;
  const password = 'NativePass123';
  await registerUser(request, { username, email, password });
  const deviceId = '3f764e93-8d14-4a53-8c11-123456789abc';

  const spoofedClient = await request.post('/api/native/login', {
    data: { client_id: 'third-party', username, password, device_id: deviceId },
  });
  expect(spoofedClient.status()).toBe(401);
  expect((await spoofedClient.json()).code).toBe('INVALID_CLIENT');
  const wrongPassword = await request.post('/api/native/login', {
    data: { client_id: 'mdtbbs-mindustry-mod', username, password: 'wrong-password', device_id: deviceId },
  });
  expect(wrongPassword.status()).toBe(401);
  expect((await wrongPassword.json()).code).toBe('INVALID_CREDENTIALS');

  const loginResponse = await request.post('/api/native/login', {
    data: { client_id: 'mdtbbs-mindustry-mod', username: email.toUpperCase(), password, device_id: deviceId, device_name: 'Mindustry Linux' },
  });
  expect(loginResponse.status()).toBe(200);
  const login = await loginResponse.json();
  expect(login).toMatchObject({ success: true, token_type: 'Bearer', expires_in: 3600, scope: 'openid profile game_content' });
  expect(login.access_token).toBeTruthy();
  expect(login.refresh_token).toBeTruthy();

  const meResponse = await request.get('/api/native/me', { headers: { Authorization: `Bearer ${login.access_token}` } });
  expect(meResponse.status()).toBe(200);
  const me = await meResponse.json();
  expect(me.user).toMatchObject({ username, phone_verified: false, ban_status: 'none', is_muted: false });
  expect(me.user).not.toHaveProperty('email');
  expect(me.user).not.toHaveProperty('phone');

  const refreshResponse = await request.post('/api/native/refresh', {
    data: { client_id: 'mdtbbs-mindustry-mod', refresh_token: login.refresh_token, device_id: deviceId },
  });
  expect(refreshResponse.status()).toBe(200);
  const rotated = await refreshResponse.json();
  expect(rotated.refresh_token).not.toBe(login.refresh_token);
  expect(rotated.access_token).toBeTruthy();

  const logout = await request.post('/api/native/logout', { headers: { Authorization: `Bearer ${rotated.access_token}` } });
  expect(logout.status()).toBe(200);
  const afterLogout = await request.get('/api/native/me', { headers: { Authorization: `Bearer ${rotated.access_token}` } });
  expect(afterLogout.status()).toBe(401);

  const replayLogin = await request.post('/api/native/login', {
    data: { client_id: 'mdtbbs-mindustry-mod', username, password, device_id: 'a1a1a1a1-8d14-4a53-8c11-123456789abc' },
  });
  expect(replayLogin.status()).toBe(200);
  const replayTokens = await replayLogin.json();
  const replayRotation = await request.post('/api/native/refresh', {
    data: { client_id: 'mdtbbs-mindustry-mod', refresh_token: replayTokens.refresh_token, device_id: 'a1a1a1a1-8d14-4a53-8c11-123456789abc' },
  });
  expect(replayRotation.status()).toBe(200);
  const replayed = await request.post('/api/native/refresh', {
    data: { client_id: 'mdtbbs-mindustry-mod', refresh_token: replayTokens.refresh_token, device_id: 'a1a1a1a1-8d14-4a53-8c11-123456789abc' },
  });
  expect(replayed.status()).toBe(401);
  const invalidated = await request.get('/api/native/me', { headers: { Authorization: `Bearer ${(await replayRotation.json()).access_token}` } });
  expect(invalidated.status()).toBe(401);
});
