-- Self-service Public Clients also serve as developer application records.
-- New submissions remain non-authorizable until an administrator reviews them.
ALTER TABLE clients
  ADD COLUMN admin_review_note VARCHAR(1000) DEFAULT NULL,
  ADD INDEX idx_clients_application_review (party_type, status, created_at),
  ADD INDEX idx_clients_party_created (party_type, created_at);

ALTER TABLE authorizations
  ADD INDEX idx_authorizations_created (created_at);

ALTER TABLE login_logs
  ADD INDEX idx_login_logs_ip_created (ip, created_at);

ALTER TABLE user_audit_logs
  ADD INDEX idx_user_audit_action_created (action, created_at),
  ADD INDEX idx_user_audit_action_ip_created (action, ip_address, created_at);

ALTER TABLE admin_audit_logs
  ADD INDEX idx_admin_audit_action_created (action, created_at);

ALTER TABLE users
  ADD INDEX idx_users_ban_expires (ban_status, ban_expires_at),
  ADD INDEX idx_users_lock_expires (lock_level, locked_until);

ALTER TABLE native_client_sessions
  ADD INDEX idx_native_sessions_active (revoked_at, last_active_at);
