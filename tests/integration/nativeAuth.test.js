const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

process.env.NATIVE_AUTH_HMAC_SECRET = 'native-auth-integration-hmac-secret';
process.env.NATIVE_MINDFOURM_CLIENT_SECRET = 'native-auth-integration-exchange-secret';

const { pool, closePool, runMigrations } = require('../../src/db');
const { client, connectRedis, closeRedis } = require('../../src/redis');
const { createNativeAuthService, pkceChallenge } = require('../../src/modules/nativeAuth/nativeAuthService');

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';
const req = { headers: { 'user-agent': 'MindAuth native integration test' }, socket: { remoteAddress: '127.0.0.1' } };

async function createUser(phone) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const [result] = await pool.execute(
    'INSERT INTO users (username, email, password_hash, phone, phone_verified, email_verified) VALUES (?, ?, ?, ?, 1, 1)',
    [`native_${suffix}`, `native_${suffix}@test.invalid`, await bcrypt.hash('NativePass123', 4), phone]
  );
  return result.insertId;
}

describe('nativeAuth', { skip: !RUN_INTEGRATION }, () => {
  let sentCode;
  let service;

  before(async () => {
    await connectRedis();
    await runMigrations(pool);
    service = createNativeAuthService({
      pool,
      redis: client,
      sendSms: async (_phone, code) => { sentCode = code; },
    });
  });

  beforeEach(async () => {
    sentCode = null;
    await pool.execute('DELETE FROM native_auth_audit_logs');
    await pool.execute('DELETE FROM native_authorization_codes');
    await pool.execute('DELETE FROM native_sms_challenges');
    await pool.execute('DELETE FROM native_auth_transactions');
    await pool.execute("DELETE FROM users WHERE username LIKE 'native_%'");
  });

  after(async () => {
    await closeRedis();
    await closePool();
  });

  async function smsTransaction(phone) {
    const verifier = 'v'.repeat(43);
    const transaction = await service.createTransaction({ clientId: 'mdtbbs_android', codeChallenge: pkceChallenge(verifier), codeChallengeMethod: 'S256', req });
    const challenge = await service.sendSmsChallenge({ transactionId: transaction.transaction_id, phone, req });
    return { verifier, transaction, challenge };
  }

  it('maps an existing canonical phone to the same user and exchanges exactly once', async () => {
    const phone = '13800138000';
    const userId = await createUser(phone);
    const { verifier, transaction, challenge } = await smsTransaction(` ${phone} `);
    const authorization = await service.verifySms({ transactionId: transaction.transaction_id, challengeId: challenge.challenge_id, phone, code: sentCode, req });
    const result = await service.exchange({ clientId: 'mdtbbs_android', clientSecret: process.env.NATIVE_MINDFOURM_CLIENT_SECRET, code: authorization.authorization_code, codeVerifier: verifier, req });
    assert.equal(result.user.id, userId);
    await assert.rejects(() => service.exchange({ clientId: 'mdtbbs_android', clientSecret: process.env.NATIVE_MINDFOURM_CLIENT_SECRET, code: authorization.authorization_code, codeVerifier: verifier, req }), /已使用|无效/);
  });

  it('allows exactly one concurrent SMS verification to authorize a transaction', async () => {
    const phone = '13900139000';
    await createUser(phone);
    const { transaction, challenge } = await smsTransaction(phone);
    const results = await Promise.allSettled([
      service.verifySms({ transactionId: transaction.transaction_id, challengeId: challenge.challenge_id, phone, code: sentCode, req }),
      service.verifySms({ transactionId: transaction.transaction_id, challengeId: challenge.challenge_id, phone, code: sentCode, req }),
    ]);
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  });
});
