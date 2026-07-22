/**
 * Build Integrity Tests
 *
 * Verifies that the production React build no longer depends on legacy
 * static paths that were removed in Task 13:
 *   - /shared-styles/*  (monorepo CSS — now bundled by Vite)
 *   - /templates/*      (shared HTML templates — now React components)
 *   - /public/js/*      (legacy vanilla JS — now React modules)
 *
 * These tests require the Vite build output in dist/client/.
 * Run `npm run build` before running these tests.
 */

const { test, expect } = require('@playwright/test');

/** Legacy path patterns that must NOT appear in production HTML. */
const LEGACY_PATTERNS = [
  /\/shared-styles\//,
  /\/templates\//,
  /\/js\/common\.js/,
  /\/js\/shared-loader\.js/,
  /\/js\/main\.js/,
  /\/js\/admin\.js/,
  /\/style\.css/,
];

/**
 * Collect every URL requested by the page during initial load + a short
 * settling period (for lazy-loaded chunks / dynamic imports).
 */
async function collectRequestedUrls(page) {
  const urls = [];
  page.on('request', (req) => urls.push(req.url()));

  // Wait for network to settle so lazy imports are captured.
  await page.waitForLoadState('networkidle');
  return urls;
}

/**
 * Assert that none of the collected URLs match any legacy pattern.
 */
function assertNoLegacyRequests(urls, label) {
  const violations = [];
  for (const url of urls) {
    const pathOnly = new URL(url).pathname;
    for (const pattern of LEGACY_PATTERNS) {
      if (pattern.test(pathOnly)) {
        violations.push(`  ${label}: ${pathOnly} matches ${pattern}`);
      }
    }
  }
  expect(violations, `Legacy requests found:\n${violations.join('\n')}`).toHaveLength(0);
}

// ─────────────────────────────────────────────────────────────
// User SPA
// ─────────────────────────────────────────────────────────────
test.describe('User SPA — no legacy static dependencies', () => {
  test('homepage (/) must not request legacy paths', async ({ page }) => {
    const urls = await collectRequestedUrls(page.goto('/'));
    assertNoLegacyRequests(urls, '/');
  });

  test('login page (/login) must not request legacy paths', async ({ page }) => {
    const urls = await collectRequestedUrls(page.goto('/login'));
    assertNoLegacyRequests(urls, '/login');
  });

  test('register page (/register) must not request legacy paths', async ({ page }) => {
    const urls = await collectRequestedUrls(page.goto('/register'));
    assertNoLegacyRequests(urls, '/register');
  });
});

// ─────────────────────────────────────────────────────────────
// Admin SPA
// ─────────────────────────────────────────────────────────────
test.describe('Admin SPA — no legacy static dependencies', () => {
  test('admin page (/admin) must not request legacy paths', async ({ page }) => {
    const urls = await collectRequestedUrls(page.goto('/admin'));
    assertNoLegacyRequests(urls, '/admin');
  });
});

// ─────────────────────────────────────────────────────────────
// HTML source inspection
// ─────────────────────────────────────────────────────────────
test.describe('Production HTML source — no legacy references', () => {
  test('user index.html has no <link> to /shared-styles/', async ({ request }) => {
    const res = await request.get('/');
    const html = await res.text();
    expect(html).not.toContain('/shared-styles/');
    expect(html).not.toContain('/templates/');
    expect(html).not.toContain('/js/common.js');
    expect(html).not.toContain('/js/shared-loader.js');
  });

  test('admin.html has no <link> to /shared-styles/', async ({ request }) => {
    const res = await request.get('/admin');
    const html = await res.text();
    expect(html).not.toContain('/shared-styles/');
    expect(html).not.toContain('/templates/');
    expect(html).not.toContain('/js/admin.js');
  });

  test('user index.html references /assets/ (Vite output)', async ({ request }) => {
    const res = await request.get('/');
    const html = await res.text();
    // Vite injects <script type="module" src="/assets/...">
    expect(html).toMatch(/\/assets\//);
  });

  test('admin.html references /assets/ (Vite output)', async ({ request }) => {
    const res = await request.get('/admin');
    const html = await res.text();
    expect(html).toMatch(/\/assets\//);
  });
});

// ─────────────────────────────────────────────────────────────
// Static asset cache headers
// ─────────────────────────────────────────────────────────────
test.describe('Static asset cache headers', () => {
  test('hashed /assets/* files have long cache (1 year)', async ({ request }) => {
    // First get the user HTML to find a real /assets/ URL
    const htmlRes = await request.get('/');
    const html = await htmlRes.text();
    const assetMatch = html.match(/src="(\/assets\/[^"]+)"/);
    if (!assetMatch) {
      test.skip();
      return;
    }
    const assetUrl = assetMatch[1];
    const res = await request.get(assetUrl);
    expect(res.ok()).toBeTruthy();
    const cacheControl = res.headers()['cache-control'];
    // Should include max-age=31536000 (1 year in seconds)
    expect(cacheControl).toMatch(/max-age=31536000/);
    expect(cacheControl).toContain('immutable');
  });

  test('legacy error.html is still accessible', async ({ request }) => {
    const res = await request.get('/error.html');
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
  });

  test('legacy oauth-error.html is still accessible', async ({ request }) => {
    const res = await request.get('/oauth-error.html');
    expect(res.ok()).toBeTruthy();
  });

  test('robots.txt is still accessible', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.ok()).toBeTruthy();
  });
});
