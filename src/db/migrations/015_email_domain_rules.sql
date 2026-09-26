-- Central email-domain policy. Rules are normalized by EmailPolicyService;
-- one allow and one deny rule for the same matcher may coexist intentionally.
CREATE TABLE IF NOT EXISTS email_domain_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_type ENUM('exact', 'suffix') NOT NULL DEFAULT 'exact',
  pattern VARCHAR(253) NOT NULL,
  policy ENUM('allow', 'deny') NOT NULL DEFAULT 'deny',
  reason VARCHAR(500) DEFAULT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  hit_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_hit_at DATETIME DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_email_domain_rule (match_type, pattern, policy),
  INDEX idx_email_domain_rules_active (enabled, match_type, pattern),
  INDEX idx_email_domain_rules_policy (policy, enabled),
  INDEX idx_email_domain_rules_created (created_at),
  CONSTRAINT fk_email_domain_rules_admin FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Operational events retain the affected domain and request context without
-- storing the complete email address or any verification material.
CREATE TABLE IF NOT EXISTS email_policy_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_id BIGINT UNSIGNED DEFAULT NULL,
  user_id INT DEFAULT NULL,
  email_domain VARCHAR(253) NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_policy_events_created (created_at),
  INDEX idx_email_policy_events_ip_created (ip_address, created_at),
  INDEX idx_email_policy_events_rule_created (rule_id, created_at),
  CONSTRAINT fk_email_policy_events_rule FOREIGN KEY (rule_id) REFERENCES email_domain_rules(id) ON DELETE SET NULL,
  CONSTRAINT fk_email_policy_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default mode permits every address except those matched by deny rules.
INSERT INTO system_config (`key`, `value`, description)
VALUES ('email_allowlist_mode', '0', 'Email policy: only allow explicitly matched domains')
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);
