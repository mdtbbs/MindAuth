const mysql = require('mysql2/promise');
const config = require('../../src/config');
const { validateConfig } = require('../../src/config/validate');

const TEST_DATABASE_PATTERN = /^(?:test_.+|.+_test)$/;

async function main() {
  validateConfig(config);
  const database = config.mysql.database;
  if (!TEST_DATABASE_PATTERN.test(database)) {
    throw new Error('Refusing to prepare a non-test database');
  }

  const connection = await mysql.createConnection({
    ...(config.mysql.socketPath ? { socketPath: config.mysql.socketPath } : { host: config.mysql.host, port: config.mysql.port }),
    user: config.mysql.user || undefined,
    password: config.mysql.password || undefined,
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }

  const { pool, closePool, runMigrations, seedTestFixtures } = require('../../src/db');
  try {
    await runMigrations(pool);
    await seedTestFixtures(pool);
    console.log(`Prepared test database: ${database}`);
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(`Test database preparation failed: ${err.message}`);
  process.exit(1);
});
