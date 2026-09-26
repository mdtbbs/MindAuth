const { domainToASCII } = require('node:url');
const { pool } = require('../../db');
const { client } = require('../../redis');

const SNAPSHOT_KEY = 'email_policy:snapshot:v1';
const REDIS_TTL_SECONDS = 30;
const LOCAL_TTL_MS = 1000;
let localSnapshot = null;
let localLoadedAt = 0;

function normalizeDomain(value) {
  if (typeof value !== 'string') throw new Error('邮箱域名格式无效');
  let domain = value.trim().replace(/^@+/, '').toLowerCase().replace(/\.+$/, '');
  domain = domainToASCII(domain);
  if (!domain || domain.length > 253 || domain.includes('@') || domain.includes('..')
    || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    throw new Error('邮箱域名格式无效');
  }
  return domain;
}

function getEmailDomain(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at < 1 || at === normalized.length - 1) return null;
  try { return normalizeDomain(normalized.slice(at + 1)); } catch { return null; }
}

function ruleMatches(rule, domain) {
  if (rule.match_type === 'exact') return domain === rule.pattern;
  return rule.match_type === 'suffix' && (domain === rule.pattern || domain.endsWith(`.${rule.pattern}`));
}

function evaluateEmailPolicy(email, { rules = [], allowlistMode = false } = {}) {
  const domain = getEmailDomain(email);
  if (!domain) return { allowed: false, code: 'INVALID_EMAIL', matchedRule: null };
  const matches = rules.filter(rule => rule.enabled !== false && Number(rule.enabled) !== 0 && ruleMatches(rule, domain));
  const denied = matches.find(rule => rule.policy === 'deny');
  if (denied) return { allowed: false, code: 'EMAIL_DOMAIN_BLOCKED', domain, matchedRule: denied };
  if (allowlistMode) {
    const allowed = matches.find(rule => rule.policy === 'allow');
    if (!allowed) return { allowed: false, code: 'EMAIL_DOMAIN_BLOCKED', domain, matchedRule: null };
    return { allowed: true, domain, matchedRule: allowed };
  }
  return { allowed: true, domain, matchedRule: matches.find(rule => rule.policy === 'allow') || null };
}

async function loadSnapshotFromDatabase() {
  const [[rules], [configs]] = await Promise.all([
    pool.execute('SELECT id, match_type, pattern, policy, reason, enabled FROM email_domain_rules WHERE enabled = 1'),
    pool.execute("SELECT `value` FROM system_config WHERE `key` = 'email_allowlist_mode' LIMIT 1"),
  ]);
  return { rules, allowlistMode: configs[0]?.value === '1' };
}

async function getSnapshot() {
  if (localSnapshot && Date.now() - localLoadedAt < LOCAL_TTL_MS) return localSnapshot;
  try {
    const cached = await client.get(SNAPSHOT_KEY);
    if (cached) {
      localSnapshot = JSON.parse(cached);
      localLoadedAt = Date.now();
      return localSnapshot;
    }
  } catch { /* Redis is an optional shared cache; MySQL remains authoritative. */ }

  const snapshot = await loadSnapshotFromDatabase();
  localSnapshot = snapshot;
  localLoadedAt = Date.now();
  try { await client.setEx(SNAPSHOT_KEY, REDIS_TTL_SECONDS, JSON.stringify(snapshot)); } catch { /* best effort */ }
  return snapshot;
}

async function invalidateCache() {
  localSnapshot = null;
  localLoadedAt = 0;
  try { await client.del(SNAPSHOT_KEY); } catch { /* local TTL bounds stale reads if Redis is unavailable */ }
}

async function checkEmail(email, { purpose = 'register', override = false, userId = null, ipAddress = null } = {}) {
  if (override) return { allowed: true, overridden: true, purpose };
  const snapshot = await getSnapshot();
  const result = evaluateEmailPolicy(email, snapshot);
  if (result.matchedRule?.id) {
    // Hit counters are updated by a targeted indexed row update, never by a scan.
    pool.execute('UPDATE email_domain_rules SET hit_count = hit_count + 1, last_hit_at = CURRENT_TIMESTAMP WHERE id = ?', [result.matchedRule.id])
      .catch(err => console.warn('[EmailPolicy] Hit counter update failed:', err.message));
  }
  if (!result.allowed && result.domain) {
    pool.execute('INSERT INTO email_policy_events (rule_id, user_id, email_domain, purpose, ip_address) VALUES (?, ?, ?, ?, ?)',
      [result.matchedRule?.id || null, userId, result.domain, purpose, ipAddress])
      .catch(err => console.warn('[EmailPolicy] Event write failed:', err.message));
  }
  return { ...result, purpose };
}

async function listRules({ search, policy, enabled } = {}) {
  const where = [];
  const params = [];
  if (search) { where.push('(pattern LIKE ? OR reason LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (policy === 'allow' || policy === 'deny') { where.push('policy = ?'); params.push(policy); }
  if (enabled === 'true' || enabled === 'false') { where.push('enabled = ?'); params.push(enabled === 'true' ? 1 : 0); }
  const [rows] = await pool.execute(
    `SELECT id, match_type, pattern, policy, reason, enabled, hit_count, last_hit_at, created_by, created_at, updated_at
     FROM email_domain_rules ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT 500`, params,
  );
  return rows;
}

function normalizeRule(input) {
  const matchType = input.match_type || 'exact';
  const policy = input.policy || 'deny';
  if (!['exact', 'suffix'].includes(matchType)) throw new Error('匹配方式必须是 exact 或 suffix');
  if (!['allow', 'deny'].includes(policy)) throw new Error('策略必须是 allow 或 deny');
  return {
    match_type: matchType,
    pattern: normalizeDomain(input.pattern),
    policy,
    reason: typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) || null : null,
    enabled: input.enabled === undefined ? 1 : (input.enabled ? 1 : 0),
  };
}

async function createRule(input, createdBy) {
  const rule = normalizeRule(input);
  const [result] = await pool.execute(
    'INSERT INTO email_domain_rules (match_type, pattern, policy, reason, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [rule.match_type, rule.pattern, rule.policy, rule.reason, rule.enabled, createdBy],
  );
  await invalidateCache();
  return result.insertId;
}

async function updateRule(id, input) {
  const rule = normalizeRule(input);
  const [result] = await pool.execute(
    'UPDATE email_domain_rules SET match_type = ?, pattern = ?, policy = ?, reason = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [rule.match_type, rule.pattern, rule.policy, rule.reason, rule.enabled, id],
  );
  if (result.affectedRows) await invalidateCache();
  return result.affectedRows > 0;
}

async function deleteRule(id) {
  const [result] = await pool.execute('DELETE FROM email_domain_rules WHERE id = ?', [id]);
  if (result.affectedRows) await invalidateCache();
  return result.affectedRows > 0;
}

async function getMode() {
  const snapshot = await getSnapshot();
  return { allowlist_mode: snapshot.allowlistMode };
}

async function setMode(enabled) {
  await pool.execute("UPDATE system_config SET `value` = ?, updated_at = CURRENT_TIMESTAMP WHERE `key` = 'email_allowlist_mode'", [enabled ? '1' : '0']);
  await invalidateCache();
  return { allowlist_mode: Boolean(enabled) };
}

module.exports = {
  normalizeDomain, getEmailDomain, ruleMatches, evaluateEmailPolicy,
  checkEmail, listRules, normalizeRule, createRule, updateRule, deleteRule,
  getMode, setMode, invalidateCache,
};
