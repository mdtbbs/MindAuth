const crypto = require('crypto');

const ENCRYPTED_PREFIX = 'enc:v1:';
const HASHED_PREFIX = 'sha256:';
const ENCRYPTION_KEY_ENV = 'SECRETS_ENCRYPTION_KEY';

function getEncryptionKey() {
  const value = String(process.env[ENCRYPTION_KEY_ENV] || '').trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32) return decoded;
  throw new Error(`${ENCRYPTION_KEY_ENV} must be a 32-byte hex or base64 key`);
}

function requireEncryptionKey() {
  const key = getEncryptionKey();
  if (!key) throw new Error(`${ENCRYPTION_KEY_ENV} is required to encrypt stored secrets`);
  return key;
}

function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

function encryptSecret(value) {
  if (value === null || value === undefined || value === '') return '';
  if (isEncryptedSecret(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', requireEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [
    'enc', 'v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')
  ].join(':');
}

function decryptSecret(value) {
  if (value === null || value === undefined || value === '') return '';
  if (!isEncryptedSecret(value)) return String(value); // startup migration handles legacy rows
  const parts = String(value).split(':');
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') throw new Error('Invalid encrypted secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', requireEncryptionKey(), Buffer.from(parts[2], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()]).toString('utf8');
}

function hashClientSecret(value) {
  return `${HASHED_PREFIX}${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function isHashedClientSecret(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

async function migrateSensitiveConfig(pool) {
  const [emailRows] = await pool.execute('SELECT id, password FROM email_config');
  const [smsRows] = await pool.execute('SELECT id, access_key_secret FROM sms_config');
  const pending = [...emailRows, ...smsRows].some((row) => {
    const value = row.password ?? row.access_key_secret;
    return value && !isEncryptedSecret(value);
  });
  if (pending) requireEncryptionKey();
  let migrated = 0;
  for (const row of emailRows) {
    if (row.password && !isEncryptedSecret(row.password)) {
      await pool.execute('UPDATE email_config SET password = ? WHERE id = ?', [encryptSecret(row.password), row.id]);
      migrated += 1;
    }
  }
  for (const row of smsRows) {
    if (row.access_key_secret && !isEncryptedSecret(row.access_key_secret)) {
      await pool.execute('UPDATE sms_config SET access_key_secret = ? WHERE id = ?', [encryptSecret(row.access_key_secret), row.id]);
      migrated += 1;
    }
  }
  return migrated;
}

module.exports = {
  ENCRYPTED_PREFIX, HASHED_PREFIX, getEncryptionKey, isEncryptedSecret,
  encryptSecret, decryptSecret, hashClientSecret, isHashedClientSecret, migrateSensitiveConfig,
};
