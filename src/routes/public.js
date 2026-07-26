const express = require('express');
const router = express.Router();
const runtimeConfig = require('../modules/config/runtimeConfig');
const { createRateLimiter } = require('../middleware/rateLimit');

const configLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 1000, keyPrefix: 'ratelimit:public_config' });

// GET /auth-page-config - Public config for the unauthenticated auth pages
// (login/register/...). Currently only the custom background image URL;
// empty config means the frontend falls back to the default CSS grid.
router.get('/auth-page-config', configLimiter, async (req, res) => {
  try {
    const backgroundUrl = await runtimeConfig.get('auth_background_url');
    // runtimeConfig has a 5-minute in-process cache; a short browser cache
    // keeps admin changes visible within a minute
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ success: true, background_url: backgroundUrl || null });
  } catch (err) {
    console.error('Auth page config error:', err);
    res.status(500).json({ success: false, message: '获取配置失败' });
  }
});

module.exports = router;
