const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Module = require('module');

class NativeAuthError extends Error {}

const nativeAuthStub = {
  NativeAuthError,
  createTransaction: async () => ({ transaction_id: 'transaction-test' }),
  password: async () => ({}),
  sendSmsChallenge: async () => ({}),
  verifySms: async () => ({}),
  qqLogin: async () => ({}),
  register: async () => ({}),
  sendPhoneVerification: async () => ({}),
  verifyPhoneVerification: async () => ({}),
  exchange: async () => ({}),
  nativeErrorPayload: () => ({}),
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../modules/nativeAuth/nativeAuthService' && parent?.filename?.endsWith('/src/routes/nativeAuth.js')) return nativeAuthStub;
  return originalLoad.call(this, request, parent, isMain);
};
const router = require('../../src/routes/nativeAuth');
Module._load = originalLoad;
const { validateCsrf } = require('../../src/middleware/csrf');

test('native transaction routes bypass browser CSRF validation', () => {
  for (const path of [
    '/api/v1/native/auth/transactions',
    '/api/v1/native/auth/transactions/transaction-test/password',
    '/api/v1/native/auth/transactions/transaction-test/sms/send',
    '/api/v1/native/auth/transactions/transaction-test/sms/verify',
  ]) {
    let continued = false;
    validateCsrf(
      { method: 'POST', path, cookies: {}, headers: {} },
      { status: () => ({ json: () => { throw new Error('native route must not require a browser CSRF token'); } }) },
      () => { continued = true; },
    );
    assert.equal(continued, true, path);
  }
});

test('native transaction creation returns 201', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/native', router);
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/native/auth/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: 'mdtbbs_android', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { transaction_id: 'transaction-test' });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
