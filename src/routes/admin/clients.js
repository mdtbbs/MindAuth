const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const { generateToken, generateShortToken } = require('../../utils/token');
const { requireAdmin } = require('../../middleware/requireAdmin');

// GET /clients - Get all clients
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [clients] = await pool.execute('SELECT id, name, client_id, redirect_uri, created_at FROM clients');
    res.json({ success: true, clients });
  } catch (err) {
    console.error('Get clients error:', err);
    res.status(500).json({ success: false, message: '获取客户端列表失败' });
  }
});

// POST /clients - Create client
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    // Validate redirect_uri format
    try {
      const url = new URL(redirect_uri);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return res.status(400).json({ success: false, message: '回调地址必须使用 http 或 https 协议' });
      }
    } catch {
      return res.status(400).json({ success: false, message: '回调地址格式不正确' });
    }

    const clientId = generateShortToken();
    const clientSecret = generateToken();

    await pool.execute('INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)', [name, clientId, clientSecret, redirect_uri]);
    res.status(201).json({ success: true, client_id: clientId, client_secret: clientSecret });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

// DELETE /clients/:id - Delete client
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM clients WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// PUT /clients/:id - Update client
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, redirect_uri } = req.body;

    if (!name || !redirect_uri) {
      return res.status(400).json({ success: false, message: '名称和回调地址必填' });
    }

    await pool.execute('UPDATE clients SET name = ?, redirect_uri = ? WHERE id = ?', [name, redirect_uri, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

module.exports = router;