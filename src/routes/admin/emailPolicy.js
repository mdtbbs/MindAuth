const express = require('express');
const router = express.Router();
const { requireAdmin, requireAdminPermission } = require('../../middleware/requireAdmin');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getClientIp } = require('../../utils/request');
const auditWriter = require('../../modules/audit/auditWriter');
const emailPolicy = require('../../modules/emailPolicy/emailPolicyService');

const mutationLimiter = createRateLimiter({ maxAttempts: 60, windowMs: 60 * 60 * 1000, keyPrefix: 'ratelimit:admin_email_policy' });

router.get('/', requireAdmin, requireAdminPermission('email_rules.read'), async (req, res) => {
  try {
    const rules = await emailPolicy.listRules({
      search: typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : undefined,
      policy: req.query.policy,
      enabled: req.query.enabled,
    });
    const mode = await emailPolicy.getMode();
    res.json({ success: true, rules, ...mode });
  } catch (err) {
    console.error('[AdminEmailPolicy] List failed:', err.message);
    res.status(500).json({ success: false, message: '获取邮箱策略失败' });
  }
});

router.patch('/mode', requireAdmin, requireAdminPermission('email_rules.write'), mutationLimiter, async (req, res) => {
  if (typeof req.body?.allowlist_mode !== 'boolean') {
    return res.status(400).json({ success: false, message: 'allowlist_mode 必须是布尔值' });
  }
  try {
    const result = await emailPolicy.setMode(req.body.allowlist_mode);
    await auditWriter.writeAdminAudit(req.adminUser.id, 'email_policy.mode', 'email_policy', null,
      { allowlist_mode: result.allowlist_mode }, getClientIp(req));
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AdminEmailPolicy] Mode update failed:', err.message);
    res.status(500).json({ success: false, message: '更新邮箱策略模式失败' });
  }
});

router.post('/batch', requireAdmin, requireAdminPermission('email_rules.write'), mutationLimiter, async (req, res) => {
  const lines = typeof req.body?.patterns === 'string' ? req.body.patterns.split(/[\r\n,\t ]+/).filter(Boolean) : [];
  if (!lines.length || lines.length > 200) {
    return res.status(400).json({ success: false, message: '请提供 1 至 200 个邮箱域名' });
  }
  const unique = new Set();
  const invalid = [];
  for (const value of lines) {
    try { unique.add(emailPolicy.normalizeDomain(value)); }
    catch { invalid.push(value.slice(0, 80)); }
  }
  if (invalid.length) return res.status(400).json({ success: false, message: '部分邮箱域名格式无效', invalid });

  const created = [];
  const duplicates = [];
  try {
    for (const pattern of unique) {
      try {
        const id = await emailPolicy.createRule({ pattern, match_type: 'exact', policy: 'deny', enabled: true }, req.adminUser.id);
        created.push(id);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) duplicates.push(pattern);
        else throw err;
      }
    }
    await auditWriter.writeAdminAudit(req.adminUser.id, 'email_rule.batch_create', 'email_policy', null,
      { patterns: [...unique], created_count: created.length, duplicate_count: duplicates.length }, getClientIp(req));
    res.status(201).json({ success: true, created_count: created.length, duplicate_count: duplicates.length, duplicates });
  } catch (err) {
    console.error('[AdminEmailPolicy] Batch create failed:', err.message);
    res.status(500).json({ success: false, message: '批量添加邮箱规则失败' });
  }
});

router.post('/', requireAdmin, requireAdminPermission('email_rules.write'), mutationLimiter, async (req, res) => {
  try {
    const normalized = emailPolicy.normalizeRule(req.body || {});
    const id = await emailPolicy.createRule(normalized, req.adminUser.id);
    await auditWriter.writeAdminAudit(req.adminUser.id, 'email_rule.create', 'email_rule', id,
      { ...normalized }, getClientIp(req));
    res.status(201).json({ success: true, id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) return res.status(409).json({ success: false, message: '相同匹配方式和策略的域名规则已存在' });
    res.status(400).json({ success: false, message: err.message || '创建邮箱规则失败' });
  }
});

router.put('/:id', requireAdmin, requireAdminPermission('email_rules.write'), mutationLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, message: '规则 ID 无效' });
    const normalized = emailPolicy.normalizeRule(req.body || {});
    if (!await emailPolicy.updateRule(id, normalized)) return res.status(404).json({ success: false, message: '邮箱规则不存在' });
    await auditWriter.writeAdminAudit(req.adminUser.id, 'email_rule.update', 'email_rule', id,
      { ...normalized }, getClientIp(req));
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) return res.status(409).json({ success: false, message: '相同匹配方式和策略的域名规则已存在' });
    res.status(400).json({ success: false, message: err.message || '更新邮箱规则失败' });
  }
});

router.delete('/:id', requireAdmin, requireAdminPermission('email_rules.write'), mutationLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, message: '规则 ID 无效' });
  try {
    if (!await emailPolicy.deleteRule(id)) return res.status(404).json({ success: false, message: '邮箱规则不存在' });
    await auditWriter.writeAdminAudit(req.adminUser.id, 'email_rule.delete', 'email_rule', id, null, getClientIp(req));
    res.json({ success: true });
  } catch (err) {
    console.error('[AdminEmailPolicy] Delete failed:', err.message);
    res.status(500).json({ success: false, message: '删除邮箱规则失败' });
  }
});

module.exports = router;
