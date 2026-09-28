const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../../src/config/validate');

function makeConfig(overrides = {}) {
  return {
    server: { isProduction: false, baseUrl: 'http://localhost:4001', allowedOrigins: [] },
    mysql: { host: '127.0.0.1', user: 'mindauth', password: '', database: 'mindauth' },
    redis: { host: '127.0.0.1' },
    qq: { enabled: false },
    admin: { secret: '' },
    adminSecurity: { minSecretLength: 32 },
    ...overrides,
  };
}

test('validateConfig permits a passwordless local development MySQL account', () => {
  const config = makeConfig({ mysql: { host: '127.0.0.1', user: '', password: '', database: 'mindauth' } });
  assert.doesNotThrow(() => validateConfig(config));
});

test('validateConfig requires a MySQL password in production', () => {
  const config = makeConfig({
    server: { isProduction: true, baseUrl: 'https://auth.example.com', allowedOrigins: ['https://forum.example.com'] },
    mysql: { host: '127.0.0.1', user: 'mindauth', password: '', database: 'mindauth' },
    admin: { secret: 'a'.repeat(32) },
  });
  assert.throws(() => validateConfig(config), /MYSQL_PASSWORD is required in production/);
});

test('validateConfig protects test runs from non-test databases', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const config = makeConfig({ mysql: { host: '127.0.0.1', user: 'mindauth_test', password: '', database: 'mindauth' } });
    assert.throws(() => validateConfig(config), /explicitly named test database/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('validateConfig requires complete GitHub OAuth settings when enabled', () => {
  const config = makeConfig({ social: { github: { enabled: true, clientId: '', clientSecret: '', redirectUri: '', timeoutMs: 5000 } } });
  assert.throws(() => validateConfig(config), /GITHUB OAuth is enabled but GITHUB_CLIENT_ID/);
});

test('validateConfig requires HTTPS social callbacks in production', () => {
  const config = makeConfig({
    server: { isProduction: true, baseUrl: 'https://auth.example.com', allowedOrigins: [] },
    mysql: { host: '127.0.0.1', user: 'mindauth', password: 'strong', database: 'mindauth' },
    admin: { secret: 'a'.repeat(32) },
    social: { discord: { enabled: true, clientId: 'client', clientSecret: 'secret', redirectUri: 'http://auth.example.com/callback', timeoutMs: 5000 } },
  });
  assert.throws(() => validateConfig(config), /DISCORD_REDIRECT_URI must use HTTPS in production/);
});
