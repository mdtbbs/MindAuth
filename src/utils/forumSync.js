const { pool } = require('../db');

function getForumSyncConfig() {
  const baseUrl = process.env.MINDFORUM_API_URL || process.env.FORUM_API_URL;
  const serviceKey = process.env.MINDAUTH_SERVICE_KEY;

  if (!baseUrl || !serviceKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    serviceKey,
  };
}

function mapUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    email_verified: user.email_verified === 1 || user.email_verified === true,
    avatar_url: user.avatar_url,
    phone_verified: user.phone_verified === 1 || user.phone_verified === true,
    phone_verified_at: user.phone_verified_at,
    created_at: user.created_at,
  };
}

async function getUser(userId) {
  const [rows] = await pool.execute(
    'SELECT id, username, email, email_verified, avatar_url, phone_verified, phone_verified_at, created_at FROM users WHERE id = ?',
    [userId]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

async function notifyForumUserUpdated(userId) {
  const config = getForumSyncConfig();
  if (!config) {
    return;
  }

  const user = await getUser(userId);
  if (!user) {
    return;
  }

  const response = await fetch(`${config.baseUrl}/api/auth/internal/users/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': config.serviceKey,
    },
    body: JSON.stringify({ user }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Forum user sync failed: ${response.status} ${text}`);
  }
}

module.exports = { notifyForumUserUpdated };
