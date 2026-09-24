require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  console.error('Database migrations require NODE_ENV=production');
  process.exit(1);
}

const config = require('../src/config');
const { validateConfig } = require('../src/config/validate');
const { pool, closePool, runMigrations } = require('../src/db');
const { migrateSensitiveConfig } = require('../src/utils/secrets');

async function main() {
  try {
    validateConfig(config);
    const applied = await runMigrations(pool);
    const migratedSecrets = await migrateSensitiveConfig(pool);
    console.log(`Migration preflight complete (${applied.length} schema migration(s), ${migratedSecrets} secret record(s) migrated)`);
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('Migration preflight failed:', error.message);
  process.exitCode = 1;
});
