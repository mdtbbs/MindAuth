const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { generateToken, generateShortToken } = require('../../utils/token');
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');
const { logAudit } = require('../../utils/auditLog');
const config = require('../../config');

// Rate limiter for client creation
const clientCreateLimiter = createRateLimiter(config.adminSecurity.clientCreate);

/**
 * Check if a hostname/IP is a private/internal address
 * Blocks SSRF attacks targeting internal services
 * @param {string} hostname - Hostname or IP to check
 * @returns {boolean} True if private/internal
 */
function isPrivateOrInternalHost(hostname) {
  // Normalize hostname
  const host = hostname.toLowerCase().trim();

  // Block localhost variants
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];
  if (blockedHosts.includes(host)) {
    return true;
  }

  // Check for localhost-like patterns
  if (host.endsWith('.localhost') || host.endsWith('.local') || host === 'local') {
    return true;
  }

  // Check private IP ranges (RFC 1918)
  // 10.0.0.0 - 10.255.255.255
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  // 172.16.0.0 - 172.31.255.255
  const match172 = /^172\.(16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (match172) {
    return true;
  }

  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  // 169.254.0.0 - 169.254.255.255 (Link-local)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }

  // Block internal metadata endpoints (AWS, GCP, Azure)
  const metadataHosts = ['metadata.google.internal', '169.254.169.254'];
  if (metadataHosts.includes(host)) {
    return true;
  }

  return false;
}

// GET /clients - Get all clients
router.get('/', requireAdmin, requireAdminPermission('clients.read'), async (req, res) => {
  try {
    const [clients] = await pool.execute('SELECT id, name, client_id, redirect_uri, created_at FROM clients');
    res.json({ success: true, clients });
  } catch (err) {
    console.error('Get clients error:', err);
    res.status(500).json({ success: false, message: '获取客户端列表失败' });
  }
});

// POST /clients - Create client (rate limited)
router.post('/', requireAdmin, requireAdminPermission('clients.write'), clientCreateLimiter, async (req, res) => {
  try {
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    // Validate redirect_uri format and security
    try {
      const url = new URL(redirect_uri);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return res.status(400).json({ success: false, message: '回调地址必须使用 http 或 https 协议' });
      }

      // SSRF protection: block private/internal IP addresses
      if (isPrivateOrInternalHost(url.hostname)) {
        return res.status(400).json({
          success: false,
          message: '回调地址不能使用内部网络地址或 localhost'
        });
      }
    } catch {
      return res.status(400).json({ success: false, message: '回调地址格式不正确' });
    }

    const clientId = generateShortToken();
    const clientSecret = generateToken();

    await pool.execute('INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)', [name, clientId, clientSecret, redirect_uri]);
    await logAudit({ admin_id: req.adminUser.id, action: 'client.create', target_type: 'client', details: { name, client_id: clientId }, ip_address: getClientIp(req) });
    res.status(201).json({ success: true, client_id: clientId, client_secret: clientSecret });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

// DELETE /clients/:id - Delete client
router.delete('/:id', requireAdmin, requireAdminPermission('clients.write'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM clients WHERE id = ?', [id]);
    await logAudit({ admin_id: req.adminUser.id, action: 'client.delete', target_type: 'client', target_id: parseInt(id), ip_address: getClientIp(req) });
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
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    // Validate redirect_uri format and security
    try {
      const url = new URL(redirect_uri);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return res.status(400).json({ success: false, message: '回调地址必须使用 http 或 https 协议' });
      }

      // SSRF protection: block private/internal IP addresses
      if (isPrivateOrInternalHost(url.hostname)) {
        return res.status(400).json({
          success: false,
          message: '回调地址不能使用内部网络地址或 localhost'
        });
      }
    } catch {
      return res.status(400).json({ success: false, message: '回调地址格式不正确' });
    }

    await pool.execute('UPDATE clients SET name = ?, redirect_uri = ? WHERE id = ?', [name, redirect_uri, id]);
    await logAudit({ admin_id: req.adminUser.id, action: 'client.update', target_type: 'client', target_id: parseInt(id), details: { name, redirect_uri }, ip_address: getClientIp(req) });
    res.json({ success: true });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

module.exports = router;
