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

    // SMS config table (single-row config)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS sms_config (
        id INT PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        access_key_id VARCHAR(255) NOT NULL DEFAULT '',
        access_key_secret VARCHAR(255) NOT NULL DEFAULT '',
        sign_name VARCHAR(255) NOT NULL DEFAULT '',
        template_code VARCHAR(100) NOT NULL DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT chk_sms_single_row CHECK (id = 1)
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

    // Ensure one row exists in sms_config
    await conn.execute(`INSERT IGNORE INTO sms_config (id) VALUES (1)`);

    // Insert default system configurations
    const defaultConfigs = [
      ['session_lifetime_days', '30', 'Session有效期（天）'],
      ['password_min_length', '6', '密码最小长度'],
      ['password_require_complexity', '0', '是否要求密码复杂度（0/1）'],
      ['registration_enabled', '1', '是否允许新用户注册（0/1）'],
      ['sms_audit_retention_days', '365', '短信审计日志保留天数'],
      ['audit_retention_days', '365', '管理审计日志保留天数']
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

    // --- Account lockout columns ---
    try {
      await conn.execute('ALTER TABLE users ADD COLUMN lock_level INT NOT NULL DEFAULT 0');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.warn('Could not add lock_level:', alterErr.message);
    }
    try {
      await conn.execute('ALTER TABLE users ADD COLUMN locked_until DATETIME DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.warn('Could not add locked_until:', alterErr.message);
    }

    // --- User ban/mute columns ---
    try {
      await conn.execute("ALTER TABLE users ADD COLUMN ban_status VARCHAR(10) NOT NULL DEFAULT 'none'");
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.warn('Could not add ban_status:', alterErr.message);
    }
    try {
      await conn.execute('ALTER TABLE users ADD COLUMN ban_reason VARCHAR(500) DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.warn('Could not add ban_reason:', alterErr.message);
    }
    try {
      await conn.execute('ALTER TABLE users ADD COLUMN banned_by INT DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.warn('Could not add banned_by:', alterErr.message);
    }
    try {
      await conn.execute('ALTER TABLE users ADD COLUMN ban_expires_at DATETIME DEFAULT NULL');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.warn('Could not add ban_expires_at:', alterErr.message);
    }

    // --- User sessions table ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        session_token VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        device_info VARCHAR(200),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_token (session_token),
        INDEX idx_sessions_active (last_active_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- Challenge questions table ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS challenge_questions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        question VARCHAR(500) NOT NULL,
        answer_hash VARCHAR(255) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_challenge_enabled (enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- IP bans table (supports CIDR) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ip_bans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip_address VARCHAR(45) NOT NULL,
        cidr_prefix INT DEFAULT NULL,
        reason VARCHAR(500) DEFAULT NULL,
        banned_by INT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME DEFAULT NULL,
        INDEX idx_ip_bans_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- User notifications table ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT DEFAULT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        ip_address VARCHAR(45) DEFAULT NULL,
        user_agent VARCHAR(200) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notifications_user_read (user_id, is_read),
        INDEX idx_notifications_created (created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- User fields definition table ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_fields (
        id INT AUTO_INCREMENT PRIMARY KEY,
        field_key VARCHAR(50) NOT NULL,
        field_label VARCHAR(100) NOT NULL,
        field_type VARCHAR(20) NOT NULL DEFAULT 'text',
        is_required TINYINT(1) NOT NULL DEFAULT 0,
        is_public TINYINT(1) NOT NULL DEFAULT 1,
        options JSON DEFAULT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_fields_key (field_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- User field values table ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_field_values (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        field_id INT NOT NULL,
        value TEXT DEFAULT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_field_values (user_id, field_id),
        INDEX idx_field_values_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (field_id) REFERENCES user_fields(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- Admin audit logs table ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        target_type VARCHAR(50) DEFAULT NULL,
        target_id INT DEFAULT NULL,
        details JSON DEFAULT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_admin (admin_id),
        INDEX idx_audit_action (action),
        INDEX idx_audit_target (target_type, target_id),
        INDEX idx_audit_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- User audit logs table (security events only) ---
    // Records security-relevant actions by regular users: login failures,
    // password changes, session terminations, etc. Low-frequency by design;
    // high-frequency events (login success, OAuth grants) live in dedicated tables.
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS user_audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        user_agent VARCHAR(500) DEFAULT NULL,
        details JSON DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_audit_user (user_id),
        INDEX idx_user_audit_action (action),
        INDEX idx_user_audit_created (created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- PKCE support for OAuth clients (RFC 7636) ---
    // When require_pkce = 1, /authorize must include code_challenge and
    // /token must include code_verifier. Opt-in per client for backward
    // compatibility with existing integrations.
    try {
      await conn.execute('ALTER TABLE clients ADD COLUMN require_pkce TINYINT(1) NOT NULL DEFAULT 0');
    } catch (alterErr) {
      if (alterErr.code !== 'ER_DUP_FIELDNAME') console.warn('Could not add require_pkce:', alterErr.message);
    }

    // --- Email verification tokens (Redis fallback) ---
    // When Redis restarts, pending verification tokens are lost. This table
    // acts as a durable fallback: verify endpoints check Redis first, then
    // fall back to this table. Expired rows are cleaned up by cleanup.js.
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token VARCHAR(128) PRIMARY KEY,
        user_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email_tokens_user (user_id),
        INDEX idx_email_tokens_expires (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

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
          [admin.username, admin.email, passwordHash, 'super_admin', 1]
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
      name: 'MindFourm',
      client_id: 'forum',
      client_secret: 'forum_secret_key_for_development',
      redirect_uri: 'http://localhost:4000/api/auth/callback'
    },
    {
      name: 'MindFourm (Test)',
      client_id: '6d875cc521f1c60ba17dd53c7b9edc5a',
      client_secret: '35d820f46aa6a1b330258d3af5b60b3c0094719acebcb149fc03d96cdf8f99f1',
      redirect_uri: 'http://localhost:4000/api/auth/callback'
    },
    // EasyManager — 暂停中，保留以便恢复
    // {
    //   name: 'EasyManager',
    //   client_id: 'easymanager',
    //   client_secret: 'easymanager_secret_key_2024_dev_only',
    //   redirect_uri: 'http://localhost:3001/api/auth/callback'
    // }
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
