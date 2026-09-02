/**
 * Registration Email-Code Flow Contract Tests
 *
 * Locks down the new registration flow that requires a 6-digit email
 * verification code BEFORE account creation.
 *
 * Tested:
 *   - POST /api/register/send-code happy path (dev mode returns code)
 *   - POST /api/register/send-code with already-registered email → 409
 *   - POST /api/register/send-code with invalid email format → 400
 *   - POST /api/register with valid code → 201, email_verified=1
 *   - POST /api/register with wrong code → 400
 *   - POST /api/register with expired/missing code → 400
 *   - POST /api/register with wrong code format → 400
 *   - POST /api/register/send-code rate limit (3 per 10 min)
 *   - POST /api/register brute-force protection (5 wrong attempts → code invalidated)
 *   - CSRF exemption for /api/register/send-code
 *   - Full UI flow through React registration page
 */

const { test, expect } = require('@playwright/test');

const ADMIN_SECRET = 'admin123';

async function clearRateLimits(request) {
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  } catch { /* ignore */ }
}

test.beforeEach(async ({ request }) => {
  await clearRateLimits(request);
});

// ─────────────────────────────────────────────────────────────
// API Contract
// ─────────────────────────────────────────────────────────────

test.describe('POST /api/register/send-code', () => {
  test('valid email returns code in dev mode', async ({ request }) => {
    const email = `sendcode_ok_${Date.now()}@test.com`;
    const res = await request.post('/api/register/send-code', {
      data: { email }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.message).toContain('验证码已发送');
  });

  test('invalid email format returns 400 INVALID_EMAIL', async ({ request }) => {
    const res = await request.post('/api/register/send-code', {
      data: { email: 'not-an-email' }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_EMAIL');
  });

  test('already-registered email returns 409 EMAIL_ALREADY_REGISTERED', async ({ request }) => {
    // Create a user first via the full flow.
    const email = `existing_${Date.now()}@test.com`;
    const username = `existing_${Date.now()}`;
    const sendRes = await request.post('/api/register/send-code', { data: { email } });
    const sendBody = await sendRes.json();
    await request.post('/api/register', {
      data: { username, email, password: 'TestPass123', email_code: sendBody.code }
    });

    // Now try to send code again for the same email.
    const res = await request.post('/api/register/send-code', { data: { email } });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  test('does not require CSRF token', async ({ request }) => {
    const email = `csrf_ok_${Date.now()}@test.com`;
    const res = await request.post('/api/register/send-code', { data: { email } });
    expect(res.status()).not.toBe(403);
  });

  test('rate-limits after 3 requests per 10 minutes', async ({ request }) => {
    // Clear rate limits before this specific test.
    await clearRateLimits(request);
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      const res = await request.post('/api/register/send-code', {
        data: { email: `rl_${base}_${i}@test.com` }
      });
      expect(res.status()).toBe(200);
    }
    // 4th request should be rate limited.
    const res = await request.post('/api/register/send-code', {
      data: { email: `rl_${base}_4@test.com` }
    });
    expect(res.status()).toBe(429);
  });
});

test.describe('POST /api/register (with email_code)', () => {
  test('valid flow creates user with email_verified=1', async ({ request }) => {
    const email = `reg_ok_${Date.now()}@test.com`;
    const username = `reg_ok_${Date.now()}`;

    const sendRes = await request.post('/api/register/send-code', { data: { email } });
    const sendBody = await sendRes.json();

    const regRes = await request.post('/api/register', {
      data: {
        username,
        email,
        password: 'TestPass123',
        email_code: sendBody.code,
      }
    });
    expect(regRes.status()).toBe(201);

    // Login and check email_verified via /api/me.
    const loginRes = await request.post('/api/login', {
      data: { username, password: 'TestPass123' }
    });
    expect(loginRes.status()).toBe(200);

    const meRes = await request.get('/api/me');
    const me = await meRes.json();
    expect(me.email_verified).toBe(true);
  });

  test('missing email_code returns 400 MISSING_FIELD', async ({ request }) => {
    const res = await request.post('/api/register', {
      data: { username: 'x', email: 'x@test.com', password: 'TestPass123' }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('MISSING_FIELD');
  });

  test('wrong code format returns 400 EMAIL_CODE_INVALID', async ({ request }) => {
    const email = `badfmt_${Date.now()}@test.com`;
    // Send a code so the record exists.
    await request.post('/api/register/send-code', { data: { email } });

    const res = await request.post('/api/register', {
      data: {
        username: 'badfmt',
        email,
        password: 'TestPass123',
        email_code: 'abc',
      }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('EMAIL_CODE_INVALID');
  });

  test('wrong code returns 400 EMAIL_CODE_MISMATCH', async ({ request }) => {
    const email = `wrong_${Date.now()}@test.com`;
    await request.post('/api/register/send-code', { data: { email } });

    const res = await request.post('/api/register', {
      data: {
        username: 'wrong',
        email,
        password: 'TestPass123',
        email_code: '000000',
      }
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('EMAIL_CODE_MISMATCH');
  });

  test('code cannot be reused after successful registration', async ({ request }) => {
    const email = `reuse_${Date.now()}@test.com`;
    const username = `reuse_${Date.now()}`;
    const sendRes = await request.post('/api/register/send-code', { data: { email } });
    const sendBody = await sendRes.json();

    // First use succeeds.
    const first = await request.post('/api/register', {
      data: { username, email, password: 'TestPass123', email_code: sendBody.code }
    });
    expect(first.status()).toBe(201);

    // Second use with the same code and different username must fail — email is
    // already registered, but we also can't reuse the code.
    const second = await request.post('/api/register', {
      data: {
        username: `${username}_dup`,
        email,
        password: 'TestPass123',
        email_code: sendBody.code,
      }
    });
    expect(second.status()).toBe(400);
  });

  test('brute-force protection: 5 wrong attempts invalidate code', async ({ request }) => {
    const email = `brute_${Date.now()}@test.com`;
    await request.post('/api/register/send-code', { data: { email } });

    for (let i = 0; i < 5; i++) {
      const res = await request.post('/api/register', {
        data: {
          username: `brute_${i}`,
          email,
          password: 'TestPass123',
          email_code: '000000',
        }
      });
      expect(res.status()).toBe(400);
    }

    // After 5 failures the code is consumed. A 6th attempt gets EMAIL_CODE_INVALID.
    // Clear the outer per-IP registration limiter so this assertion exercises
    // the per-code brute-force guard rather than a separate endpoint quota.
    await clearRateLimits(request);
    const res = await request.post('/api/register', {
      data: {
        username: `brute_final`,
        email,
        password: 'TestPass123',
        email_code: '000000',
      }
    });
    await clearRateLimits(request);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('EMAIL_CODE_INVALID');
  });
});

// ─────────────────────────────────────────────────────────────
// UI Contract
// ─────────────────────────────────────────────────────────────

test.describe('Registration page UI', () => {
  test('full happy path: send code, fill code, register, reach dashboard', async ({ page }) => {
    const testUser = `ui_reg_${Date.now()}`;

    await page.goto('/register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', testUser);
    await page.fill('#email', `${testUser}@test.com`);
    await page.fill('#password', 'TestPass123');

    // Submit should be disabled until a code is present.
    await expect(page.locator('#register-form button[type="submit"]')).toBeDisabled();

    // Send code — button should change to cooldown.
    await page.click('[data-testid="register-send-code"]');
    await page.waitForSelector('[data-testid="register-email-code"]', { timeout: 5000 });

    // Dev mode auto-fills the 6-digit code.
    await page.waitForFunction(
      () => {
        const input = document.querySelector('[data-testid="register-email-code"]');
        return input && input.value.length === 6;
      },
      { timeout: 5000 }
    );

    await page.click('#register-form button[type="submit"]');
    await expect(page.locator('.toast', { hasText: '注册成功' }).first()).toBeVisible({ timeout: 5000 });
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // After successful registration the user is already verified and logged in.
    const me = await page.request.get('/api/me');
    const meBody = await me.json();
    expect(meBody.success).toBe(true);
    expect(meBody.email_verified).toBe(true);
  });

  test('send code for already-registered email shows inline error', async ({ page }) => {
    // Pre-create a user.
    const testUser = `ui_existing_${Date.now()}`;
    const testEmail = `${testUser}@test.com`;
    const sendRes = await page.request.post('/api/register/send-code', { data: { email: testEmail } });
    const sendBody = await sendRes.json();
    await page.request.post('/api/register', {
      data: { username: testUser, email: testEmail, password: 'TestPass123', email_code: sendBody.code }
    });

    await page.goto('/register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', `${testUser}_dup`);
    await page.fill('#email', testEmail);
    await page.fill('#password', 'TestPass123');

    await page.click('[data-testid="register-send-code"]');
    await expect(page.locator('#register-form')).toContainText('该邮箱已注册', { timeout: 5000 });
  });

  test('changing email after sending code resets code state', async ({ page }) => {
    const testUser = `ui_reset_${Date.now()}`;
    await page.goto('/register');
    await page.waitForSelector('#register-form', { timeout: 5000 });
    await page.fill('#username', testUser);
    await page.fill('#email', `${testUser}@test.com`);
    await page.fill('#password', 'TestPass123');

    // Send code for the first email.
    await page.click('[data-testid="register-send-code"]');
    await page.waitForSelector('[data-testid="register-email-code"]', { timeout: 5000 });

    // Change the email — code input should disappear.
    await page.fill('#email', `${testUser}_new@test.com`);
    // Code input was keyed on `codeSent`, which resets when email changes.
    await expect(page.locator('[data-testid="register-email-code"]')).toHaveCount(0, { timeout: 3000 });
  });
});
