-- First-party MDTBBS Android native authentication.  No usable credential is
-- stored in these tables: authorization codes and SMS codes are HMAC digests.
CREATE TABLE IF NOT EXISTS native_auth_clients (
  client_id VARCHAR(100) PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  allowed_methods JSON NOT NULL,
  pkce_required TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO native_auth_clients (client_id, enabled, allowed_methods, pkce_required)
VALUES ('mdtbbs_android', 1, JSON_ARRAY('password', 'sms', 'qq'), 1);

CREATE TABLE IF NOT EXISTS native_auth_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(80) NOT NULL UNIQUE,
  client_id VARCHAR(100) NOT NULL,
  code_challenge VARCHAR(128) NOT NULL,
  code_challenge_method VARCHAR(10) NOT NULL,
  user_id INT DEFAULT NULL,
  status ENUM('PENDING','AUTHORIZED','EXPIRED','CANCELLED','CONSUMED') NOT NULL DEFAULT 'PENDING',
  selected_method VARCHAR(20) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  authorized_at DATETIME DEFAULT NULL,
  consumed_at DATETIME DEFAULT NULL,
  INDEX idx_native_transactions_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS native_sms_challenges (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(80) NOT NULL UNIQUE,
  transaction_id BIGINT NOT NULL,
  phone_hash CHAR(64) NOT NULL,
  code_digest CHAR(64) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_native_sms_transaction (transaction_id),
  INDEX idx_native_sms_expiry (expires_at),
  FOREIGN KEY (transaction_id) REFERENCES native_auth_transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS native_authorization_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code_digest CHAR(64) NOT NULL UNIQUE,
  client_id VARCHAR(100) NOT NULL,
  user_id INT NOT NULL,
  transaction_id BIGINT NOT NULL,
  code_challenge VARCHAR(128) NOT NULL,
  auth_method VARCHAR(20) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_native_codes_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES native_auth_transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS native_phone_challenges (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(80) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  ticket_id_hash CHAR(64) NOT NULL,
  phone_hash CHAR(64) NOT NULL,
  code_digest CHAR(64) NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  INDEX idx_native_phone_user (user_id),
  INDEX idx_native_phone_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS native_auth_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT DEFAULT NULL,
  user_id INT DEFAULT NULL,
  client_id VARCHAR(100) NOT NULL,
  event VARCHAR(80) NOT NULL,
  method VARCHAR(20) DEFAULT NULL,
  result_code VARCHAR(80) DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_native_audit_transaction (transaction_id),
  INDEX idx_native_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
