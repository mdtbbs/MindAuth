const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCsrf } = require('../../src/middleware/csrf');

function run(path) {
  let continued = false;
  let code;
  const req = { method: 'POST', path, cookies: {}, headers: {} };
  const res = { status(value) { code = value; return this; }, json() { return this; } };
  validateCsrf(req, res, () => { continued = true; });
  return { continued, code };
}

test('Native bearer endpoints skip browser cookie CSRF checks precisely', () => {
  for (const path of ['/api/native/login', '/api/native/refresh', '/api/native/logout']) {
    assert.deepEqual(run(path), { continued: true, code: undefined });
  }
  assert.deepEqual(run('/api/native/something-else'), { continued: false, code: 403 });
});
