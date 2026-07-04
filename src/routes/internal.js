const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireServiceKey = require('../middleware/requireServiceKey');

function mapUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    email_verified: user.email_verified === 1 || user.email_verified === true,
    avatar_url: user.avatar_url,
    phone_verified: user.phone_verified === 1 || user.phone_verified === true,
    phone_verified_at: user.phone_verified_at,
    ban_status: user.ban_status || 'none',
    is_muted: user.ban_status === 'muted',
    created_at: user.created_at,
  };
}

router.use(requireServiceKey);

router.get('/users/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid user id' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, email, email_verified, avatar_url, phone_verified, phone_verified_at, ban_status, created_at FROM users WHERE id = ?',
      [userId]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, user: mapUser(rows[0]) });
  } catch (err) {
    console.error('[Internal] get user failed:', err);
    return res.status(500).json({ success: false, message: 'Failed to get user' });
  }
});

module.exports = router;
