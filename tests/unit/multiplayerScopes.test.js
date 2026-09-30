const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SCOPE_DESCRIPTIONS, VALID_SCOPES, normalizeScopes } = require('../../src/modules/oauth/scopes');

describe('MDTBBS LanLink social and multiplayer OAuth scopes', () => {
  const requested = [
    'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write',
  ];

  it('registers each scope as an explicit sensitive consent permission', () => {
    for (const scope of requested) {
      assert.ok(VALID_SCOPES.includes(scope), `${scope} should be valid`);
      assert.equal(SCOPE_DESCRIPTIONS[scope].sensitive, true);
      assert.ok(SCOPE_DESCRIPTIONS[scope].name);
      assert.ok(SCOPE_DESCRIPTIONS[scope].description);
    }
  });

  it('keeps existing forum and resource permissions intact and normalizes new scopes', () => {
    for (const scope of ['profile', 'forum.read', 'forum.write', 'resource.read', 'resource.download', 'resource.upload', 'notification.read']) {
      assert.ok(VALID_SCOPES.includes(scope), `${scope} should remain valid`);
    }
    assert.deepEqual(normalizeScopes('profile friends.read presence.write multiplayer.write unknown'),
      ['profile', 'friends.read', 'presence.write', 'multiplayer.write']);
  });

  it('keeps Native password login on its fixed legacy scope set', () => {
    const { LEGACY_NATIVE_SCOPES } = require('../../src/modules/oauth/scopes');
    assert.deepEqual(LEGACY_NATIVE_SCOPES, ['openid', 'profile', 'game_content']);
  });
});
