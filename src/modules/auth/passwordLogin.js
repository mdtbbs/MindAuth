const bcrypt = require('bcrypt');
const { pool: defaultPool } = require('../../db');
const { client: defaultRedis } = require('../../redis');
const notificationCenter = require('../notifications/notificationCenter');
const { logUserAudit } = require('../../utils/userAudit');
const { isValidEmail } = require('../../utils/validation');

function createPasswordLogin({ pool = defaultPool, redis = defaultRedis, notify = notificationCenter, audit = logUserAudit, compare = bcrypt.compare } = {}) {
  return async function authenticatePassword({ login, password, ipAddress, userAgent = '' }) {
    const identifier = String(login || '');
    const isEmail = isValidEmail(identifier);
    const queryValue = isEmail ? identifier.toLowerCase().trim() : identifier;
    const [rows] = await pool.execute(
      isEmail ? 'SELECT * FROM users WHERE email = ? LIMIT 1' : 'SELECT * FROM users WHERE username = ? LIMIT 1',
      [queryValue]
    );
    const user = rows[0];
    if (!user) return { ok: false, reason: 'credentials' };

    if (user.ban_status === 'banned') {
      const expired = user.ban_expires_at && new Date(user.ban_expires_at) < new Date();
      if (!expired) return { ok: false, reason: 'banned', user };
      await pool.execute(
        "UPDATE users SET ban_status = 'none', ban_reason = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
        [user.id]
      );
    }

    if (user.locked_until) {
      const now = Date.now();
      const lockExpiry = new Date(user.locked_until).getTime();
      if (lockExpiry > now) return { ok: false, reason: 'locked', user, lockedUntil: user.locked_until, retryMinutes: Math.ceil((lockExpiry - now) / 60000) };
      await pool.execute('UPDATE users SET locked_until = NULL WHERE id = ?', [user.id]);
    }

    if (!(await compare(password, user.password_hash))) {
      await audit({ user_id: user.id, action: 'login_failed', ip_address: ipAddress, user_agent: userAgent, details: { reason: 'invalid_password' } });
      const failKey = `login_fail:${user.id}:${ipAddress}`;
      const failCount = await redis.incr(failKey);
      if (failCount === 1) await redis.expire(failKey, 300);

      if (failCount >= 5) {
        const newLevel = (user.lock_level || 0) + 1;
        const lockMinutes = newLevel === 1 ? 15 : newLevel === 2 ? 60 : 120;
        const lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
        await pool.execute('UPDATE users SET lock_level = ?, locked_until = ? WHERE id = ?', [newLevel, lockedUntil, user.id]);
        await redis.del(failKey);
        const duration = lockMinutes >= 60 ? `锁定${lockMinutes / 60}小时` : `锁定${lockMinutes}分钟`;
        await notify.create({ user_id: user.id, type: 'account_locked', title: '账号已被锁定', content: `连续登录失败次数过多，账号已被${duration}`, sendEmail: true });
        await audit({ user_id: user.id, action: 'account_locked', ip_address: ipAddress, user_agent: userAgent, details: { lock_level: newLevel, duration } });
      }
      return { ok: false, reason: 'credentials', user };
    }

    await redis.del(`login_fail:${user.id}:${ipAddress}`);
    if (user.lock_level > 0) await pool.execute('UPDATE users SET lock_level = 0 WHERE id = ?', [user.id]);
    return { ok: true, user };
  };
}

module.exports = { createPasswordLogin, authenticatePassword: createPasswordLogin() };
