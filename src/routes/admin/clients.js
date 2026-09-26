const express = require('express');
const router = express.Router();
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');
const config = require('../../config');
const clientRegistry = require('../../modules/admin/clientRegistry');

// Rate limiter for client creation
const clientCreateLimiter = createRateLimiter(config.adminSecurity.clientCreate);

// GET /clients - Get all clients
router.get('/', requireAdmin, requireAdminPermission('clients.read'), async (req, res) => {
  try {
    const clients = await clientRegistry.listClients();
    res.json({ success: true, clients });
  } catch (err) {
    console.error('Get clients error:', err);
    res.status(500).json({ success: false, message: '获取客户端列表失败' });
  }
});

// POST /clients - Create client (rate limited)
router.post('/', requireAdmin, requireAdminPermission('clients.write'), clientCreateLimiter, async (req, res) => {
  try {
    const { name, redirect_uri, redirect_uris, require_pkce } = req.body;
    const uris = redirect_uris || (redirect_uri ? [redirect_uri] : []);

    if (!name || !uris.length) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    for (const uri of uris) {
      const validation = clientRegistry.validateRedirectUri(uri);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.error });
    }

    const result = await clientRegistry.createClient(
      { name, redirect_uri: uris[0], redirect_uris: uris, require_pkce },
      { adminId: req.adminUser.id, ipAddress: getClientIp(req) }
    );

    res.status(201).json({ success: true, client_id: result.client_id, client_secret: result.client_secret });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

router.patch('/:id/review', requireAdmin, requireAdminPermission('clients.write'), async (req, res) => {
  try {
    await clientRegistry.reviewClient(parseInt(req.params.id, 10),
      { status: req.body?.status, approvedScopes: req.body?.approved_scopes },
      { adminId: req.adminUser.id, ipAddress: getClientIp(req) });
    res.json({ success: true });
  } catch (err) {
    res.status(err.message === '客户端不存在' ? 404 : 400).json({ success: false, message: err.message || '审核操作失败' });
  }
});

// POST /clients/:id/rotate-secret - Rotate client secret
// Old secret is invalidated immediately; new secret is returned exactly once.
// Audit is written inside clientRegistry.rotateSecret.
router.post('/:id/rotate-secret', requireAdmin, requireAdminPermission('clients.write'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const client = await clientRegistry.getClient(id);
    if (!client) {
      return res.status(404).json({ success: false, message: '客户端不存在' });
    }

    const result = await clientRegistry.rotateSecret(
      id,
      { adminId: req.adminUser.id, ipAddress: getClientIp(req) }
    );

    res.json({ success: true, client_id: client.client_id, client_secret: result.client_secret });
  } catch (err) {
    console.error('Rotate client secret error:', err);
    res.status(500).json({ success: false, message: '轮换密钥失败' });
  }
});

// DELETE /clients/:id - Delete client
router.delete('/:id', requireAdmin, requireAdminPermission('clients.write'), async (req, res) => {
  try {
    const { id } = req.params;
    await clientRegistry.deleteClient(
      parseInt(id),
      { adminId: req.adminUser.id, ipAddress: getClientIp(req) }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// PUT /clients/:id - Update client
router.put('/:id', requireAdmin, requireAdminPermission('clients.write'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, redirect_uri, redirect_uris, require_pkce } = req.body;
    const uris = redirect_uris || (redirect_uri ? [redirect_uri] : []);

    if (!name || !uris.length) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    for (const uri of uris) {
      const validation = clientRegistry.validateRedirectUri(uri);
      if (!validation.valid) return res.status(400).json({ success: false, message: validation.error });
    }

    await clientRegistry.updateClient(
      parseInt(id),
      { name, redirect_uris: uris, require_pkce },
      { adminId: req.adminUser.id, ipAddress: getClientIp(req) }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

module.exports = router;
