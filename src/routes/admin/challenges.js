const express = require('express');
const router = express.Router();
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { getClientIp } = require('../../utils/request');
const challengeManager = require('../../modules/challenges/challengeManager');
const auditWriter = require('../../modules/audit/auditWriter');

// GET /challenges - List all challenge questions
router.get('/', requireAdmin, requireAdminPermission('config.read'), async (req, res) => {
  try {
    const challenges = await challengeManager.listChallenges();
    res.json({ success: true, challenges });
  } catch (err) {
    console.error('[Admin] challenges list error:', err);
    res.status(500).json({ success: false, message: '获取题库失败' });
  }
});

// POST /challenges - Create a challenge question
router.post('/', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ success: false, message: '题目和答案必填' });
    }

    const result = await challengeManager.createChallenge(question, answer);

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'challenge.create', 'challenge', result.id,
      { question }, getClientIp(req),
    );

    res.json({ success: true, message: '题目已添加', id: result.id });
  } catch (err) {
    console.error('[Admin] challenge create error:', err);
    res.status(500).json({ success: false, message: '添加题目失败' });
  }
});

// PUT /challenges/:id - Update a challenge question
router.put('/:id', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const { question, answer } = req.body;

    if (!question && !answer) {
      return res.status(400).json({ success: false, message: '无更新内容' });
    }

    const result = await challengeManager.updateChallenge(parseInt(req.params.id), { question, answer });
    if (!result.updated) {
      return res.status(404).json({ success: false, message: '题目不存在' });
    }

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'challenge.update', 'challenge', parseInt(req.params.id),
      { question: !!question, answer: !!answer }, getClientIp(req),
    );

    res.json({ success: true, message: '题目已更新' });
  } catch (err) {
    console.error('[Admin] challenge update error:', err);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// DELETE /challenges/:id - Delete a challenge question
router.delete('/:id', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const result = await challengeManager.deleteChallenge(parseInt(req.params.id));
    if (!result.deleted) {
      return res.status(404).json({ success: false, message: '题目不存在' });
    }

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'challenge.delete', 'challenge', parseInt(req.params.id),
      null, getClientIp(req),
    );

    res.json({ success: true, message: '题目已删除' });
  } catch (err) {
    console.error('[Admin] challenge delete error:', err);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// PATCH /challenges/:id/toggle - Enable/disable a challenge question
router.patch('/:id/toggle', requireAdmin, requireAdminPermission('config.write'), async (req, res) => {
  try {
    const { enabled } = req.body;
    const result = await challengeManager.updateChallenge(parseInt(req.params.id), { enabled: !!enabled });
    if (!result.updated) {
      return res.status(404).json({ success: false, message: '题目不存在' });
    }

    await auditWriter.writeAdminAudit(
      req.adminUser.id, 'challenge.toggle', 'challenge', parseInt(req.params.id),
      { enabled: !!enabled }, getClientIp(req),
    );

    res.json({ success: true, message: enabled ? '已启用' : '已禁用' });
  } catch (err) {
    console.error('[Admin] challenge toggle error:', err);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

module.exports = router;
