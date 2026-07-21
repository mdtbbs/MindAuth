const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { client } = require('../redis');
const requireAuth = require('../middleware/requireAuth');
const { logUserAudit } = require('../utils/userAudit');
const { getClientIp } = require('../utils/request');

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

// DELETE /sessions/:id - Terminate a specific session (log out a device)
// Users can terminate any of their own sessions, including the current one.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ success: false, message: '无效的会话 ID' });
    }

    // Look up the session and ensure it belongs to the current user.
    const [rows] = await pool.execute(
      'SELECT id, session_token, ip_address, device_info FROM user_sessions WHERE id = ? AND user_id = ?',
      [sessionId, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }
    const target = rows[0];
    const currentToken = req.cookies.session;
    const isCurrentSession = target.session_token === currentToken;

    // Remove from MySQL first (atomic per-row).
    await pool.execute('DELETE FROM user_sessions WHERE id = ?', [sessionId]);

    // Invalidate Redis session cache so the next request on that device 401s.
    await client.del(`session:${target.session_token}`).catch(() => {});

    // If the user terminated their current session, also clear users.session_token
    // and the cookie so the response reflects the logout.
    if (isCurrentSession) {
      await pool.execute('UPDATE users SET session_token = NULL WHERE id = ?', [req.user.id]);
      res.clearCookie('session', { path: '/' });
    }

    logUserAudit({
      user_id: req.user.id,
      action: 'session_terminated',
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'],
      details: {
        terminated_current: isCurrentSession,
        target_ip: target.ip_address,
        target_device: target.device_info,
      },
    });

    res.json({
      success: true,
      message: isCurrentSession ? '当前会话已注销' : '会话已注销',
      terminated_current: isCurrentSession,
    });
  } catch (err) {
    console.error('[Sessions] terminate error:', err);
    res.status(500).json({ success: false, message: '注销会话失败' });
  }
});

module.exports = router;
