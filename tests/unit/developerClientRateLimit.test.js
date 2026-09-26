const { test } = require('node:test');
const assert = require('node:assert/strict');

// Use the repository's in-memory Redis adapter so this test exercises the same
// per-IP rate-limit middleware without requiring an external Redis process.
process.env.USE_MEMORY_REDIS = '1';
const router = require('../../src/routes/developerClients');

test('developer application creation is capped at ten attempts per IP per hour', async () => {
  const route = router.stack.find((layer) => layer.route?.path === '/' && layer.route.methods.post)?.route;
  assert.ok(route, 'POST / developer-client route exists');
  const limiter = route.stack[0].handle;
  let continued = 0;
  let lastResponse;
  const req = { headers: {}, connection: { remoteAddress: '198.51.100.42' } };

  for (let attempt = 0; attempt < 11; attempt += 1) {
    const res = {
      statusCode: 200,
      set(name, value) { this.retry = [name, value]; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; lastResponse = this; return this; },
    };
    await limiter(req, res, () => { continued += 1; });
    if (attempt < 10) assert.equal(res.statusCode, 200);
    else assert.equal(res.statusCode, 429);
  }

  assert.equal(continued, 10);
  assert.equal(lastResponse.body.code, 'RATE_LIMITED');
  assert.deepEqual(lastResponse.retry?.[0], 'Retry-After');
});
