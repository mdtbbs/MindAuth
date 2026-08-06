const { pool, transaction } = require('../../db');
const sessionManager = require('../sessions/sessionManager');
const { logUserAudit } = require('../../utils/userAudit');

/**
 * 查找 QQ 绑定
 */
async function findByQq(openid) {
  const [rows] = await pool.execute(
    'SELECT * FROM social_accounts WHERE provider = ? AND provider_user_id = ? LIMIT 1',
    ['qq', openid]
  );
  return rows[0] || null;
}

/**
 * 获取用户
 */
async function getUserById(id) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

/**
 * 检查用户是否可以登录（封禁/锁定）
 *
 * @param {object} user - user record
 * @returns {{ allowed: boolean, error?: object }}
 */
async function checkLoginAllowed(user) {
  // 检查封禁状态
  if (user.ban_status === 'banned') {
    const isExpired = user.ban_expires_at && new Date(user.ban_expires_at) < new Date();
    if (isExpired) {
      // 封禁已过期，清除
      await pool.execute(
        "UPDATE users SET ban_status = 'none', ban_reason = NULL, banned_by = NULL, ban_expires_at = NULL WHERE id = ?",
        [user.id]
      );
    } else {
      return {
        allowed: false,
        error: {
          code: 'USER_BANNED',
          message: '账号已被封禁',
          ban_reason: user.ban_reason,
          ban_expires_at: user.ban_expires_at,
        },
      };
    }
  }

  // 检查锁定状态
  if (user.locked_until) {
    const lockExpiry = new Date(user.locked_until);
    if (lockExpiry > new Date()) {
      return {
        allowed: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: '账号已锁定',
          locked_until: user.locked_until,
          lock_level: user.lock_level,
        },
      };
    }
    // 锁定已过期，清除
    await pool.execute('UPDATE users SET locked_until = NULL WHERE id = ?', [user.id]);
  }

  return { allowed: true };
}

/**
 * 检查用户是否可以作为社交登录的最后登录方式
 * 如果 QQ 是唯一登录方式，禁止解绑
 */
async function canUnbindQq(userId) {
  const user = await getUserById(userId);
  if (!user) return false;

  // 检查用户是否有密码（主要登录方式）
  if (user.password_hash && user.password_hash.length > 0) {
    return true;
  }

  // 检查用户是否有其他社交绑定
  const [otherBindings] = await pool.execute(
    'SELECT COUNT(*) as count FROM social_accounts WHERE user_id = ? AND provider != ?',
    [userId, 'qq']
  );
  if (otherBindings[0].count > 0) {
    return true;
  }

  // QQ 是唯一登录方式，禁止解绑
  return false;
}

/**
 * 已绑定 QQ 登录
 *
 * @param {object} params
 * @param {string} params.openid - QQ openid
 * @param {string} [params.nickname] - QQ nickname
 * @param {string} [params.avatarUrl] - QQ avatar URL
 * @param {string} [params.ipAddress] - client IP
 * @param {string} [params.userAgent] - user agent
 * @returns {Promise<{ user: object, session: object } | null>}
 */
async function loginExisting({ openid, nickname, avatarUrl, ipAddress, userAgent }) {
  const binding = await findByQq(openid);
  if (!binding) return null;

  const user = await getUserById(binding.user_id);
  if (!user) throw new Error('SOCIAL_USER_NOT_FOUND');

  // 检查封禁/锁定
  const loginCheck = await checkLoginAllowed(user);
  if (!loginCheck.allowed) {
    throw Object.assign(new Error('SOCIAL_LOGIN_BLOCKED'), {
      code: loginCheck.error.code,
      details: loginCheck.error,
    });
  }

  // 更新绑定信息
  await pool.execute(
    'UPDATE social_accounts SET nickname = ?, avatar_url = ?, last_login_at = NOW() WHERE id = ?',
    [nickname || null, avatarUrl || null, binding.id]
  );

  // 创建 session
  const session = await sessionManager.createUserSession({
    userId: user.id,
    ipAddress,
    userAgent,
  });

  // 记录登录日志，类型为 social
  await pool.execute(
    'INSERT INTO login_logs (user_id, ip, device, login_type) VALUES (?, ?, ?, ?)',
    [user.id, ipAddress || '', (userAgent || '').slice(0, 200), 'social']
  );

  // 审计日志
  logUserAudit({
    user_id: user.id,
    action: 'social_login',
    ip_address: ipAddress,
    user_agent: userAgent,
    details: { provider: 'qq' },
  });

  return { user, session };
}

/**
 * 绑定 QQ 到用户
 *
 * @param {number} userId
 * @param {object} params
 * @param {string} params.openid - QQ openid
 * @param {string} [params.nickname] - QQ nickname
 * @param {string} [params.avatarUrl] - QQ avatar URL
 */
async function bindQq(userId, { openid, nickname, avatarUrl }) {
  const existing = await findByQq(openid);
  if (existing && existing.user_id !== userId) {
    throw Object.assign(new Error('SOCIAL_ALREADY_BOUND'), {
      code: 'QQ_ALREADY_BOUND_TO_OTHER',
      status: 409,
    });
  }
  if (existing) return existing;

  try {
    const [result] = await pool.execute(
      'INSERT INTO social_accounts (user_id, provider, provider_user_id, nickname, avatar_url) VALUES (?, ?, ?, ?, ?)',
      [userId, 'qq', openid, nickname || null, avatarUrl || null]
    );
    return { id: result.insertId, user_id: userId, provider: 'qq', provider_user_id: openid };
  } catch (err) {
    // 处理唯一约束冲突
    if (err.code === 'ER_DUP_ENTRY') {
      throw Object.assign(new Error('SOCIAL_ALREADY_BOUND'), {
        code: 'QQ_ALREADY_BOUND_TO_OTHER',
        status: 409,
      });
    }
    throw err;
  }
}

/**
 * 列出用户的所有社交绑定
 */
async function listBindings(userId) {
  const [rows] = await pool.execute(
    'SELECT id, provider, provider_user_id, nickname, avatar_url, created_at, last_login_at FROM social_accounts WHERE user_id = ? ORDER BY created_at',
    [userId]
  );
  return rows;
}

/**
 * 解绑 QQ
 *
 * @param {number} bindingId
 * @param {number} userId
 * @returns {Promise<boolean>} - 是否成功删除
 */
async function unbindQq(bindingId, userId) {
  return transaction(async (conn) => {
    // 查找绑定记录，验证归属
    const [rows] = await conn.execute(
      'SELECT * FROM social_accounts WHERE id = ? AND user_id = ? AND provider = ? LIMIT 1',
      [bindingId, userId, 'qq']
    );

    if (rows.length === 0) {
      throw Object.assign(new Error('BINDING_NOT_FOUND'), {
        code: 'BINDING_NOT_FOUND',
        status: 404,
      });
    }

    // 检查是否是唯一登录方式
    const [passwordRows] = await conn.execute(
      'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const hasPassword = passwordRows[0]?.password_hash && passwordRows[0].password_hash.length > 0;

    if (!hasPassword) {
      // 检查是否有其他社交绑定
      const [otherBindings] = await conn.execute(
        'SELECT COUNT(*) as count FROM social_accounts WHERE user_id = ? AND id != ?',
        [userId, bindingId]
      );
      if (otherBindings[0].count === 0) {
        throw Object.assign(new Error('CANNOT_UNBIND_LAST_LOGIN'), {
          code: 'CANNOT_UNBIND_LAST_LOGIN',
          message: 'QQ 是当前唯一登录方式，请先设置密码',
          status: 400,
        });
      }
    }

    // 删除绑定
    await conn.execute('DELETE FROM social_accounts WHERE id = ?', [bindingId]);

    return true;
  });
}

module.exports = {
  findByQq,
  loginExisting,
  bindQq,
  listBindings,
  unbindQq,
  checkLoginAllowed,
  canUnbindQq,
};
