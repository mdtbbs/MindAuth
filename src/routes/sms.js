const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const smsBinding = require('../modules/sms/smsBinding');

// POST /sms/send - Send SMS verification code
router.post('/send', requireAuth, async (req, res) => {
  const result = await smsBinding.sendCode(req.user, req.body?.phone, req);
  res.status(result.status || 200).json(result);
});

// POST /sms/verify - Verify SMS code and bind phone
router.post('/verify', requireAuth, async (req, res) => {
  const { phone, code } = req.body || {};
  const result = await smsBinding.verifyCode(req.user, phone, code, req);
  res.status(result.status || 200).json(result);
});

module.exports = router;
