const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

// -- Redis Mock --
const mockRedisStore = new Map();
const mockRedisClient = {
  get: async (key) => mockRedisStore.get(key) || null,
  setEx: async (key, ttl, value) => { mockRedisStore.set(key, value); return 'OK'; },
  del: async (key) => { mockRedisStore.delete(key); return 1; },
};

function setupRedisMock() {
  const redisPath = require.resolve('../../src/redis');
  require.cache[redisPath] = {
    id: redisPath,
    filename: redisPath,
    loaded: true,
    exports: { client: mockRedisClient },
  };
}

// -- Env Utilities --
function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ALIYUN_ACCESS_KEY_ID;
  delete process.env.ALIYUN_ACCESS_KEY_SECRET;
  delete process.env.ALIYUN_SMS_SIGN_NAME;
  delete process.env.ALIYUN_SMS_TEMPLATE_CODE;
}

function configureSmsEnv() {
  process.env.ALIYUN_ACCESS_KEY_ID = 'test-key-id';
  process.env.ALIYUN_ACCESS_KEY_SECRET = 'test-key-secret';
  process.env.ALIYUN_SMS_SIGN_NAME = 'MindProject';
  process.env.ALIYUN_SMS_TEMPLATE_CODE = 'SMS_TEST_001';
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  mockRedisStore.clear();
  delete require.cache[require.resolve('../../src/utils/aliyunSms')];
});

// -- Tests --

test('sendSmsCode fails closed when Aliyun SMS is not configured', async () => {
  resetEnv();
  setupRedisMock();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');

  await assert.rejects(
    () => sendSmsCode('13800138000'),
    (err) => err.code === 'SMS_NOT_CONFIGURED' && err.message === '短信服务未配置',
  );
});

test('sendSmsCode sends POST request to dysmsapi with SendSms action', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');

  let capturedUrl = '';
  let capturedOptions = {};
  global.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options || {};
    return {
      ok: true,
      json: async () => ({ Code: 'OK', Message: 'OK', BizId: 'biz-123', RequestId: 'req-1' }),
    };
  };

  const result = await sendSmsCode('13800138000');
  const parsed = new URL(capturedUrl);

  assert.equal(result.success, true);
  assert.equal(result.bizId, 'biz-123');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(parsed.hostname, 'dysmsapi.aliyuncs.com');

  // V3: Action is in x-acs-action header, not query string
  assert.equal(capturedOptions.headers['x-acs-action'], 'SendSms');
  assert.equal(capturedOptions.headers['x-acs-version'], '2017-05-25');
  assert.ok(capturedOptions.headers['x-acs-date'], 'x-acs-date header should be set');
  assert.ok(capturedOptions.headers['x-acs-signature-nonce'], 'x-acs-signature-nonce header should be set');
  assert.ok(capturedOptions.headers['x-acs-content-sha256'], 'x-acs-content-sha256 header should be set');
  assert.ok(capturedOptions.headers['Authorization'].startsWith('ACS3-HMAC-SHA256'), 'Authorization should use V3 signature');

  // V3: query string only has business params, no Action/Signature/Format etc.
  assert.equal(parsed.searchParams.get('PhoneNumbers'), '13800138000');
  assert.equal(parsed.searchParams.get('SignName'), 'MindProject');
  assert.equal(parsed.searchParams.get('TemplateCode'), 'SMS_TEST_001');
  assert.equal(parsed.searchParams.get('Action'), null, 'Action should NOT be in query string for V3');
  assert.equal(parsed.searchParams.get('Signature'), null, 'Signature should NOT be in query string for V3');
});

test('sendSmsCode generates 6-digit code, stores in Redis, and passes in TemplateParam', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');

  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ Code: 'OK', BizId: 'biz-456' }),
    };
  };

  const result = await sendSmsCode('13800138000');
  const parsed = new URL(capturedUrl);

  const templateParam = JSON.parse(parsed.searchParams.get('TemplateParam'));
  assert.ok(/^\d{6}$/.test(templateParam.code), 'code should be 6 digits');

  const storedCode = mockRedisStore.get('sms:code:13800138000');
  assert.ok(storedCode, 'code should be stored in Redis');
  assert.equal(storedCode, templateParam.code, 'stored code matches sent code');
});

test('sendSmsCode overwrites existing code for same phone', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ Code: 'OK', BizId: 'biz-1' }),
  });

  await sendSmsCode('13800138000');
  assert.ok(mockRedisStore.get('sms:code:13800138000'));

  await sendSmsCode('13800138000');
  assert.equal(mockRedisStore.size, 1, 'only one key in Redis');
});

test('sendSmsCode propagates Aliyun API errors and cleans up Redis', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');

  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ Code: 'isv.INVALID_PARAMETERS', Message: '手机号格式错误' }),
  });

  await assert.rejects(
    () => sendSmsCode('13800138000'),
    (err) => err.code === 'isv.INVALID_PARAMETERS',
  );

  assert.equal(mockRedisStore.has('sms:code:13800138000'), false, 'Redis key should be cleaned up after API failure');
});

test('checkSmsCode returns success for matching code', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { checkSmsCode } = require('../../src/utils/aliyunSms');

  mockRedisStore.set('sms:code:13800138000', '123456');

  const result = await checkSmsCode('13800138000', '123456');
  assert.deepEqual(result, { success: true });
});

test('checkSmsCode returns failure for wrong code', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { checkSmsCode } = require('../../src/utils/aliyunSms');

  mockRedisStore.set('sms:code:13800138000', '123456');

  const result = await checkSmsCode('13800138000', '654321');
  assert.deepEqual(result, { success: false });
});

test('checkSmsCode returns failure when no code in Redis', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { checkSmsCode } = require('../../src/utils/aliyunSms');

  const result = await checkSmsCode('13800138000', '123456');
  assert.deepEqual(result, { success: false });
});

test('checkSmsCode does not delete code on failed attempt', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { checkSmsCode } = require('../../src/utils/aliyunSms');

  mockRedisStore.set('sms:code:13800138000', '123456');

  await checkSmsCode('13800138000', '000000');
  assert.equal(mockRedisStore.get('sms:code:13800138000'), '123456', 'code still in Redis after failure');
});

test('checkSmsCode returns failure for different length input', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { checkSmsCode } = require('../../src/utils/aliyunSms');

  mockRedisStore.set('sms:code:13800138000', '123456');

  const result = await checkSmsCode('13800138000', '12345');
  assert.deepEqual(result, { success: false });
});

test('checkSmsCode deletes code from Redis on successful verification', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { checkSmsCode } = require('../../src/utils/aliyunSms');

  mockRedisStore.set('sms:code:13800138000', '123456');

  const result = await checkSmsCode('13800138000', '123456');
  assert.deepEqual(result, { success: true });
  assert.equal(mockRedisStore.has('sms:code:13800138000'), false, 'Redis key should be deleted after success');
});

test('sendSmsCode Authorization header has correct V3 signature format', async () => {
  resetEnv();
  configureSmsEnv();
  setupRedisMock();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');

  let capturedHeaders = {};
  global.fetch = async (url, options) => {
    capturedHeaders = (options || {}).headers || {};
    return {
      ok: true,
      json: async () => ({ Code: 'OK', BizId: 'biz-1' }),
    };
  };

  await sendSmsCode('13800138000');

  const auth = capturedHeaders['Authorization'];
  assert.ok(auth, 'Authorization header should exist');

  // Format: ACS3-HMAC-SHA256 Credential=...,SignedHeaders=...,Signature=...
  assert.ok(auth.startsWith('ACS3-HMAC-SHA256 Credential=test-key-id,'), 'should start with algorithm and credential');
  assert.ok(auth.includes('SignedHeaders='), 'should include SignedHeaders');
  assert.ok(auth.includes('Signature='), 'should include Signature');

  // SignedHeaders should include required V3 headers
  const signedHeadersMatch = auth.match(/SignedHeaders=([^,]+)/);
  assert.ok(signedHeadersMatch, 'should parse SignedHeaders');
  const signedHeaders = signedHeadersMatch[1].split(';');
  assert.ok(signedHeaders.includes('host'), 'SignedHeaders should include host');
  assert.ok(signedHeaders.includes('x-acs-action'), 'SignedHeaders should include x-acs-action');
  assert.ok(signedHeaders.includes('x-acs-version'), 'SignedHeaders should include x-acs-version');
  assert.ok(signedHeaders.includes('x-acs-date'), 'SignedHeaders should include x-acs-date');
  assert.ok(signedHeaders.includes('x-acs-signature-nonce'), 'SignedHeaders should include x-acs-signature-nonce');
  assert.ok(signedHeaders.includes('x-acs-content-sha256'), 'SignedHeaders should include x-acs-content-sha256');

  // Signature should be 64 hex chars (SHA-256)
  const signatureMatch = auth.match(/Signature=([a-f0-9]+)/);
  assert.ok(signatureMatch, 'Signature should be hex string');
  assert.equal(signatureMatch[1].length, 64, 'Signature should be 64 hex chars (SHA-256)');
});
