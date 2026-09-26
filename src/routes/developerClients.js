const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const registry = require('../modules/admin/clientRegistry');

const router = express.Router();
const createLimiter = createRateLimiter({ maxAttempts: 10, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:developer_client_create' });
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const applications = await registry.listOwnerApplications(req.user.id);
    res.json({ success: true, applications });
  } catch (error) {
    console.error('List developer applications failed:', error.message);
    res.status(500).json({ success: false, message: '获取应用列表失败' });
  }
});

router.post('/', createLimiter, async (req, res) => {
  try {
    const application = await registry.createOwnerApplication(req.user.id, req.body || {});
    res.status(201).json({ success: true, application });
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, ...(error.code ? { code: error.code } : {}), message: error.message || '创建应用失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await registry.updateOwnerApplication(req.user.id, Number(req.params.id), req.body || {});
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === '应用不存在' ? 404 : 400).json({ success: false, message: error.message || '更新应用失败' });
  }
});

router.post('/:id/submit', async (req, res) => {
  try {
    await registry.submitOwnerApplication(req.user.id, Number(req.params.id));
    res.json({ success: true, status: 'approved' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || '提交审核失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await registry.deleteOwnerApplication(req.user.id, Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.message === '应用不存在' ? 404 : 400).json({ success: false, message: error.message || '删除应用失败' });
  }
});

router.post('/:id/deactivate', async (req, res) => {
  try {
    const result = await registry.deactivateOwnerApplication(req.user.id, Number(req.params.id));
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.message === '应用不存在' ? 404 : 400).json({ success: false, message: error.message || '停用应用失败' });
  }
});

module.exports = router;
