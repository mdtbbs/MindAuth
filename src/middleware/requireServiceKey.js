const { timingSafeCompare } = require('../utils/crypto');

function requireServiceKey(req, res, next) {
  const expectedKey = process.env.MINDAUTH_SERVICE_KEY;
  const serviceKey = req.headers['x-service-key'];

  if (!expectedKey || !serviceKey || !timingSafeCompare(String(serviceKey), expectedKey)) {
    return res.status(403).json({ success: false, message: 'Unauthorized service' });
  }

  next();
}

module.exports = requireServiceKey;
