-- Social login provider bindings
CREATE TABLE IF NOT EXISTS social_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  nickname VARCHAR(255) DEFAULT NULL,
  avatar_url VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_social_provider_user (provider, provider_user_id),
  UNIQUE KEY unique_user_provider (user_id, provider),
  INDEX idx_social_user (user_id),
  CONSTRAINT fk_social_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
