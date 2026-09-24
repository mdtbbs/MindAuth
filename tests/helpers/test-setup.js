// Test helper for auth tests
const { request } = require('@playwright/test');

// ADMIN_SECRET from .env (same as server)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

/**
 * Clear all rate limits before tests
 * Call this in test.beforeEach or test.beforeAll
 */
async function clearRateLimits(request) {
  try {
    const response = await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
    return response.ok();
  } catch (err) {
    console.warn('Could not clear rate limits:', err.message);
    return false;
  }
}

/**
 * Wait for rate limit to reset (fallback if clear fails)
 * @param {number} seconds - Seconds to wait
 */
async function waitForRateLimit(seconds = 3600) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Register a new user via the new email-code-gated flow (HTTP API).
 *
 * 1. POST /api/register/send-code (dev mode returns the code in the response)
 * 2. POST /api/register with username/email/password/email_code
 *
 * @param {{ post: (url: string, opts?: object) => Promise<any> }} http
 * @param {object} opts
 * @param {string} opts.username
 * @param {string} opts.email
 * @param {string} opts.password
 * @returns {Promise<object>} register response body
 */
async function registerUser(http, { username, email, password }) {
  const sendRes = await http.post('/api/register/send-code', {
    data: { email }
  });
  if (sendRes.status() !== 200) {
    const body = await sendRes.json().catch(() => ({}));
    throw new Error(`send-code failed: ${sendRes.status()} ${JSON.stringify(body)}`);
  }
  const sendBody = await sendRes.json();
  if (!sendBody.code) {
    throw new Error('send-code did not return a code (is the server running in dev mode?)');
  }

  const regRes = await http.post('/api/register', {
    data: { username, email, password, email_code: sendBody.code }
  });
  const regBody = await regRes.json().catch(() => ({}));
  if (regRes.status() !== 201) {
    throw new Error(`register failed: ${regRes.status()} ${JSON.stringify(regBody)}`);
  }
  return regBody;
}

/**
 * Register a new user via the registration UI (Playwright page).
 * Handles the new email-code flow:
 *   1. Fill username, email, password
 *   2. Click send-code button; wait for code field to appear (pre-filled in dev mode)
 *   3. Click submit; wait for dashboard redirect
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} prefix - Username prefix (timestamp appended)
 * @returns {Promise<string>} username
 */
async function registerUserViaUI(page, prefix) {
  const ts = Date.now();
  const username = `${prefix}_${ts}`;
  const email = `${username}@test.com`;

  await page.goto('/register');
  await page.waitForSelector('#register-form', { timeout: 5000 });
  await page.fill('#username', username);
  await page.fill('#email', email);
  await page.fill('#password', 'TestPass123');

  // Trigger send-code; dev mode returns the code and the page pre-fills it.
  await page.click('[data-testid="register-send-code"]');
  await page.waitForSelector('[data-testid="register-email-code"]', { timeout: 5000 });
  // In dev mode the code is auto-filled, but give it a tick to settle.
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

module.exports = {
  clearRateLimits,
  waitForRateLimit,
  registerUser,
  registerUserViaUI,
  ADMIN_SECRET
};
