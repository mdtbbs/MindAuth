const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

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
  process.env.ALIYUN_SMS_TEMPLATE_CODE = 'SMS_TEST';
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
});

test('sendSmsCode fails closed when Aliyun SMS is not configured', async () => {
  resetEnv();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');

  await assert.rejects(
    () => sendSmsCode('13800138000'),
    (err) => err.code === 'SMS_NOT_CONFIGURED' && err.message === '短信服务未配置',
  );
});

test('sendSmsCode sends six-digit verification code request without real network call', async () => {
  resetEnv();
  configureSmsEnv();
  const { sendSmsCode } = require('../../src/utils/aliyunSms');
  let requestedUrl = '';

  global.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ Code: 'OK', Model: { BizId: 'biz-1' } }),
    };
  };

  const result = await sendSmsCode('13800138000');
  const parsed = new URL(requestedUrl);

  assert.equal(result.success, true);
  assert.equal(result.bizId, 'biz-1');
  assert.equal(parsed.searchParams.get('Action'), 'SendSmsVerifyCode');
  assert.equal(parsed.searchParams.get('PhoneNumber'), '13800138000');
  assert.equal(parsed.searchParams.get('CodeLength'), '6');
  assert.equal(parsed.searchParams.get('ValidTime'), '300');
  assert.equal(parsed.searchParams.get('Interval'), '60');
});

test('checkSmsCode accepts Aliyun PASS result', async () => {
  resetEnv();
  configureSmsEnv();
  const { checkSmsCode } = require('../../src/utils/aliyunSms');

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ Code: 'OK', Model: { VerifyResult: 'PASS' } }),
  });

  const result = await checkSmsCode('13800138000', '123456');
  assert.deepEqual(result, { success: true });
});
