/**
 * XenForo 2 Account Linking Routes
 *
 * Endpoints:
 * - GET /xenforo/link - Start OAuth flow
 * - GET /xenforo/callback - Handle OAuth callback
 * - GET /xenforo/status - Get linking status
 * - DELETE /xenforo/link - Unlink account
 * - POST /xenforo/sync - Sync avatar and user group
 * - GET /xenforo/config/status - Check if linking is enabled
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { client } = require('../redis');
const { generateShortToken } = require('../utils/token');
const requireAuth = require('../middleware/requireAuth');
const config = require('../config');
const {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  fetchUserInfo,
  downloadAvatar
} = require('../utils/xenforo-client');

const STATE_TTL = 300; // 5 minutes in seconds

/**
 * Get XenForo configuration from database
 */
async function getXenForoConfig() {
  const [rows] = await pool.execute('SELECT * FROM xenforo_config WHERE id = 1');
  return rows[0];
}

/**
 * Get external identity for a user
 */
async function getExternalIdentity(userId, provider = 'xenforo') {
  const [rows] = await pool.execute(
    'SELECT * FROM external_identities WHERE user_id = ? AND provider = ?',
    [userId, provider]
  );
  return rows[0];
}

/**
 * Check if XenForo account is already linked to another user
 */
async function isXenForoAccountLinked(externalUserId, provider = 'xenforo') {
  const [rows] = await pool.execute(
    'SELECT user_id FROM external_identities WHERE provider = ? AND external_user_id = ?',
    [provider, externalUserId]
  );
  return rows[0];
}

/**
 * Build redirect URI for OAuth callback
 */
function buildRedirectUri() {
  const baseUrl = config.server.baseUrl || `http://localhost:${config.server.port}`;
  return `${baseUrl}/api/xenforo/callback`;
}

// GET /xenforo/config/status - Public endpoint to check if linking is enabled
router.get('/xenforo/config/status', async (req, res) => {
  try {
    const xfConfig = await getXenForoConfig();

    if (!xfConfig || !xfConfig.enabled) {
      return res.json({
        enabled: false,
        reason: 'XenForo 账号关联功能未启用'
      });
    }

    if (!xfConfig.base_url || !xfConfig.client_id) {
      return res.json({
        enabled: false,
        reason: 'XenForo 配置不完整'
      });
    }

    res.json({
      enabled: true,
      base_url: xfConfig.base_url,
      sync_avatar: xfConfig.sync_avatar,
      sync_user_group: xfConfig.sync_user_group
    });
  } catch (err) {
    console.error('XenForo config status error:', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// GET /xenforo/link - Start OAuth flow, redirect to XenForo
router.get('/xenforo/link', requireAuth, async (req, res) => {
  try {
    const xfConfig = await getXenForoConfig();

    if (!xfConfig || !xfConfig.enabled) {
      return res.status(503).json({ success: false, message: 'XenForo 账号关联功能未启用' });
    }

    // Check if already linked
    const existingLink = await getExternalIdentity(req.user.id);
    if (existingLink) {
      return res.status(400).json({ success: false, message: '您的账号已关联 XenForo 账号' });
    }

    // Generate state token for CSRF protection
    const state = generateShortToken();

    // Store state in Redis with user_id
    await client.setEx(`xf_state:${state}`, STATE_TTL, JSON.stringify({
      user_id: req.user.id,
      created_at: Date.now()
    }));

    // Build authorization URL
    const redirectUri = buildRedirectUri();
    const authUrl = buildAuthorizationUrl(
      xfConfig.base_url,
      xfConfig.client_id,
      redirectUri,
      state
    );

    // Redirect to XenForo
    res.redirect(authUrl);
  } catch (err) {
    console.error('XenForo link start error:', err);
    res.redirect(`/#/dashboard?xf_error=${encodeURIComponent('关联处理失败')}`);
  }
});

// GET /xenforo/callback - Handle OAuth callback from XenForo
router.get('/xenforo/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth error from XenForo
    if (error) {
      const errorMsg = req.query.error_description || error;
      return res.redirect(`/#/dashboard?xf_error=${encodeURIComponent(errorMsg)}`);
    }

    if (!code || !state) {
      return res.redirect(`/#/dashboard?xf_error=${encodeURIComponent('缺少必要参数')}`);
    }

    // Verify state token from Redis
    const stateDataStr = await client.get(`xf_state:${state}`);
    if (!stateDataStr) {
      return res.redirect(`/#/dashboard?xf_error=${encodeURIComponent('验证失败，请重新关联')}`);
    }

    const stateData = JSON.parse(stateDataStr);
    const userId = stateData.user_id;

    // Delete state token (single use)
    await client.del(`xf_state:${state}`);

    // Get XenForo config
    const xfConfig = await getXenForoConfig();
    if (!xfConfig || !xfConfig.enabled) {
      return res.redirect(`/#/dashboard?xf_error=${encodeURIComponent('XenForo 关联功能已禁用')}`);
    }

    // Exchange code for token
    const redirectUri = buildRedirectUri();
    const tokenData = await exchangeCodeForToken(
      xfConfig.base_url,
      xfConfig.client_id,
      xfConfig.client_secret,
      code,
      redirectUri
    );

    // Fetch user info from XenForo
    const userInfo = await fetchUserInfo(xfConfig.base_url, tokenData.access_token);

    // Check if this XenForo account is already linked to another user
    const existingLink = await isXenForoAccountLinked(userInfo.user_id);
    if (existingLink && existingLink.user_id !== userId) {
      return res.redirect(`/#/dashboard?xf_error=${encodeURIComponent('此 XenForo 账号已被其他用户关联')}`);
    }

    // Check if current user already has a XenForo link (race condition protection)
    const userLink = await getExternalIdentity(userId);
    if (userLink && userLink.external_user_id !== userInfo.user_id) {
      return res.redirect(`/#/dashboard?xf_error=${encodeURIComponent('您的账号已关联其他 XenForo 账号')}`);
    }

    // Download avatar if sync is enabled
    let avatarUrl = null;
    if (xfConfig.sync_avatar && userInfo.avatar_urls) {
      avatarUrl = await downloadAvatar(userInfo.avatar_urls, userInfo.user_id, xfConfig.base_url);
    }

    // Insert or update external identity
    if (existingLink && existingLink.user_id === userId) {
      // Update existing link
      await pool.execute(`
        UPDATE external_identities
        SET external_username = ?,
            external_email = ?,
            external_avatar_url = ?,
            external_user_group_id = ?,
            external_is_admin = ?,
            external_is_moderator = ?,
            provider_data = ?
        WHERE user_id = ? AND provider = 'xenforo'
      `, [
        userInfo.username,
        userInfo.email,
        avatarUrl,
        userInfo.user_group_id,
        userInfo.is_admin ? 1 : 0,
        userInfo.is_moderator ? 1 : 0,
        JSON.stringify({
          avatar_urls: userInfo.avatar_urls,
          secondary_group_ids: userInfo.secondary_group_ids,
          is_staff: userInfo.is_staff,
          user_state: userInfo.user_state,
          custom_fields: userInfo.custom_fields,
          profile_banner_urls: userInfo.profile_banner_urls
        }),
        userId
      ]);
    } else {
      // Insert new link
      await pool.execute(`
        INSERT INTO external_identities
        (user_id, provider, external_user_id, external_username, external_email,
         external_avatar_url, external_user_group_id, external_is_admin, external_is_moderator, provider_data)
        VALUES (?, 'xenforo', ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        userId,
        userInfo.user_id,
        userInfo.username,
        userInfo.email,
        avatarUrl,
        userInfo.user_group_id,
        userInfo.is_admin ? 1 : 0,
        userInfo.is_moderator ? 1 : 0,
        JSON.stringify({
          avatar_urls: userInfo.avatar_urls,
          secondary_group_ids: userInfo.secondary_group_ids,
          is_staff: userInfo.is_staff,
          user_state: userInfo.user_state,
          custom_fields: userInfo.custom_fields,
          profile_banner_urls: userInfo.profile_banner_urls
        })
      ]);
    }

    // Update user's avatar_url if sync_avatar is enabled and avatar was downloaded
    if (xfConfig.sync_avatar && avatarUrl) {
      await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, userId]);
    }

    // Redirect to success page
    res.redirect(`/#/dashboard?xf_success=${encodeURIComponent(`成功关联 XenForo 账号: ${userInfo.username}`)}`);
  } catch (err) {
    console.error('XenForo callback error:', err);
    res.redirect(`/#/dashboard?xf_error=${encodeURIComponent('关联处理失败')}`);
  }
});

// GET /xenforo/status - Get current user's XenForo linking status
router.get('/xenforo/status', requireAuth, async (req, res) => {
  try {
    const identity = await getExternalIdentity(req.user.id);

    if (!identity) {
      return res.json({
        linked: false,
        message: '未关联 XenForo 账号'
      });
    }

    const xfConfig = await getXenForoConfig();

    res.json({
      linked: true,
      external_user_id: identity.external_user_id,
      external_username: identity.external_username,
      external_avatar_url: identity.external_avatar_url,
      external_user_group_id: identity.external_user_group_id,
      external_is_admin: identity.external_is_admin,
      external_is_moderator: identity.external_is_moderator,
      linked_at: identity.linked_at,
      sync_enabled: xfConfig ? {
        avatar: xfConfig.sync_avatar,
        user_group: xfConfig.sync_user_group
      } : null
    });
  } catch (err) {
    console.error('XenForo status error:', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// DELETE /xenforo/link - Unlink XenForo account
router.delete('/xenforo/link', requireAuth, async (req, res) => {
  try {
    const identity = await getExternalIdentity(req.user.id);

    if (!identity) {
      return res.status(404).json({ success: false, message: '未关联 XenForo 账号' });
    }

    // Delete external identity
    await pool.execute('DELETE FROM external_identities WHERE user_id = ? AND provider = ?', [req.user.id, 'xenforo']);

    // Note: We don't delete the synced avatar from users table on unlink
    // User may want to keep the avatar even after unlinking

    res.json({ success: true, message: '已取消 XenForo 账号关联' });
  } catch (err) {
    console.error('XenForo unlink error:', err);
    res.status(500).json({ success: false, message: '取消关联失败' });
  }
});

// POST /xenforo/sync - Manually sync avatar and user group
router.post('/xenforo/sync', requireAuth, async (req, res) => {
  try {
    const identity = await getExternalIdentity(req.user.id);

    if (!identity) {
      return res.status(404).json({ success: false, message: '未关联 XenForo 账号' });
    }

    const xfConfig = await getXenForoConfig();
    if (!xfConfig || !xfConfig.enabled) {
      return res.status(503).json({ success: false, message: 'XenForo 关联功能未启用' });
    }

    // Get stored provider data
    const providerData = identity.provider_data ? JSON.parse(identity.provider_data) : {};

    // Re-download avatar if sync_avatar is enabled
    let avatarUrl = null;
    if (xfConfig.sync_avatar && providerData.avatar_urls) {
      avatarUrl = await downloadAvatar(providerData.avatar_urls, identity.external_user_id, xfConfig.base_url);
      if (avatarUrl) {
        // Update external identity avatar
        await pool.execute('UPDATE external_identities SET external_avatar_url = ? WHERE id = ?', [avatarUrl, identity.id]);
        // Update user's avatar
        await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.user.id]);
      }
    }

    res.json({
      success: true,
      message: '同步完成',
      synced: {
        avatar: avatarUrl ? true : false,
        avatar_url: avatarUrl
      }
    });
  } catch (err) {
    console.error('XenForo sync error:', err);
    res.status(500).json({ success: false, message: '同步失败' });
  }
});

module.exports = router;