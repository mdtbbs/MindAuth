const express = require('express');
const registry = require('../modules/admin/clientRegistry');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const applications = await registry.listPublicApplications();
    res.json({ success: true, applications });
  } catch (error) {
    console.error('List public applications failed:', error.message);
    res.status(500).json({ success: false, message: '获取应用目录失败' });
  }
});

router.get('/:clientId', async (req, res) => {
  try {
    const application = await registry.getPublicApplication(req.params.clientId);
    if (!application) return res.status(404).json({ success: false, message: '应用不存在' });
    res.json({ success: true, application });
  } catch (error) {
    console.error('Get public application failed:', error.message);
    res.status(500).json({ success: false, message: '获取应用信息失败' });
  }
});

module.exports = router;
