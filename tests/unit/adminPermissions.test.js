const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasAdminPermission, normalizeRole, ROLE_PERMISSIONS } = require('../../src/middleware/requireAdmin');

test('super_admin remains unrestricted and legacy admin normalizes to super_admin', () => {
  assert.equal(normalizeRole('admin'), 'super_admin');
  assert.equal(hasAdminPermission({ role: 'super_admin' }, 'email_rules.write'), true);
  assert.equal(hasAdminPermission({ role: 'admin' }, 'admins.write'), true);
  assert.deepEqual(ROLE_PERMISSIONS.super_admin, ['*']);
});

test('readonly_admin can read new operations pages but cannot mutate them', () => {
  const actor = { role: 'readonly_admin' };
  for (const permission of ['dashboard.read', 'sessions.read', 'email_rules.read', 'developers.read', 'security.read']) {
    assert.equal(hasAdminPermission(actor, permission), true, `${permission} should be readable`);
  }
  for (const permission of ['sessions.revoke', 'email_rules.write', 'developers.review', 'admins.write']) {
    assert.equal(hasAdminPermission(actor, permission), false, `${permission} must remain write-protected`);
  }
});

test('dedicated roles receive their expected operational permissions', () => {
  assert.equal(hasAdminPermission({ role: 'user_admin' }, 'authorizations.revoke'), true);
  assert.equal(hasAdminPermission({ role: 'user_admin' }, 'sessions.revoke'), true);
  assert.equal(hasAdminPermission({ role: 'security_admin' }, 'email_rules.write'), true);
  assert.equal(hasAdminPermission({ role: 'config_admin' }, 'developers.review'), true);
});
