const express = require('express');
const router = express.Router();
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');
const clientRegistry = require('../../modules/admin/clientRegistry');

const reviewLimiter = createRateLimiter({ maxAttempts: 30, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:admin_application_review' });

router.get('/', requireAdmin, requireAdminPermission('developers.read'), async (req, res) => {
  try {
    const clients = await clientRegistry.listClients();
    const applications = clients.filter(client => client.party_type === 'third_party' && client.status !== 'deleted');
    res.json({ success: true, applications });
  } catch (err) {
    console.error('List developer applications error:', err.message);
    res.status(500).json({ success: false, message: '获取应用申请失败' });
  }
});

router.patch('/:id/review', requireAdmin, requireAdminPermission('developers.review'), reviewLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, message: '应用 ID 无效' });
  try {
    await clientRegistry.reviewClient(id,
      { status: req.body?.status, approvedScopes: req.body?.approved_scopes, reviewReason: req.body?.review_reason },
      { adminId: req.adminUser.id, ipAddress: getClientIp(req) });
    res.json({ success: true });
  } catch (err) {
    const status = err.message === '客户端不存在' ? 404 : 400;
    res.status(status).json({ success: false, message: err.message || '应用审核失败' });
  }
});

module.exports = router;
