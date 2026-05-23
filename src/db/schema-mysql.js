const { pool } = require('./pool');

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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_users_session (session_token),
        INDEX idx_users_role (role),
        INDEX idx_users_email_verified (email_verified),
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

    console.log('MySQL schema initialized successfully');
  } finally {
    conn.release();
  }
}

module.exports = { initSchema };