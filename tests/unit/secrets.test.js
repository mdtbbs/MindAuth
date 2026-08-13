const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  encryptSecret,
  decryptSecret,
  hashClientSecret,
  isEncryptedSecret,
  getEncryptionKey,
} = require('../../src/utils/secrets');

const originalKey = process.env.SECRETS_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = originalKey;
});

test('encrypts and decrypts provider secrets without storing plaintext', () => {
  process.env.SECRETS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encrypted = encryptSecret('smtp-password');
  assert.equal(isEncryptedSecret(encrypted), true);
  assert.notEqual(encrypted, 'smtp-password');
  assert.equal(decryptSecret(encrypted), 'smtp-password');
});

test('client secrets are deterministic SHA-256 hashes', () => {
  const hashed = hashClientSecret('client-secret');
  assert.match(hashed, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(hashed, 'client-secret');
  assert.equal(hashClientSecret('client-secret'), hashed);
});

test('encryption key accepts 32-byte base64 and rejects invalid keys', () => {
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  assert.equal(getEncryptionKey().length, 32);
  process.env.SECRETS_ENCRYPTION_KEY = 'too-short';
  assert.throws(() => getEncryptionKey(), /32-byte/);
});
