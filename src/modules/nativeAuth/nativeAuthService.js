const crypto = require('crypto');
const bcrypt = require('bcrypt');
const passwordLogin = require('../auth/passwordLogin');
const { pool: defaultPool } = require('../../db');
const { client: defaultRedis } = require('../../redis');
const { getClientIp } = require('../../utils/request');
const { isValidEmail, isValidPassword, isValidUsername } = require('../../utils/validation');
const { timingSafeCompare } = require('../../utils/crypto');
const { checkLoginAllowed, findByQq } = require('../social/socialLogin');
const qqProvider = require('../social/qqProvider');
const { hashClientSecret } = require('../../utils/secrets');
const { sendNativeSmsCode } = require('../../utils/aliyunSms');
const { normalizePhone, isValidMainlandChinaPhone } = require('../../utils/phone');

const TX_TTL_SECONDS = 600;
const CODE_TTL_SECONDS = 90;
const SMS_TTL_SECONDS = 300;

class NativeAuthError extends Error {
  constructor(code, status = 400, message = '认证请求无效', retryable = false) {
    super(message); this.code = code; this.status = status; this.retryable = retryable;
  }
}

function randomPublicId(prefix) { return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`; }
function hmac(value) {
  const key = process.env.NATIVE_AUTH_HMAC_SECRET || process.env.ADMIN_SECRET;
  if (!key) throw new Error('NATIVE_AUTH_HMAC_SECRET is required');
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}
function pkceChallenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url'); }
function normalizeLogin(login) { return String(login || '').trim(); }
function nativeErrorPayload(err) { return { error: { code: err.code || 'NATIVE_AUTH_ERROR', message: err.message || '认证失败', retryable: Boolean(err.retryable), details: [] } }; }

function verifyPhoneActionTicket(ticket) {
  const secret = process.env.NATIVE_PHONE_ACTION_SECRET;
  if (!secret) throw new NativeAuthError('PHONE_ACTION_UNAVAILABLE', 503, '手机号验证暂不可用', true);
  const parts = String(ticket || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'npa') throw new NativeAuthError('PHONE_ACTION_INVALID', 401, '手机号验证凭据无效');
  const signed = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('base64url');
  if (!timingSafeCompare(parts[2], expected)) throw new NativeAuthError('PHONE_ACTION_INVALID', 401, '手机号验证凭据无效');
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { throw new NativeAuthError('PHONE_ACTION_INVALID', 401, '手机号验证凭据无效'); }
  if (!Number.isInteger(claims.sub) || !claims.jti || claims.aud !== 'mindauth-native-phone' || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) throw new NativeAuthError('PHONE_ACTION_INVALID', 401, '手机号验证凭据无效');
  return claims;
}

function createNativeAuthService({ pool = defaultPool, redis = defaultRedis, sendSms = sendNativeSmsCode, qq = qqProvider } = {}) {
  async function audit({ transactionId = null, userId = null, clientId = 'unknown', event, method = null, resultCode = null, req }) {
    try { await pool.execute('INSERT INTO native_auth_audit_logs (transaction_id, user_id, client_id, event, method, result_code, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [transactionId, userId, clientId, event, method, resultCode, req ? getClientIp(req) : null, req?.headers?.['user-agent']?.slice(0, 500) || null]); } catch (err) { console.warn('[NativeAuth] audit failed:', err.message); }
  }
  async function hitLimit(key, max, seconds) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, seconds);
    if (count > max) throw new NativeAuthError('RATE_LIMITED', 429, '操作过于频繁，请稍后重试', true);
  }
  async function clientConfig(clientId) {
    const [rows] = await pool.execute('SELECT client_id, enabled, allowed_methods, pkce_required FROM native_auth_clients WHERE client_id = ? LIMIT 1', [clientId]);
    const c = rows[0];
    if (!c || !c.enabled) throw new NativeAuthError('INVALID_CLIENT', 401, '客户端无效');
    c.allowed_methods = typeof c.allowed_methods === 'string' ? JSON.parse(c.allowed_methods) : c.allowed_methods;
    return c;
  }
  async function getTransaction(publicId, { lock = false } = {}) {
    const sql = `SELECT t.*, NOW() AS db_now FROM native_auth_transactions t WHERE t.public_id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`;
    const [rows] = await pool.execute(sql, [publicId]); const tx = rows[0];
    if (!tx) throw new NativeAuthError('AUTH_TRANSACTION_NOT_FOUND', 404, '认证事务不存在');
    if (new Date(tx.expires_at) <= new Date(tx.db_now) || tx.status === 'EXPIRED') { await pool.execute("UPDATE native_auth_transactions SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'", [tx.id]); throw new NativeAuthError('AUTH_TRANSACTION_EXPIRED', 410, '认证事务已过期'); }
    if (tx.status !== 'PENDING') throw new NativeAuthError('AUTH_TRANSACTION_NOT_PENDING', 409, '认证事务不可用');
    return tx;
  }
  async function requireMethod(tx, method) {
    const c = await clientConfig(tx.client_id);
    if (!Array.isArray(c.allowed_methods) || !c.allowed_methods.includes(method)) throw new NativeAuthError('AUTH_METHOD_NOT_ALLOWED', 403, '该认证方式不可用');
  }
  async function createTransaction({ clientId, codeChallenge, codeChallengeMethod, req }) {
    if (codeChallengeMethod !== 'S256' || typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) throw new NativeAuthError('PKCE_S256_REQUIRED', 400, '必须提供 S256 PKCE challenge');
    const c = await clientConfig(clientId); await hitLimit(`native:tx:${getClientIp(req)}:${clientId}`, 30, 600);
    const publicId = randomPublicId('auth_tx');
    await pool.execute('INSERT INTO native_auth_transactions (public_id, client_id, code_challenge, code_challenge_method, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))', [publicId, clientId, codeChallenge, codeChallengeMethod, TX_TTL_SECONDS]);
    await audit({ clientId, event: 'native.auth.transaction.created', req });
    return { transaction_id: publicId, expires_in: TX_TTL_SECONDS, methods: c.allowed_methods };
  }
  async function issueCode(tx, user, method, req) {
    const [transactionUpdate] = await pool.execute(
      "UPDATE native_auth_transactions SET user_id = ?, selected_method = ?, status = 'AUTHORIZED', authorized_at = NOW() WHERE id = ? AND status = 'PENDING' AND expires_at > NOW()",
      [user.id, method, tx.id]
    );
    if (transactionUpdate.affectedRows !== 1) {
      throw new NativeAuthError('AUTH_TRANSACTION_NOT_PENDING', 409, '认证事务不可用');
    }
    const code = crypto.randomBytes(32).toString('base64url');
    await pool.execute('INSERT INTO native_authorization_codes (code_digest, client_id, user_id, transaction_id, code_challenge, auth_method, expires_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))', [hmac(`code:${code}`), tx.client_id, user.id, tx.id, tx.code_challenge, method, CODE_TTL_SECONDS]);
    await audit({ transactionId: tx.id, userId: user.id, clientId: tx.client_id, event: 'native.auth.code.issued', method, req });
    return { authorization_code: code, expires_in: CODE_TTL_SECONDS, token_type: 'authorization_code' };
  }
  async function password({ transactionId, login, password, req }) {
    const tx = await getTransaction(transactionId);
    await requireMethod(tx, 'password');
    await hitLimit(`native:password:ip:${getClientIp(req)}`, 10, 300);
    await hitLimit(`native:password:tx:${tx.id}`, 10, 300);
    const identifier = normalizeLogin(login);
    if (!identifier || typeof password !== 'string') throw new NativeAuthError('INVALID_CREDENTIALS', 401, '用户名、邮箱或密码错误');
    const result = await passwordLogin.authenticatePassword({
      login: identifier, password, ipAddress: getClientIp(req), userAgent: req.headers['user-agent'] || '',
    });
    if (!result.ok) {
      if (result.reason === 'locked') throw new NativeAuthError('ACCOUNT_LOCKED', 423, '账号已锁定，请稍后重试');
      if (result.reason === 'banned') throw new NativeAuthError('ACCOUNT_DISABLED', 403, '账号当前不可登录');
      await audit({ transactionId: tx.id, clientId: tx.client_id, event: 'native.auth.password.failed', method: 'password', resultCode: 'INVALID_CREDENTIALS', req });
      throw new NativeAuthError('INVALID_CREDENTIALS', 401, '用户名、邮箱或密码错误');
    }
    const user = result.user;
    await pool.execute('INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)', [user.id, getClientIp(req), (req.headers['user-agent'] || '').slice(0, 200), 'native_password']);
    await audit({ transactionId: tx.id, userId: user.id, clientId: tx.client_id, event: 'native.auth.password.success', method: 'password', req });
    return issueCode(tx, user, 'password', req);
  }
  async function sendSmsChallenge({ transactionId, phone, req }) {
    const tx = await getTransaction(transactionId); await requireMethod(tx, 'sms'); const normalized = normalizePhone(phone);
    if (!isValidMainlandChinaPhone(normalized)) throw new NativeAuthError('INVALID_PHONE', 400, '手机号格式无效');
    await hitLimit(`native:sms:ip:${getClientIp(req)}`, 10, 3600); await hitLimit(`native:sms:phone:${hmac(`phone:${normalized}`)}`, 1, 60);
    if (typeof sendSms !== 'function') throw new NativeAuthError('SMS_SEND_FAILED', 503, '短信服务不可用', true);
    const code = String(crypto.randomInt(100000, 1000000)); const challengeId = randomPublicId('sms');
    await sendSms(normalized, code);
    await pool.execute('INSERT INTO native_sms_challenges (public_id, transaction_id, phone_hash, code_digest, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))', [challengeId, tx.id, hmac(`phone:${normalized}`), hmac(`sms:${challengeId}:${code}`), SMS_TTL_SECONDS]);
    await audit({ transactionId: tx.id, clientId: tx.client_id, event: 'native.auth.sms.sent', method: 'sms', req });
    return { challenge_id: challengeId, expires_in: SMS_TTL_SECONDS, retry_after: 60 };
  }
  async function verifySms({ transactionId, challengeId, phone, code, req }) {
    const tx = await getTransaction(transactionId); if (!/^\d{6}$/.test(String(code || ''))) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效');
    const [rows] = await pool.execute('SELECT c.*, NOW() AS db_now FROM native_sms_challenges c WHERE c.public_id = ? AND c.transaction_id = ? LIMIT 1', [challengeId, tx.id]); const challenge = rows[0];
    if (!challenge || challenge.consumed_at) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效');
    if (new Date(challenge.expires_at) <= new Date(challenge.db_now)) throw new NativeAuthError('SMS_CODE_EXPIRED', 410, '验证码已过期');
    if (challenge.attempt_count >= challenge.max_attempts) throw new NativeAuthError('SMS_TOO_MANY_ATTEMPTS', 429, '验证码尝试次数过多');
    const normalized = normalizePhone(phone);
    if (!isValidMainlandChinaPhone(normalized) || !timingSafeCompare(challenge.phone_hash, hmac(`phone:${normalized}`))) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效');
    if (!timingSafeCompare(challenge.code_digest, hmac(`sms:${challengeId}:${code}`))) { await pool.execute('UPDATE native_sms_challenges SET attempt_count = attempt_count + 1 WHERE id = ?', [challenge.id]); await audit({ transactionId: tx.id, clientId: tx.client_id, event: 'native.auth.sms.failed', method: 'sms', resultCode: 'SMS_CODE_INVALID', req }); throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效'); }
    const [consumeResult] = await pool.execute('UPDATE native_sms_challenges SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW()', [challenge.id]);
    if (consumeResult.affectedRows !== 1) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效');
    const [users] = await pool.execute('SELECT * FROM users WHERE phone = ? LIMIT 1', [normalized]); const user = users[0];
    if (!user) throw new NativeAuthError('ACCOUNT_NOT_FOUND', 404, '该手机号尚未注册');
    const allowed = await checkLoginAllowed(user); if (!allowed.allowed) throw new NativeAuthError('ACCOUNT_DISABLED', 403, '账号当前不可登录');
    await audit({ transactionId: tx.id, userId: user.id, clientId: tx.client_id, event: 'native.auth.sms.success', method: 'sms', req }); return issueCode(tx, user, 'sms', req);
  }
  async function qqLogin({ transactionId, authorizationCode, req }) {
    const tx = await getTransaction(transactionId); await requireMethod(tx, 'qq'); await hitLimit(`native:qq:ip:${getClientIp(req)}`, 20, 600);
    if (!authorizationCode || typeof authorizationCode !== 'string' || authorizationCode.length > 2048) throw new NativeAuthError('QQ_AUTH_FAILED', 400, 'QQ 授权凭据无效');
    try {
      const token = await qq.exchangeCode(authorizationCode);
      const openid = await qq.getOpenId(token.access_token);
      const binding = await findByQq(openid);
      if (!binding) throw new NativeAuthError('QQ_ACCOUNT_NOT_BOUND', 409, 'QQ 尚未绑定 MindAuth 账号');
      const [users] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [binding.user_id]);
      const user = users[0]; if (!user) throw new NativeAuthError('QQ_ACCOUNT_NOT_BOUND', 409, 'QQ 尚未绑定 MindAuth 账号');
      const allowed = await checkLoginAllowed(user); if (!allowed.allowed) throw new NativeAuthError('ACCOUNT_DISABLED', 403, '账号当前不可登录');
      await audit({ transactionId: tx.id, userId: user.id, clientId: tx.client_id, event: 'native.auth.qq.success', method: 'qq', req });
      return issueCode(tx, user, 'qq', req);
    } catch (err) {
      if (err instanceof NativeAuthError) throw err;
      await audit({ transactionId: tx.id, clientId: tx.client_id, event: 'native.auth.qq.failed', method: 'qq', resultCode: 'QQ_AUTH_FAILED', req });
      throw new NativeAuthError('QQ_AUTH_FAILED', 503, 'QQ 认证暂不可用', true);
    }
  }
  async function register({ transactionId, challengeId, smsCode, username, password, email, phone, req }) {
    const tx = await getTransaction(transactionId);
    if (!isValidUsername(username) || !isValidPassword(password) || !isValidEmail(email)) throw new NativeAuthError('INVALID_REGISTRATION', 400, '用户名、邮箱或密码格式无效');
    const [rows] = await pool.execute('SELECT c.*, NOW() AS db_now FROM native_sms_challenges c WHERE c.public_id = ? AND c.transaction_id = ? LIMIT 1', [challengeId, tx.id]); const challenge = rows[0];
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= new Date(challenge.db_now) || !timingSafeCompare(challenge.code_digest, hmac(`sms:${challengeId}:${smsCode}`))) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效或已过期');
    const normalizedPhone = normalizePhone(phone);
    if (!isValidMainlandChinaPhone(normalizedPhone) || !timingSafeCompare(hmac(`phone:${normalizedPhone}`), challenge.phone_hash)) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码与手机号不匹配');
    const [existingPhone] = await pool.execute('SELECT id FROM users WHERE phone = ? LIMIT 1', [normalizedPhone]); if (existingPhone[0]) throw new NativeAuthError('PHONE_ALREADY_USED', 409, '手机号已注册');
    let userId;
    try { const [result] = await pool.execute('INSERT INTO users (username, email, password_hash, phone, phone_verified, phone_verified_at, email_verified) VALUES (?, ?, ?, ?, 1, NOW(), 0)', [username.trim(), email.toLowerCase().trim(), await bcrypt.hash(password, 12), normalizedPhone]); userId = result.insertId; }
    catch (err) { if (err.code === 'ER_DUP_ENTRY') throw new NativeAuthError('USERNAME_OR_EMAIL_ALREADY_USED', 409, '用户名或邮箱已被使用'); throw err; }
    await pool.execute('UPDATE native_sms_challenges SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL', [challenge.id]);
    const [users] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
    await audit({ transactionId: tx.id, userId, clientId: tx.client_id, event: 'native.auth.register.success', method: 'sms', req }); return issueCode(tx, users[0], 'register', req);
  }
  async function sendPhoneVerification({ ticket, phone, req }) {
    const claims = verifyPhoneActionTicket(ticket); const normalized = normalizePhone(phone);
    if (!isValidMainlandChinaPhone(normalized)) throw new NativeAuthError('INVALID_PHONE', 400, '手机号格式无效');
    await hitLimit(`native:phone:ip:${getClientIp(req)}`, 10, 3600); await hitLimit(`native:phone:user:${claims.sub}`, 3, 600); await hitLimit(`native:phone:number:${hmac(`phone:${normalized}`)}`, 1, 60);
    const [users] = await pool.execute('SELECT id, phone, phone_verified FROM users WHERE id = ? LIMIT 1', [claims.sub]); const user = users[0];
    if (!user) throw new NativeAuthError('PHONE_ACTION_INVALID', 401, '手机号验证凭据无效');
    if (user.phone_verified && user.phone !== normalized) throw new NativeAuthError('PHONE_ALREADY_BOUND', 409, '当前账号已绑定手机号');
    const [inUse] = await pool.execute('SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1', [normalized, claims.sub]); if (inUse[0]) throw new NativeAuthError('PHONE_ALREADY_USED', 409, '手机号已被使用');
    const code = String(crypto.randomInt(100000, 1000000)); const challengeId = randomPublicId('phone'); await sendSms(normalized, code);
    await pool.execute('INSERT INTO native_phone_challenges (public_id, user_id, ticket_id_hash, phone_hash, code_digest, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))', [challengeId, claims.sub, hmac(`ticket:${claims.jti}`), hmac(`phone:${normalized}`), hmac(`phone-code:${challengeId}:${code}`), SMS_TTL_SECONDS]);
    await audit({ userId: claims.sub, clientId: 'mdtbbs_android', event: 'native.phone.sent', method: 'sms', req }); return { challenge_id: challengeId, expires_in: SMS_TTL_SECONDS, retry_after: 60 };
  }
  async function verifyPhoneVerification({ ticket, challengeId, phone, code, req }) {
    const claims = verifyPhoneActionTicket(ticket); if (!/^\d{6}$/.test(String(code || ''))) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效');
    const [rows] = await pool.execute('SELECT c.*, NOW() AS db_now FROM native_phone_challenges c WHERE c.public_id = ? AND c.user_id = ? LIMIT 1', [challengeId, claims.sub]); const challenge = rows[0];
    if (!challenge || challenge.consumed_at || !timingSafeCompare(challenge.ticket_id_hash, hmac(`ticket:${claims.jti}`))) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效');
    if (new Date(challenge.expires_at) <= new Date(challenge.db_now)) throw new NativeAuthError('SMS_CODE_EXPIRED', 410, '验证码已过期');
    if (challenge.attempt_count >= challenge.max_attempts) throw new NativeAuthError('SMS_TOO_MANY_ATTEMPTS', 429, '验证码尝试次数过多');
    if (!timingSafeCompare(challenge.code_digest, hmac(`phone-code:${challengeId}:${code}`))) { await pool.execute('UPDATE native_phone_challenges SET attempt_count = attempt_count + 1 WHERE id = ?', [challenge.id]); throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效'); }
    const normalized = normalizePhone(phone); if (!isValidMainlandChinaPhone(normalized) || !timingSafeCompare(challenge.phone_hash, hmac(`phone:${normalized}`))) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码与手机号不匹配');
    const [result] = await pool.execute('UPDATE native_phone_challenges SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW()', [challenge.id]); if (result.affectedRows !== 1) throw new NativeAuthError('SMS_CODE_INVALID', 400, '验证码无效');
    try { await pool.execute('UPDATE users SET phone = ?, phone_verified = 1, phone_verified_at = NOW() WHERE id = ? AND (phone IS NULL OR phone = ?)', [normalized, claims.sub, normalized]); }
    catch (err) { if (err.code === 'ER_DUP_ENTRY') throw new NativeAuthError('PHONE_ALREADY_USED', 409, '手机号已被使用'); throw err; }
    await audit({ userId: claims.sub, clientId: 'mdtbbs_android', event: 'native.phone.success', method: 'sms', req }); return { phone_verified: true };
  }
  async function exchange({ clientId, clientSecret, code, codeVerifier, req }) {
    if (clientId !== 'mdtbbs_android' || !process.env.NATIVE_MINDFOURM_CLIENT_SECRET || !timingSafeCompare(hashClientSecret(clientSecret || ''), hashClientSecret(process.env.NATIVE_MINDFOURM_CLIENT_SECRET))) throw new NativeAuthError('INVALID_CLIENT', 401, '服务端客户端认证失败');
    if (!code || !codeVerifier || typeof codeVerifier !== 'string') throw new NativeAuthError('AUTHORIZATION_CODE_INVALID', 400, '授权码无效');
    const digest = hmac(`code:${code}`); const [rows] = await pool.execute('SELECT c.*, NOW() AS db_now, u.username, u.email, u.avatar_url, u.phone_verified FROM native_authorization_codes c JOIN users u ON u.id = c.user_id WHERE c.code_digest = ? LIMIT 1', [digest]); const record = rows[0];
    if (!record) throw new NativeAuthError('AUTHORIZATION_CODE_INVALID', 400, '授权码无效');
    if (record.client_id !== clientId) throw new NativeAuthError('AUTHORIZATION_CODE_INVALID', 400, '授权码无效');
    if (new Date(record.expires_at) <= new Date(record.db_now)) throw new NativeAuthError('AUTHORIZATION_CODE_EXPIRED', 400, '授权码已过期');
    if (!timingSafeCompare(pkceChallenge(codeVerifier), record.code_challenge)) { await audit({ transactionId: record.transaction_id, userId: record.user_id, clientId, event: 'native.auth.code.exchange.failed', resultCode: 'PKCE_VERIFICATION_FAILED', req }); throw new NativeAuthError('PKCE_VERIFICATION_FAILED', 400, 'PKCE 校验失败'); }
    const [result] = await pool.execute('UPDATE native_authorization_codes SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW()', [record.id]);
    if (result.affectedRows !== 1) throw new NativeAuthError('AUTHORIZATION_CODE_CONSUMED', 400, '授权码已使用或过期');
    await pool.execute("UPDATE native_auth_transactions SET status = 'CONSUMED', consumed_at = NOW() WHERE id = ?", [record.transaction_id]); await audit({ transactionId: record.transaction_id, userId: record.user_id, clientId, event: 'native.auth.code.exchange.success', method: record.auth_method, req });
    return { user: { id: Number(record.user_id), username: record.username, email: record.email, display_name: record.username, avatar_url: record.avatar_url || null, phone_verified: Boolean(record.phone_verified) }, auth: { method: record.auth_method } };
  }
  return { NativeAuthError, nativeErrorPayload, createTransaction, password, sendSmsChallenge, verifySms, qqLogin, register, sendPhoneVerification, verifyPhoneVerification, exchange, clientConfig };
}

const defaultService = createNativeAuthService();
module.exports = { ...defaultService, createNativeAuthService, NativeAuthError, nativeErrorPayload, pkceChallenge, verifyPhoneActionTicket };
