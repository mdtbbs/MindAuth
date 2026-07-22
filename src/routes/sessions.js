const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const { logUserAudit } = require('../utils/userAudit');
const { getClientIp } = require('../utils/request');
const sessionManager = require('../modules/sessions/sessionManager');

// GET /sessions - Get current user's active sessions
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentToken = req.cookies.session;
    const currentTokenHash = sessionManager.hashToken(currentToken);

    const sessions = await sessionManager.listUserSessions(req.user.id, currentTokenHash);

    res.json({
      success: true,
      sessions,
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

    // Determine if this is the current session (for audit log + cookie clearing)
    const currentToken = req.cookies.session;
    const currentTokenHash = sessionManager.hashToken(currentToken);
    const sessions = await sessionManager.listUserSessions(req.user.id, currentTokenHash);
    const target = sessions.find(s => s.id === sessionId);

    if (!target) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    const isCurrentSession = target.is_current;

    // Revoke via sessionManager (clears MySQL, Redis cache, and index set)
    await sessionManager.revokeUserSession({ sessionId, userId: req.user.id });

    // If the user terminated their current session, clear the cookie
    if (isCurrentSession) {
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
