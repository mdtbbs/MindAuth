const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('migration command refuses to run outside production mode', () => {
  const script = path.join(__dirname, '../../scripts/migrate.js');
  const result = spawnSync(process.execPath, [script], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /require NODE_ENV=production/);
});
