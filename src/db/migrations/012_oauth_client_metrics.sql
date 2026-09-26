-- Bounded, per-day OAuth usage and error aggregates for the developer center.
-- Never store request bodies, authorization codes, access tokens or refresh tokens.
CREATE TABLE IF NOT EXISTS oauth_client_daily_metrics (
  client_id VARCHAR(255) NOT NULL,
  metric_date DATE NOT NULL,
  request_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  error_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at DATETIME NULL,
  last_error_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  PRIMARY KEY (client_id, metric_date),
  INDEX idx_oauth_client_metrics_date (metric_date),
  CONSTRAINT fk_oauth_client_metrics_client FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
