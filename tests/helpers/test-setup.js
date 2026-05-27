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

module.exports = {
  clearRateLimits,
  waitForRateLimit,
  ADMIN_SECRET
};