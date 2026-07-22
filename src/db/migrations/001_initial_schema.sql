-- 001_initial_schema.sql
-- Canonical MindAuth schema — fresh-install baseline.
-- Generated from src/db/schema-mysql.js (Tasks 1-3).
--
-- NOTE: users.session_token is DEPRECATED. Task 5 (session manager) will
--       remove all usage and drop this column in a later migration.

-- ─────────────────────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  -- DEPRECATED: session_token is no longer the source of truth for sessions.
  -- Kept temporarily for backward compatibility. Task 5 will remove all usage.
  session_token VARCHAR(255) DEFAULT NULL,
  email_verified TINYINT(1) DEFAULT 0,
  role VARCHAR(50) DEFAULT 'user',
  avatar_url VARCHAR(500) DEFAULT NULL,
  banner_url VARCHAR(500) DEFAULT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  phone_verified_at DATETIME DEFAULT NULL,
  lock_level INT NOT NULL DEFAULT 0,
  locked_until DATETIME DEFAULT NULL,
  ban_status VARCHAR(10) NOT NULL DEFAULT 'none',
  ban_reason VARCHAR(500) DEFAULT NULL,
  banned_by INT DEFAULT NULL,
  ban_expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_session (session_token),
  INDEX idx_users_role (role),
  INDEX idx_users_email_verified (email_verified),
  UNIQUE KEY unique_users_phone (phone),
  INDEX idx_users_username (username),
  INDEX idx_users_email (email),
  INDEX idx_users_created (created_at),
  INDEX idx_users_stats (created_at, email_verified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- clients (OAuth applications)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  client_id VARCHAR(255) UNIQUE NOT NULL,
  client_secret VARCHAR(255) NOT NULL,
  redirect_uri VARCHAR(500) NOT NULL,
  require_pkce TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_clients_credentials (client_id, client_secret)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- authorizations (user-approved OAuth clients)
-- ─────────────────────────────────────────────────────────────
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- refresh_tokens
-- ─────────────────────────────────────────────────────────────
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
  INDEX idx_refresh_tokens_revoked (user_id, client_id, revoked),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- login_logs
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  ip VARCHAR(50) NOT NULL,
  device VARCHAR(255) DEFAULT '',
  login_type VARCHAR(20) DEFAULT 'web',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_logs_user (user_id),
  INDEX idx_login_logs_created (created_at),
  INDEX idx_login_logs_user_created (user_id, created_at),
  INDEX idx_logs_stats (created_at, login_type),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- email_config (single-row SMTP settings)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_config (
  id INT PRIMARY KEY,
  host VARCHAR(255) NOT NULL DEFAULT '',
  port INT NOT NULL DEFAULT 587,
  user VARCHAR(255) NOT NULL DEFAULT '',
  password VARCHAR(255) NOT NULL DEFAULT '',
  `from` VARCHAR(255) NOT NULL DEFAULT '',
  secure TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- sms_config (single-row SMS provider settings)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_config (
  id INT PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  access_key_id VARCHAR(255) NOT NULL DEFAULT '',
  access_key_secret VARCHAR(255) NOT NULL DEFAULT '',
  sign_name VARCHAR(255) NOT NULL DEFAULT '',
  template_code VARCHAR(100) NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_sms_single_row CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- system_config (key-value runtime settings)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
  `key` VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- user_sessions
-- ─────────────────────────────────────────────────────────────
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- challenge_questions
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question VARCHAR(500) NOT NULL,
  answer_hash VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_challenge_enabled (enabled),
  INDEX idx_challenge_enabled_id (enabled, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- ip_bans (supports CIDR)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ip_bans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  cidr_prefix INT DEFAULT NULL,
  reason VARCHAR(500) DEFAULT NULL,
  banned_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME DEFAULT NULL,
  INDEX idx_ip_bans_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- user_notifications
-- ─────────────────────────────────────────────────────────────
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
  INDEX idx_notifications_user_read_created (user_id, is_read, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- user_fields (custom field definitions)
-- ─────────────────────────────────────────────────────────────
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- user_field_values
-- ─────────────────────────────────────────────────────────────
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- admin_audit_logs
-- ─────────────────────────────────────────────────────────────
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- user_audit_logs (security events by regular users)
-- ─────────────────────────────────────────────────────────────
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- email_verification_tokens (Redis fallback)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token VARCHAR(128) PRIMARY KEY,
  user_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_tokens_user (user_id),
  INDEX idx_email_tokens_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- sms_audit_logs
-- ─────────────────────────────────────────────────────────────
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────
-- Default seed rows (config tables)
-- ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO email_config (id) VALUES (1);
INSERT IGNORE INTO sms_config (id) VALUES (1);

INSERT IGNORE INTO system_config (`key`, value, description) VALUES
  ('session_lifetime_days', '30', 'Session有效期（天）'),
  ('password_min_length', '6', '密码最小长度'),
  ('password_require_complexity', '0', '是否要求密码复杂度（0/1）'),
  ('registration_enabled', '1', '是否允许新用户注册（0/1）'),
  ('sms_audit_retention_days', '365', '短信审计日志保留天数'),
  ('audit_retention_days', '365', '管理审计日志保留天数');
