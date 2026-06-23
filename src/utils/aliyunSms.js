const crypto = require('crypto');

const ENDPOINT = process.env.ALIYUN_SMS_ENDPOINT || 'dypnsapi.aliyuncs.com';
const API_VERSION = process.env.ALIYUN_SMS_API_VERSION || '2017-05-25';

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function requireConfig() {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    const err = new Error('短信服务未配置');
    err.code = 'SMS_NOT_CONFIGURED';
    throw err;
  }

  return { accessKeyId, accessKeySecret, signName, templateCode };
}

function sign(params, accessKeySecret) {
  const canonicalizedQuery = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');

  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalizedQuery)}`;
  return crypto
    .createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
}

function buildUrl(action, actionParams) {
  const { accessKeyId, accessKeySecret } = requireConfig();
  const params = {
    Format: 'JSON',
    Version: API_VERSION,
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Action: action,
    ...actionParams,
  };

  const signature = sign(params, accessKeySecret);
  const query = Object.entries({ ...params, Signature: signature })
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join('&');

  return `https://${ENDPOINT}/?${query}`;
}

async function requestAliyun(action, params) {
  const url = buildUrl(action, params);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.Code !== 'OK') {
    const err = new Error(data.Message || '短信服务请求失败');
    err.code = data.Code || 'SMS_REQUEST_FAILED';
    throw err;
  }

  return data;
}

async function sendSmsCode(phone) {
  const { signName, templateCode } = requireConfig();
  const data = await requestAliyun('SendSmsVerifyCode', {
    PhoneNumber: phone,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: '##code##', min: '5' }),
    CodeLength: 6,
    ValidTime: 300,
    Interval: 60,
    CodeType: 1,
  });

  return { success: true, bizId: data.Model?.BizId };
}

async function checkSmsCode(phone, code) {
  const data = await requestAliyun('CheckSmsVerifyCode', {
    PhoneNumber: phone,
    VerifyCode: code,
  });

  const verifyResult = data.Model?.VerifyResult;
  return {
    success: verifyResult === 'PASS' || verifyResult === true || verifyResult === 1,
  };
}

module.exports = { sendSmsCode, checkSmsCode };
