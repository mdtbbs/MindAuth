const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/020_seed_official_lanlink_mod_client.sql'), 'utf8');

describe('migration 020 official LanLink Public Client', () => {
  it('seeds only the first-party PKCE client and its exact loopback callback', () => {
    assert.match(migration, /'lanlink-mindustry-mod'/);
    assert.match(migration, /'public',\s*'first_party',\s*'approved'/);
    assert.match(migration, /'http:\/\/127\.0\.0\.1:0\/oauth\/callback'/);
    assert.match(migration, /JSON_ARRAY\('openid', 'profile', 'friends\.read', 'presence\.read', 'presence\.write', 'multiplayer\.read', 'multiplayer\.write'\)/);
    assert.match(migration, /supports_presence, supports_multiplayer/);
    assert.match(migration, /require_pkce = 1/);
  });
});
