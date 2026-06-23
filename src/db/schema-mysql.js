const { pool } = require('./pool');
const bcrypt = require('bcrypt');

async function initSchema() {
  const conn = await pool.getConnection();
  try {
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
        avatar_url VARCHAR(500) DEFAULT NULL,
        banner_url VARCHAR(500) DEFAULT NULL,
        phone VARCHAR(20) DEFAULT NULL,
        phone_verified TINYINT(1) NOT NULL DEFAULT 0,
        phone_verified_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_users_session (session_token),
        INDEX idx_users_role (role),
        INDEX idx_users_email_verified (email_verified),
        UNIQUE KEY unique_users_phone (phone),
        INDEX idx_users_username (username),
        INDEX idx_users_email (email),
        INDEX idx_users_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Clients table (OAuth applications)
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

    // Authorizations table (user-approved OAuth clients)
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
        scope VARCHAR(255) DEFAULT 'openid profile email',
        expires_at DATETIME NOT NULL,
        revoked TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_refresh_tokens_token (token),
        INDEX idx_refresh_tokens_user_client (user_id, client_id),
        INDEX idx_refresh_tokens_expires (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add scope column if it doesn't exist (for existing databases)
    try {
      await conn.execute('ALTER TABLE refresh_tokens ADD COLUMN scope VARCHAR(255) DEFAULT \'openid profile email\'');
    } catch (alterErr) {
      // Column already exists, ignore error
      if (alterErr.code !== 'ER_DUP_FIELDNAME') {
        console.warn('Could not add scope column to refresh_tokens:', alterErr.message);
      }
    }

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

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS sms_audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT DEFAULT NULL,
        action VARCHAR(50) NOT NULL,
        phone_masked VARCHAR(20) DEFAULT NULL,
        success TINYINT(1) NOT NULL DEFAULT 0,
        code VARCHAR(80) DEFAULT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        user_agent VARCHAR(500) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sms_audit_user (user_id),
        INDEX idx_sms_audit_action (action),
        INDEX idx_sms_audit_created (created_at),
        INDEX idx_sms_audit_ip (ip_address)
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

    // External identities table (for account linking)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS external_identities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        provider VARCHAR(50) NOT NULL,
        external_user_id VARCHAR(255) NOT NULL,
        external_username VARCHAR(255) DEFAULT NULL,
        external_email VARCHAR(255) DEFAULT NULL,
        external_avatar_url VARCHAR(500) DEFAULT NULL,
        external_user_group_id INT DEFAULT NULL,
        external_is_admin TINYINT(1) DEFAULT 0,
        external_is_moderator TINYINT(1) DEFAULT 0,
        provider_data JSON DEFAULT NULL,
        linked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_provider (user_id, provider),
        UNIQUE KEY unique_provider_external (provider, external_user_id),
        INDEX idx_external_user (user_id),
        INDEX idx_external_provider (provider),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // XenForo config table (single-row config)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS xenforo_config (
        id INT PRIMARY KEY,
        base_url VARCHAR(255) NOT NULL DEFAULT '',
        client_id VARCHAR(255) NOT NULL DEFAULT '',
        client_secret VARCHAR(255) NOT NULL DEFAULT '',
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        sync_avatar TINYINT(1) NOT NULL DEFAULT 1,
        sync_user_group TINYINT(1) NOT NULL DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT chk_xenforo_single_row CHECK (id = 1)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Ensure one row exists in email_config
    await conn.execute(`INSERT IGNORE INTO email_config (id) VALUES (1)`);

    // Ensure one row exists in xenforo_config
    await conn.execute(`INSERT IGNORE INTO xenforo_config (id) VALUES (1)`);

    // Insert default system configurations
    const defaultConfigs = [
      ['session_lifetime_days', '30', 'Session有效期（天）'],
      ['password_min_length', '6', '密码最小长度'],
      ['password_require_complexity', '0', '是否要求密码复杂度（0/1）'],
      ['registration_enabled', '1', '是否允许新用户注册（0/1）'],
      ['sms_audit_retention_days', '365', '短信审计日志保留天数']
    ];

    for (const [key, value, desc] of defaultConfigs) {
      await conn.execute(
        'INSERT IGNORE INTO system_config (`key`, value, description) VALUES (?, ?, ?)',
        [key, value, desc]
      );
    }

    // Add composite indexes for stats queries (handle existing databases)
    try {
      await conn.execute('ALTER TABLE users ADD INDEX idx_users_stats (created_at, email_verified)');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_KEYNAME') {
        console.warn('Could not add idx_users_stats:', alterErr.message);
      }
    }

    try {
      await conn.execute('ALTER TABLE login_logs ADD INDEX idx_logs_stats (created_at, login_type)');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_KEYNAME') {
        console.warn('Could not add idx_logs_stats:', alterErr.message);
      }
    }

    // Add avatar_url and banner_url columns if they don't exist (for existing databases)
    try {
      await conn.execute('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') {
        console.warn('Could not add avatar_url:', alterErr.message);
      }
    }

    try {
      await conn.execute('ALTER TABLE users ADD COLUMN banner_url VARCHAR(500) DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') {
        console.warn('Could not add banner_url:', alterErr.message);
      }
    }

    try {
      await conn.execute('ALTER TABLE users ADD COLUMN phone VARCHAR(20) DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') {
        console.warn('Could not add phone:', alterErr.message);
      }
    }

    try {
      await conn.execute('ALTER TABLE users ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') {
        console.warn('Could not add phone_verified:', alterErr.message);
      }
    }

    try {
      await conn.execute('ALTER TABLE users ADD COLUMN phone_verified_at DATETIME DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') {
        console.warn('Could not add phone_verified_at:', alterErr.message);
      }
    }

    try {
      await conn.execute('ALTER TABLE users ADD UNIQUE KEY unique_users_phone (phone)');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_KEYNAME') {
        console.warn('Could not add unique_users_phone:', alterErr.message);
      }
    }

    console.log('MySQL schema initialized successfully');
  } finally {
    conn.release();
  }
}

// Seed test admin account for development/testing
async function seedTestAdmin() {
  const testAdmins = [
    { username: 'testadmin', email: 'testadmin@mindauth.local', password: 'AdminPass123' }
  ];

  for (const admin of testAdmins) {
    try {
      // Check if admin exists
      const [existing] = await pool.execute(
        'SELECT id FROM users WHERE username = ?',
        [admin.username]
      );

      if (existing.length === 0) {
        const passwordHash = await bcrypt.hash(admin.password, 10);
        await pool.execute(
          'INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, ?)',
          [admin.username, admin.email, passwordHash, 'admin', 1]
        );
        console.log(`Test admin '${admin.username}' created with password '${admin.password}'`);
      }
    } catch (err) {
      console.warn(`Could not seed admin '${admin.username}':`, err.message);
    }
  }
}

// Seed test OAuth client for OAuth flow tests
async function seedTestOAuthClient() {
  const testClients = [
    {
      name: 'MindFourm (Test)',
      client_id: '6d875cc521f1c60ba17dd53c7b9edc5a',
      client_secret: '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1',
      redirect_uri: 'http://localhost:4000/api/auth/callback'
    },
    {
      name: 'EasyManager',
      client_id: 'easymanager',
      client_secret: 'easymanager_secret_key_2024_dev_only',
      redirect_uri: 'http://localhost:3001/api/auth/callback'
    }
  ];

  for (const client of testClients) {
    try {
      const [existing] = await pool.execute(
        'SELECT id FROM clients WHERE client_id = ?',
        [client.client_id]
      );

      if (existing.length === 0) {
        await pool.execute(
          'INSERT INTO clients (name, client_id, client_secret, redirect_uri) VALUES (?, ?, ?, ?)',
          [client.name, client.client_id, client.client_secret, client.redirect_uri]
        );
        console.log(`Test OAuth client '${client.name}' created`);
      }
    } catch (err) {
      console.warn(`Could not seed OAuth client '${client.name}':`, err.message);
    }
  }
}

module.exports = { initSchema, seedTestAdmin, seedTestOAuthClient };
