const crypto = require('crypto');
const { pool: defaultPool } = require('../../db');
const { client: defaultRedis } = require('../../redis');
const passwordLogin = require('../auth/passwordLogin');
const oauthIssuer = require('../oauth/oauthIssuer');
const tokenStore = require('../oauth/tokenStore');
const notificationCenter = require('../notifications/notificationCenter');
const { getClientIp } = require('../../utils/request');

const OFFICIAL_CLIENT_ID = 'mdtbbs-mindustry-mod';
const DEFAULT_SCOPE = 'openid profile game_content';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class NativeClientError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

function createNativeClientService({ pool = defaultPool, redis = defaultRedis, auth = passwordLogin.authenticatePassword, issuer = oauthIssuer, store = tokenStore, notify = notificationCenter } = {}) {
  async function getConfig(clientId) {
    if (clientId !== OFFICIAL_CLIENT_ID) throw new NativeClientError('INVALID_CLIENT', 401, '无效的客户端');
    const [rows] = await pool.execute('SELECT * FROM native_auth_clients WHERE client_id = ? AND enabled = 1 LIMIT 1', [clientId]);
    const config = rows[0];
    if (!config || !config.token_audience_client_id) throw new NativeClientError('INVALID_CLIENT', 401, '无效的客户端');
    return config;
  }

  async function hit(key, max, ttl) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ttl);
    if (count > max) throw new NativeClientError('RATE_LIMITED', 429, '尝试次数过多，请稍后重试');
  }

  function validateDevice(deviceId, deviceName) {
    if (typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) throw new NativeClientError('INVALID_REQUEST', 400, 'device_id 必须是随机 UUID');
    if (deviceName !== undefined && (typeof deviceName !== 'string' || deviceName.length > 80 || /[<>]/.test(deviceName) || [...deviceName].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127))) {
      throw new NativeClientError('INVALID_REQUEST', 400, 'device_name 格式无效');
    }
  }

  async function login({ clientId, login, password, deviceId, deviceName, req }) {
    const config = await getConfig(clientId);
    validateDevice(deviceId, deviceName);
    if (typeof login !== 'string' || login.trim().length < 1 || login.length > 254 || typeof password !== 'string' || password.length < 1 || password.length > 1024) {
      throw new NativeClientError('INVALID_REQUEST', 400, '请填写账号和密码');
    }
    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    const normalizedDeviceName = (deviceName || 'Mindustry').trim() || 'Mindustry';
    const loginHash = crypto.createHash('sha256').update(login.trim().toLowerCase()).digest('hex');
    await hit(`native:login:account:${clientId}:${loginHash}`, 10, 300);

    const result = await auth({ login, password, ipAddress: ip, userAgent: ua });
    if (!result.ok) {
      try {
        await pool.execute(
          'INSERT INTO native_auth_audit_logs (user_id, client_id, event, method, result_code, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [result.user?.id || null, clientId, 'native.client.login.failed', 'password', result.reason === 'credentials' ? 'INVALID_CREDENTIALS' : String(result.reason).toUpperCase(), ip, ua]
        );
      } catch (err) { console.warn('[NativeClient] audit failed:', err.message); }
      if (result.reason === 'banned') throw new NativeClientError('USER_BANNED', 403, '账号当前不可登录');
      if (result.reason === 'locked') throw new NativeClientError('ACCOUNT_LOCKED', 423, '账号已锁定，请稍后重试');
      throw new NativeClientError('INVALID_CREDENTIALS', 401, '用户名/邮箱或密码错误');
    }

    const [sessionResult] = await pool.execute(
      'INSERT INTO native_client_sessions (user_id, client_id, device_id, device_name, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      [result.user.id, clientId, deviceId, normalizedDeviceName, ip, ua]
    );
    const sessionId = sessionResult.insertId;
    const deviceLabel = `MDTBBS Mindustry Mod · ${normalizedDeviceName}`;
    const [prior] = await pool.execute(
      'SELECT id FROM login_logs WHERE user_id = ? AND client_id = ? AND device_id = ? LIMIT 1',
      [result.user.id, clientId, deviceId]
    );
    const [previous] = await pool.execute('SELECT ip FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [result.user.id]);
    await pool.execute(
      'INSERT INTO login_logs (user_id, ip, device, login_type, client_id, device_id, device_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [result.user.id, ip, deviceLabel.slice(0, 200), 'native', clientId, deviceId, normalizedDeviceName]
    );
    if (prior.length === 0 || (previous[0] && previous[0].ip !== ip)) {
      try {
        await notify.create({
          user_id: result.user.id, type: 'login_new_device', title: '新设备登录',
          content: `检测到新的 MDTBBS Mindustry Mod 登录\n设备：${normalizedDeviceName}\nIP：${ip}`,
          ip_address: ip, user_agent: ua, sendEmail: true,
        });
      } catch (err) { console.warn('[NativeClient] new device notification failed:', err.message); }
    }
    try {
      await pool.execute(
        'INSERT INTO native_auth_audit_logs (user_id, client_id, event, method, result_code, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [result.user.id, clientId, 'native.client.login.success', 'password', null, ip, ua]
      );
    } catch (err) { console.warn('[NativeClient] audit failed:', err.message); }
    let tokens;
    try {
      tokens = await issuer.issueNativeTokens({
        userId: result.user.id, clientId, accessClientId: config.token_audience_client_id,
        nativeSessionId: sessionId, scope: DEFAULT_SCOPE,
      });
    } catch (err) {
      await pool.execute('UPDATE native_client_sessions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [sessionId]).catch(() => {});
      throw err;
    }
    return { ...tokens, success: true };
  }

  async function refresh({ clientId, refreshToken, deviceId }) {
    const config = await getConfig(clientId);
    validateDevice(deviceId);
    if (typeof refreshToken !== 'string' || refreshToken.length < 32 || refreshToken.length > 512) {
      throw new NativeClientError('INVALID_REFRESH_TOKEN', 401, 'refresh_token 无效或已过期');
    }
    return issuer.refreshNative({ refreshToken, clientId, accessClientId: config.token_audience_client_id, deviceId });
  }

  async function logout({ accessToken, userId, clientId, refreshToken, deviceId }) {
    let sessionId;
    if (accessToken) {
      const token = await store.getAccessToken(accessToken);
      if (token && token.user_id === userId && token.native_session_id) sessionId = token.native_session_id;
    } else if (refreshToken) {
      await getConfig(clientId);
      validateDevice(deviceId);
      const digest = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const [rows] = await pool.execute(
        `SELECT r.native_session_id FROM refresh_tokens r
         JOIN native_client_sessions s ON s.id = r.native_session_id
         WHERE r.token = ? AND r.client_id = ? AND r.revoked = 0 AND r.expires_at > NOW()
           AND s.device_id = ? AND s.revoked_at IS NULL LIMIT 1`,
        [digest, clientId, deviceId]
      );
      sessionId = rows[0]?.native_session_id;
    }
    if (!sessionId) throw new NativeClientError('SESSION_REVOKED', 401, '会话无效或已撤销');
    await issuer.revokeNativeSession(sessionId);
    return { success: true };
  }

  async function me({ accessToken }) {
    const token = await store.getAccessToken(accessToken);
    if (!token?.native_session_id) throw new NativeClientError('SESSION_REVOKED', 401, '会话无效或已撤销');
    const claims = await issuer.userinfo(accessToken);
    const throttleKey = `native_session_active:${token.native_session_id}`;
    if (!(await redis.get(throttleKey).catch(() => null))) {
      await redis.setEx(throttleKey, 300, '1').catch(() => {});
      await pool.execute('UPDATE native_client_sessions SET last_active_at = NOW() WHERE id = ? AND revoked_at IS NULL', [token.native_session_id]);
    }
    return {
      id: Number(claims.sub), username: claims.username, avatar_url: claims.avatar_url || null,
      phone_verified: Boolean(claims.phone_verified), ban_status: claims.ban_status || 'none',
      is_muted: Boolean(claims.is_muted),
    };
  }

  return { login, refresh, logout, me, getConfig, NativeClientError };
}

const service = createNativeClientService();
module.exports = { ...service, createNativeClientService, NativeClientError, OFFICIAL_CLIENT_ID };
