const test = require('node:test');
const assert = require('node:assert/strict');
const emailPolicy = require('../../src/modules/emailPolicy/emailPolicyService');
const { pool } = require('../../src/db');
const { client } = require('../../src/redis');

test('normalizes case, leading @, whitespace, and IDN domains', () => {
  assert.equal(emailPolicy.normalizeDomain('  @Example.COM  '), 'example.com');
  assert.equal(emailPolicy.getEmailDomain('User@BÜCHER.de'), 'xn--bcher-kva.de');
});

test('exact rules match only the exact domain', () => {
  const rules = [{ id: 1, match_type: 'exact', pattern: 'example.com', policy: 'deny', enabled: 1 }];
  assert.equal(emailPolicy.evaluateEmailPolicy('a@example.com', { rules }).allowed, false);
  assert.equal(emailPolicy.evaluateEmailPolicy('a@sub.example.com', { rules }).allowed, true);
});

test('suffix rules include the apex and subdomains but not lookalike suffixes', () => {
  const rules = [{ id: 1, match_type: 'suffix', pattern: 'example.com', policy: 'deny', enabled: 1 }];
  for (const address of ['a@example.com', 'a@sub.example.com', 'a@x.sub.example.com']) {
    assert.equal(emailPolicy.evaluateEmailPolicy(address, { rules }).allowed, false);
  }
  assert.equal(emailPolicy.evaluateEmailPolicy('a@fakeexample.com', { rules }).allowed, true);
});

test('allowlist mode requires an allow match and deny rules always take precedence', () => {
  const rules = [
    { id: 1, match_type: 'suffix', pattern: 'example.com', policy: 'allow', enabled: 1 },
    { id: 2, match_type: 'exact', pattern: 'blocked.example.com', policy: 'deny', enabled: 1 },
  ];
  assert.equal(emailPolicy.evaluateEmailPolicy('a@example.com', { rules, allowlistMode: true }).allowed, true);
  assert.equal(emailPolicy.evaluateEmailPolicy('a@elsewhere.org', { rules, allowlistMode: true }).allowed, false);
  assert.equal(emailPolicy.evaluateEmailPolicy('a@blocked.example.com', { rules, allowlistMode: true }).allowed, false);
});

test('disabled rules are ignored and default mode allows unmatched addresses', () => {
  const rules = [{ id: 1, match_type: 'exact', pattern: 'example.com', policy: 'deny', enabled: 0 }];
  assert.equal(emailPolicy.evaluateEmailPolicy('a@example.com', { rules }).allowed, true);
  assert.equal(emailPolicy.evaluateEmailPolicy('a@elsewhere.org', { rules }).allowed, true);
});

test('rejects malformed domains and emails', () => {
  assert.throws(() => emailPolicy.normalizeDomain('https://example.com'));
  assert.equal(emailPolicy.getEmailDomain('no-at-sign'), null);
});

test('shared checkEmail entry point enforces the same rules for web, email changes, verification, and native registration', async () => {
  const originalExecute = pool.execute;
  const originalGet = client.get;
  const originalDel = client.del;
  const snapshot = { rules: [{ id: 41, match_type: 'suffix', pattern: 'example.test', policy: 'deny', enabled: 1 }], allowlistMode: false };
  try {
    pool.execute = async () => [{ affectedRows: 1 }];
    client.get = async () => JSON.stringify(snapshot);
    client.del = async () => 1;
    await emailPolicy.invalidateCache();
    for (const purpose of ['register', 'change_email', 'verification', 'native_register', 'admin_change_email']) {
      const result = await emailPolicy.checkEmail('user@child.example.test', { purpose });
      assert.equal(result.allowed, false, `${purpose} must be blocked`);
      assert.equal(result.code, 'EMAIL_DOMAIN_BLOCKED');
      assert.equal(result.purpose, purpose);
    }
  } finally {
    await emailPolicy.invalidateCache();
    pool.execute = originalExecute;
    client.get = originalGet;
    client.del = originalDel;
  }
});
