const { test } = require('node:test');
const assert = require('node:assert/strict');

const { splitStatements, discoverMigrations } = require('../../src/db/migrator');

test('splitStatements: splits simple statements by semicolon', () => {
  const result = splitStatements('SELECT 1; SELECT 2;');
  assert.deepStrictEqual(result, ['SELECT 1', 'SELECT 2']);
});

test('splitStatements: ignores semicolons inside single-quoted strings', () => {
  const result = splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;");
  assert.equal(result.length, 2);
  assert.ok(result[0].includes("'a;b'"));
  assert.equal(result[1], 'SELECT 1');
});

test('splitStatements: skips line comments', () => {
  const sql = `
    -- this is a comment
    SELECT 1;
    -- another comment
    SELECT 2;
  `;
  const result = splitStatements(sql);
  assert.equal(result.length, 2);
  assert.equal(result[0], 'SELECT 1');
  assert.equal(result[1], 'SELECT 2');
});

test('splitStatements: skips block comments', () => {
  const sql = `
    /* block comment */
    SELECT 1;
    SELECT /* inline */ 2;
  `;
  const result = splitStatements(sql);
  assert.equal(result.length, 2);
});

test('splitStatements: handles trailing statement without semicolon', () => {
  const result = splitStatements('SELECT 1; SELECT 2');
  assert.deepStrictEqual(result, ['SELECT 1', 'SELECT 2']);
});

test('splitStatements: handles empty input', () => {
  const result = splitStatements('');
  assert.deepStrictEqual(result, []);
});

test('splitStatements: handles escaped quotes in strings', () => {
  const result = splitStatements("INSERT INTO t VALUES ('it\\'s'); SELECT 1;");
  assert.equal(result.length, 2);
});

test('splitStatements: handles backtick-quoted identifiers', () => {
  const result = splitStatements('SELECT `col`; INSERT INTO `db`.`table` VALUES (1);');
  assert.equal(result.length, 2);
  assert.ok(result[1].includes('`db`.`table`'));
});

test('discoverMigrations: finds 001_initial_schema.sql', () => {
  const migrations = discoverMigrations();
  assert.ok(migrations.length >= 1, 'Should find at least 1 migration');
  assert.equal(migrations[0].version, 1);
  assert.equal(migrations[0].name, '001_initial_schema');
  assert.ok(migrations[0].file.endsWith('001_initial_schema.sql'));
});

test('discoverMigrations: returns migrations in numeric order', () => {
  const migrations = discoverMigrations();
  for (let i = 1; i < migrations.length; i++) {
    assert.ok(migrations[i].version > migrations[i - 1].version);
  }
});
