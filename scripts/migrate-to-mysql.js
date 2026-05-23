/**
 * Migration script: SQLite to MySQL
 * 1. Creates MySQL schema
 * 2. Reads all data from users.db and inserts into MySQL
 */

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Check if SQLite file exists
const sqlitePath = path.join(__dirname, '../users.db');
const sqliteExists = fs.existsSync(sqlitePath);

if (!sqliteExists) {
  console.log('No SQLite database file found. Skipping migration.');
  process.exit(0);
}

// Load better-sqlite3
const Database = require('better-sqlite3');
const sqliteDb = new Database(sqlitePath);

async function createSchema(conn) {
  console.log('Creating MySQL schema...');

  // Users table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      session_token VARCHAR(255) DEFAULT NULL,
      email_verified TINYINT(1) DEFAULT 0,
      role VARCHAR(50) DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_users_session (session_token),
      INDEX idx_users_role (role),
      INDEX idx_users_email_verified (email_verified),
      INDEX idx_users_username (username),
      INDEX idx_users_email (email),
      INDEX idx_users_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Clients table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      client_id VARCHAR(255) UNIQUE NOT NULL,
      client_secret VARCHAR(255) NOT NULL,
      redirect_uri VARCHAR(500) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_clients_credentials (client_id, client_secret)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Authorizations table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS authorizations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      client_id VARCHAR(255) NOT NULL,
      scope VARCHAR(255) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_client (user_id, client_id),
      INDEX idx_authorizations_user (user_id),
      INDEX idx_authorizations_client (client_id),
      INDEX idx_authorizations_last_used (last_used_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Refresh tokens table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      client_id VARCHAR(255) NOT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_refresh_tokens_token (token),
      INDEX idx_refresh_tokens_user_client (user_id, client_id),
      INDEX idx_refresh_tokens_expires (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Login logs table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      ip VARCHAR(50) NOT NULL,
      device VARCHAR(255) DEFAULT '',
      login_type VARCHAR(20) DEFAULT 'web',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_login_logs_user (user_id),
      INDEX idx_login_logs_created (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Email config table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS email_config (
      id INT PRIMARY KEY,
      host VARCHAR(255) NOT NULL DEFAULT '',
      port INT NOT NULL DEFAULT 587,
      user VARCHAR(255) NOT NULL DEFAULT '',
      password VARCHAR(255) NOT NULL DEFAULT '',
      \`from\` VARCHAR(255) NOT NULL DEFAULT '',
      secure TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT chk_single_row CHECK (id = 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // System config table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS system_config (
      \`key\` VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Ensure one row exists in email_config
  await conn.execute(`INSERT IGNORE INTO email_config (id) VALUES (1)`);

  // Insert default system configurations
  const defaultConfigs = [
    ['session_lifetime_days', '30', 'Session有效期（天）'],
    ['password_min_length', '6', '密码最小长度'],
    ['password_require_complexity', '0', '是否要求密码复杂度（0/1）'],
    ['registration_enabled', '1', '是否允许新用户注册（0/1）']
  ];

  for (const [key, value, desc] of defaultConfigs) {
    await conn.execute(
      'INSERT IGNORE INTO system_config (`key`, value, description) VALUES (?, ?, ?)',
      [key, value, desc]
    );
  }

  console.log('Schema created successfully!\n');
}

async function migrate() {
  console.log('Starting SQLite to MySQL migration...\n');
  console.log('MySQL Config:');
  console.log(`  Host: ${process.env.MYSQL_HOST}`);
  console.log(`  Port: ${process.env.MYSQL_PORT}`);
  console.log(`  User: ${process.env.MYSQL_USER}`);
  console.log(`  Database: ${process.env.MYSQL_DATABASE}`);
  console.log('');

  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      multipleStatements: true
    });

    console.log('MySQL connection established successfully!\n');

    // Create schema first
    await createSchema(conn);

    // Migrate users table
    console.log('Migrating users...');
    const users = sqliteDb.prepare('SELECT * FROM users').all();
    for (const user of users) {
      await conn.execute(`
        INSERT INTO users (id, username, email, password_hash, session_token, email_verified, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE username = VALUES(username), email = VALUES(email)
      `, [user.id, user.username, user.email, user.password_hash, user.session_token, user.email_verified || 0, user.role || 'user', user.created_at]);
    }
    console.log(`  Migrated ${users.length} users`);

    // Migrate clients table
    console.log('Migrating clients...');
    const clients = sqliteDb.prepare('SELECT * FROM clients').all();
    for (const client of clients) {
      await conn.execute(`
        INSERT INTO clients (id, name, client_id, client_secret, redirect_uri, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name)
      `, [client.id, client.name, client.client_id, client.client_secret, client.redirect_uri, client.created_at]);
    }
    console.log(`  Migrated ${clients.length} clients`);

    // Migrate authorizations table
    console.log('Migrating authorizations...');
    const authorizations = sqliteDb.prepare('SELECT * FROM authorizations').all();
    for (const auth of authorizations) {
      await conn.execute(`
        INSERT INTO authorizations (id, user_id, client_id, scope, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE last_used_at = VALUES(last_used_at)
      `, [auth.id, auth.user_id, auth.client_id, auth.scope || '', auth.created_at, auth.last_used_at]);
    }
    console.log(`  Migrated ${authorizations.length} authorizations`);

    // Migrate refresh_tokens table
    console.log('Migrating refresh_tokens...');
    const refreshTokens = sqliteDb.prepare('SELECT * FROM refresh_tokens').all();
    for (const token of refreshTokens) {
      await conn.execute(`
        INSERT INTO refresh_tokens (id, user_id, client_id, token, expires_at, revoked, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE revoked = VALUES(revoked)
      `, [token.id, token.user_id, token.client_id, token.token, token.expires_at, token.revoked || 0, token.created_at]);
    }
    console.log(`  Migrated ${refreshTokens.length} refresh_tokens`);

    // Migrate login_logs table
    console.log('Migrating login_logs...');
    const loginLogs = sqliteDb.prepare('SELECT * FROM login_logs').all();
    for (const log of loginLogs) {
      await conn.execute(`
        INSERT INTO login_logs (id, user_id, ip, device, login_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [log.id, log.user_id, log.ip, log.device || '', log.login_type || 'web', log.created_at]);
    }
    console.log(`  Migrated ${loginLogs.length} login_logs`);

    // Migrate email_config table
    console.log('Migrating email_config...');
    const emailConfig = sqliteDb.prepare('SELECT * FROM email_config WHERE id = 1').get();
    if (emailConfig) {
      await conn.execute(`
        UPDATE email_config SET host = ?, port = ?, user = ?, password = ?, \`from\` = ?, secure = ?, updated_at = ?
        WHERE id = 1
      `, [emailConfig.host || '', emailConfig.port || 587, emailConfig.user || '', emailConfig.password || '', emailConfig.from || '', emailConfig.secure || 0, emailConfig.updated_at]);
      console.log('  Migrated email_config');
    }

    // Migrate system_config table
    console.log('Migrating system_config...');
    const systemConfigs = sqliteDb.prepare('SELECT * FROM system_config').all();
    for (const config of systemConfigs) {
      await conn.execute(`
        INSERT INTO system_config (\`key\`, value, description, updated_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE value = ?, description = ?, updated_at = ?
      `, [config.key, config.value, config.description, config.updated_at, config.value, config.description, config.updated_at]);
    }
    console.log(`  Migrated ${systemConfigs.length} system_config entries`);

    console.log('\nSkipping ephemeral tables (now in Redis):');
    console.log('  - auth_codes (5 min TTL in Redis)');
    console.log('  - admin_sessions (24 hour TTL in Redis)');
    console.log('  - password_reset_tokens (1 hour TTL in Redis)');
    console.log('  - email_verification_tokens (1 hour TTL in Redis)');

    // Validation
    console.log('\nValidating migration...');
    const [mysqlUserCount] = await conn.execute('SELECT COUNT(*) as count FROM users');
    const [mysqlClientCount] = await conn.execute('SELECT COUNT(*) as count FROM clients');
    const [mysqlAuthCount] = await conn.execute('SELECT COUNT(*) as count FROM authorizations');
    const [mysqlRefreshCount] = await conn.execute('SELECT COUNT(*) as count FROM refresh_tokens');
    const [mysqlLogCount] = await conn.execute('SELECT COUNT(*) as count FROM login_logs');

    console.log('\n========== Migration Summary ==========');
    console.log(`Users:           SQLite ${users.length} → MySQL ${mysqlUserCount[0].count}`);
    console.log(`Clients:         SQLite ${clients.length} → MySQL ${mysqlClientCount[0].count}`);
    console.log(`Authorizations:  SQLite ${authorizations.length} → MySQL ${mysqlAuthCount[0].count}`);
    console.log(`Refresh Tokens:  SQLite ${refreshTokens.length} → MySQL ${mysqlRefreshCount[0].count}`);
    console.log(`Login Logs:      SQLite ${loginLogs.length} → MySQL ${mysqlLogCount[0].count}`);
    console.log('========================================\n');

    if (mysqlUserCount[0].count === users.length) {
      console.log('✓ Migration completed successfully!');
    } else {
      console.error('WARNING: User count mismatch! Please verify data integrity.');
    }

  } catch (err) {
    console.error('Migration error:', err.message);
    if (err.code) {
      console.error('Error code:', err.code);
    }
    throw err;
  } finally {
    if (conn) {
      await conn.end();
    }
    sqliteDb.close();
  }
}

// Run migration
migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});