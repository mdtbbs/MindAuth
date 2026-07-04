const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireAuth = require('../middleware/requireAuth');

// GET /sessions - Get current user's active sessions
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentToken = req.cookies.session;
    const [rows] = await pool.execute(
      `SELECT id, session_token, ip_address, device_info, created_at, last_active_at
       FROM user_sessions WHERE user_id = ? ORDER BY last_active_at DESC`,
      [req.user.id]
    );

    res.json({
      success: true,
      sessions: rows.map((s) => ({
        id: s.id,
        ip_address: s.ip_address,
        device_info: s.device_info,
        is_current: s.session_token === currentToken,
        created_at: s.created_at,
        last_active_at: s.last_active_at,
      })),
    });
  } catch (err) {
    console.error('[Sessions] list error:', err);
    res.status(500).json({ success: false, message: '获取会话列表失败' });
  }
});

module.exports = router;
