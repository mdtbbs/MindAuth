const crypto = require('crypto');
const { client } = require('../redis');
const { pool } = require('../db');
const { decryptSecret } = require('./secrets');

const ENDPOINT = 'dysmsapi.aliyuncs.com';
const SIGNATURE_ALGORITHM = 'ACS3-HMAC-SHA256';
const CODE_TTL_SECONDS = 300;
const CODE_REDIS_PREFIX = 'sms:code:';

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

function envConfig() {
  return {
    enabled: true,
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    signName: process.env.ALIYUN_SMS_SIGN_NAME,
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
  };
}

async function getSmsConfig() {
  const fallbackConfig = envConfig();

  if (
    fallbackConfig.accessKeyId &&
    fallbackConfig.accessKeySecret &&
    fallbackConfig.signName &&
    fallbackConfig.templateCode
  ) {
    return fallbackConfig;
  }

  try {
    const [rows] = await pool.execute(
      'SELECT enabled, access_key_id, access_key_secret, sign_name, template_code FROM sms_config WHERE id = 1'
    );
    const dbConfig = rows[0];

    if (
      dbConfig &&
      (dbConfig.enabled === 1 || dbConfig.enabled === true) &&
      dbConfig.access_key_id &&
      dbConfig.access_key_secret &&
      dbConfig.sign_name &&
      dbConfig.template_code
    ) {
      return {
        enabled: true,
        accessKeyId: dbConfig.access_key_id,
        accessKeySecret: decryptSecret(dbConfig.access_key_secret),
        signName: dbConfig.sign_name,
        templateCode: dbConfig.template_code,
      };
    }
  } catch {}

  return fallbackConfig;
}

async function requireConfig() {
  const { accessKeyId, accessKeySecret, signName, templateCode } = await getSmsConfig();

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    const err = new Error('短信服务未配置');
    err.code = 'SMS_NOT_CONFIGURED';
    throw err;
  }

  return { accessKeyId, accessKeySecret, signName, templateCode };
}

function buildAuthorization(method, query, headers, body, accessKeyId, accessKeySecret) {
  // Canonical query string: sorted, values percent-encoded, keys raw
  const canonicalQueryString = Object.keys(query)
    .sort()
    .map((key) => `${key}=${percentEncode(query[key])}`)
    .join('&');

  // Canonical headers: lowercase keys starting with x-acs- or host, sorted
  const headerMap = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('x-acs-') || lowerKey === 'host' || lowerKey === 'content-type') {
      headerMap[lowerKey] = String(value).trim();
    }
  }
  const sortedHeaderKeys = Object.keys(headerMap).sort();
  const canonicalHeaders = sortedHeaderKeys.map((key) => `${key}:${headerMap[key]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  // Hashed payload: SHA-256 of body in lowercase hex
  const hashedPayload = crypto.createHash('sha256').update(body || '').digest('hex');

  // Canonical request
  const canonicalRequest = [
    method,
    '/',
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  // String to sign: ACS3-HMAC-SHA256\n + hex(SHA256(canonicalRequest))
  const hashedCanonical = crypto.createHash('sha256').update(Buffer.from(canonicalRequest)).digest('hex');
  const stringToSign = `${SIGNATURE_ALGORITHM}\n${hashedCanonical}`;

  // Signature: hex(HMAC-SHA256(secret, stringToSign))
  const signature = crypto.createHmac('sha256', accessKeySecret).update(stringToSign).digest('hex');

  return `${SIGNATURE_ALGORITHM} Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
}

async function requestAliyun(action, params) {
  const { accessKeyId, accessKeySecret } = await requireConfig();

  const nonce = crypto.randomUUID();
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const query = {
    PhoneNumbers: params.PhoneNumbers,
    SignName: params.SignName,
    TemplateCode: params.TemplateCode,
    TemplateParam: params.TemplateParam,
  };

  const body = '';
  const headers = {
    'host': ENDPOINT,
    'x-acs-action': action,
    'x-acs-version': '2017-05-25',
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-content-sha256': crypto.createHash('sha256').update(body).digest('hex'),
  };

  const authorization = buildAuthorization('POST', query, headers, body, accessKeyId, accessKeySecret);

  const queryString = Object.keys(query)
    .sort()
    .map((key) => `${key}=${percentEncode(query[key])}`)
    .join('&');
  const url = `https://${ENDPOINT}/?${queryString}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Authorization': authorization,
    },
    body: body || undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.Code !== 'OK') {
    const err = new Error(data.Message || '短信服务请求失败');
    err.code = data.Code || 'SMS_REQUEST_FAILED';
    throw err;
  }

  return data;
}

async function sendSmsCode(phone) {
  const { signName, templateCode } = await requireConfig();

  const code = String(crypto.randomInt(100000, 1000000));
  await client.setEx(`${CODE_REDIS_PREFIX}${phone}`, CODE_TTL_SECONDS, code);

  try {
    const data = await requestAliyun('SendSms', {
      PhoneNumbers: phone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code }),
    });

    return { success: true, bizId: data.BizId };
  } catch (err) {
    await client.del(`${CODE_REDIS_PREFIX}${phone}`).catch(() => {});
    throw err;
  }
}

// Native Auth owns its OTP digest and lifecycle in MySQL.  This helper sends
// a caller-provided code without putting a usable code in Redis.
async function sendNativeSmsCode(phone, code) {
  if (!/^\d{6}$/.test(String(code))) throw new Error('Native SMS code invalid');
  const { signName, templateCode } = await requireConfig();
  const data = await requestAliyun('SendSms', {
    PhoneNumbers: phone,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: String(code) }),
  });
  return { success: true, bizId: data.BizId };
}

async function checkSmsCode(phone, code) {
  const stored = await client.get(`${CODE_REDIS_PREFIX}${phone}`);

  if (!stored) {
    return { success: false };
  }

  const storedBuf = Buffer.from(stored);
  const inputBuf = Buffer.from(code);
  const match =
    storedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(storedBuf, inputBuf);

  if (match) {
    await client.del(`${CODE_REDIS_PREFIX}${phone}`).catch(() => {});
  }

  return { success: match };
}

module.exports = { sendSmsCode, sendNativeSmsCode, checkSmsCode, getSmsConfig };
