-- Device sessions for the first-party Mindustry Mod. OAuth tokens remain in
-- the shared refresh_tokens table; native_session_id only associates them with
-- one revocable device session.
CREATE TABLE IF NOT EXISTS native_client_sessions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  client_id VARCHAR(100) NOT NULL,
  device_id CHAR(36) NOT NULL,
  device_name VARCHAR(80) NOT NULL,
  ip_address VARCHAR(50) NOT NULL,
  user_agent VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME DEFAULT NULL,
  INDEX idx_native_sessions_user (user_id, revoked_at, last_active_at),
  INDEX idx_native_sessions_device (user_id, client_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE native_auth_clients
  ADD COLUMN token_audience_client_id VARCHAR(100) DEFAULT NULL;

ALTER TABLE refresh_tokens
  ADD COLUMN native_session_id BIGINT DEFAULT NULL,
  ADD INDEX idx_refresh_tokens_native_session (native_session_id, revoked);

ALTER TABLE login_logs
  ADD COLUMN client_id VARCHAR(100) DEFAULT NULL,
  ADD COLUMN device_id CHAR(36) DEFAULT NULL,
  ADD COLUMN device_name VARCHAR(80) DEFAULT NULL;

INSERT IGNORE INTO native_auth_clients (client_id, enabled, allowed_methods, pkce_required)
VALUES ('mdtbbs-mindustry-mod', 1, JSON_ARRAY('password', 'refresh', 'logout'), 0);

UPDATE native_auth_clients SET token_audience_client_id = 'forum'
WHERE client_id = 'mdtbbs-mindustry-mod' AND token_audience_client_id IS NULL;
