const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../../src/db/migrations/019_multiplayer_application_metadata.sql'), 'utf8');

describe('migration 019 multiplayer application metadata', () => {
  it('adds requested and reviewed launcher capabilities disabled by default', () => {
    assert.match(migration, /launch_uri_approved TINYINT\(1\) NOT NULL DEFAULT 0/);
    assert.match(migration, /supports_presence_requested TINYINT\(1\) NOT NULL DEFAULT 0/);
    assert.match(migration, /supports_multiplayer_requested TINYINT\(1\) NOT NULL DEFAULT 0/);
    assert.match(migration, /supports_join_intent_requested TINYINT\(1\) NOT NULL DEFAULT 0/);
    assert.match(migration, /supports_join_intent TINYINT\(1\) NOT NULL DEFAULT 0/);
  });
});
