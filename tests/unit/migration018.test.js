const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../src/db/migrations/018_international_locales_and_ecosystems.sql'),
  'utf8',
);

describe('migration 018 ecosystem compatibility', () => {
  it('defaults legacy clients to mdtbbs and only backfills blank ecosystems', () => {
    assert.match(migration, /ADD COLUMN ecosystem VARCHAR\(32\) NOT NULL DEFAULT 'mdtbbs'/);
    assert.match(migration, /UPDATE clients SET ecosystem = 'mdtbbs' WHERE ecosystem IS NULL OR ecosystem = ''/);
  });

  it('does not alter existing approval, first-party, or secret state', () => {
    assert.doesNotMatch(migration, /UPDATE clients\s+SET\s+(?:status|party_type|client_secret)\s*=/i);
  });
});
