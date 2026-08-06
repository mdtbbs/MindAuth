const crypto = require('crypto');
const { client } = require('../../redis');
const { hashToken } = require('../../utils/token');
const { timingSafeCompare } = require('../../utils/crypto');

const PREFIX = 'social:state:';
const TTL = 600; // 10 分钟
const STATE_BYTES = 32;
const MAX_PAYLOAD_SIZE = 4096;

// 允许的 OAuth authorize context 字段
const ALLOWED_AUTHORIZE_FIELDS = new Set([
  'clientId',
  'redirectUri',
  'state',
  'scope',
  'codeChallenge',
  'codeChallengeMethod',
]);

// 允许的 intent 值
const VALID_INTENTS = new Set(['login', 'bind', 'register']);

// 允许的 provider 值
const VALID_PROVIDERS = new Set(['qq']);

/**
 * 创建 OAuth state
 *
 * @param {object} payload - state payload
 * @param {string} payload.provider - OAuth provider (qq)
 * @param {string} payload.intent - intent (login|bind|register)
 * @param {string} [payload.sessionToken] - session token (will be hashed)
 * @param {string} [payload.ip] - client IP
 * @param {string} [payload.userAgent] - user agent
 * @param {object} [payload.authorize] - OAuth authorize context
 * @param {string} [payload.openid] - QQ openid
 * @param {string} [payload.nickname] - QQ nickname
 * @param {string} [payload.avatarUrl] - QQ avatar URL
 * @returns {Promise<string>} - opaque state token
 */
function createState(payload = {}) {
  // 验证 provider
  if (!payload.provider || !VALID_PROVIDERS.has(payload.provider)) {
    throw new Error('Invalid provider');
  }

  // 验证 intent
  if (!payload.intent || !VALID_INTENTS.has(payload.intent)) {
    throw new Error('Invalid intent');
  }

  const state = crypto.randomBytes(STATE_BYTES).toString('hex');

  // 构建 state 数据，只保留白名单字段
  const safePayload = {
    provider: payload.provider,
    intent: payload.intent,
    createdAt: new Date().toISOString(),
  };

  // session token → session hash
  if (payload.sessionToken) {
    safePayload.sessionHash = hashToken(payload.sessionToken);
  }

  // IP/UA 作为审计信息
  if (payload.ip) safePayload.ip = String(payload.ip).slice(0, 200);
  if (payload.userAgent) safePayload.userAgent = String(payload.userAgent).slice(0, 500);

  // OAuth authorize context
  if (payload.authorize && typeof payload.authorize === 'object') {
    safePayload.authorize = {};
    for (const [key, value] of Object.entries(payload.authorize)) {
      if (ALLOWED_AUTHORIZE_FIELDS.has(key) && value !== undefined && value !== null) {
        safePayload.authorize[key] = String(value).slice(0, 2048);
      }
    }
    if (Object.keys(safePayload.authorize).length === 0) {
      delete safePayload.authorize;
    }
  }

  // QQ profile 临时数据
  if (payload.openid) safePayload.openid = String(payload.openid).slice(0, 255);
  if (payload.nickname) safePayload.nickname = String(payload.nickname).slice(0, 255);
  if (payload.avatarUrl) safePayload.avatarUrl = String(payload.avatarUrl).slice(0, 1024);

  // 检查 payload 大小
  const serialized = JSON.stringify(safePayload);
  if (serialized.length > MAX_PAYLOAD_SIZE) {
    throw new Error('State payload too large');
  }

  return client.setEx(`${PREFIX}${state}`, TTL, serialized).then(() => state);
}

/**
 * 消费 OAuth state（原子删除）
 *
 * @param {string} state - opaque state token
 * @returns {Promise<object|null>} - state payload or null
 */
async function consumeState(state) {
  if (!state || typeof state !== 'string' || state.length !== STATE_BYTES * 2) {
    return null;
  }
  if (!/^[a-f0-9]+$/.test(state)) {
    return null;
  }
  const raw = await client.getDel(`${PREFIX}${state}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // 验证必要字段
    if (!parsed.provider || !parsed.intent || !parsed.createdAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 保存 state（用于重新创建）
 *
 * @param {string} state - opaque state token
 * @param {object} payload - state payload
 * @returns {Promise<string>} - state token
 */
async function storeState(state, payload) {
  if (!state || state.length !== STATE_BYTES * 2 || !/^[a-f0-9]+$/.test(state)) {
    throw new Error('INVALID_STATE');
  }

  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_SIZE) {
    throw new Error('State payload too large');
  }

  await client.setEx(`${PREFIX}${state}`, TTL, serialized);
  return state;
}

/**
 * Timing-safe 比较 session hash
 *
 * @param {string} storedHash - stored session hash
 * @param {string} tokenToVerify - token to verify
 * @returns {boolean}
 */
function compareSessionHash(storedHash, tokenToVerify) {
  if (!storedHash || !tokenToVerify) return false;
  const candidateHash = hashToken(tokenToVerify);
  return timingSafeCompare(storedHash, candidateHash);
}

module.exports = {
  createState,
  consumeState,
  storeState,
  compareSessionHash,
  TTL,
  STATE_BYTES,
  VALID_INTENTS,
  VALID_PROVIDERS,
};
