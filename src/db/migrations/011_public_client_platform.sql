-- Public Client Platform foundation. Existing OAuth clients stay confidential
-- and approved so server-side integrations continue to work after migration.
ALTER TABLE clients
  MODIFY COLUMN client_secret VARCHAR(255) NULL,
  ADD COLUMN description TEXT NULL AFTER name,
  ADD COLUMN website_url VARCHAR(2048) NULL AFTER description,
  ADD COLUMN client_type ENUM('confidential', 'public') NOT NULL DEFAULT 'confidential' AFTER client_secret,
  ADD COLUMN party_type ENUM('first_party', 'third_party') NOT NULL DEFAULT 'third_party' AFTER client_type,
  ADD COLUMN status ENUM('draft', 'pending', 'approved', 'rejected', 'suspended') NOT NULL DEFAULT 'approved' AFTER party_type,
  ADD COLUMN owner_user_id INT NULL AFTER status,
  ADD COLUMN requested_scopes JSON NULL AFTER owner_user_id,
  ADD COLUMN approved_scopes JSON NULL AFTER requested_scopes,
  ADD COLUMN approved_at DATETIME NULL AFTER approved_scopes,
  ADD COLUMN approved_by INT NULL AFTER approved_at,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD INDEX idx_clients_owner_status (owner_user_id, status),
  ADD INDEX idx_clients_status (status),
  ADD CONSTRAINT fk_clients_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_public_client_requires_pkce CHECK (client_type <> 'public' OR (client_secret IS NULL AND require_pkce = 1));

UPDATE clients
SET requested_scopes = JSON_ARRAY('openid', 'profile', 'email'),
    approved_scopes = JSON_ARRAY('openid', 'profile', 'email'),
    status = 'approved'
WHERE requested_scopes IS NULL OR approved_scopes IS NULL;

-- The long-standing server-side MindFourm resource-server credential is trusted
-- to introspect tokens issued to other approved clients. Public clients never
-- receive this party classification through self-service registration.
UPDATE clients SET party_type = 'first_party' WHERE client_id = 'forum' AND client_type = 'confidential';

CREATE TABLE IF NOT EXISTS oauth_client_redirect_uris (
  id INT AUTO_INCREMENT PRIMARY KEY,
  oauth_client_id INT NOT NULL,
  redirect_uri VARCHAR(500) NOT NULL,
  redirect_type ENUM('web', 'loopback', 'custom_scheme') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_oauth_client_redirect_uri (oauth_client_id, redirect_uri),
  INDEX idx_oauth_client_redirect_type (oauth_client_id, redirect_type),
  CONSTRAINT fk_oauth_redirect_client FOREIGN KEY (oauth_client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO oauth_client_redirect_uris (oauth_client_id, redirect_uri, redirect_type)
SELECT id,
       redirect_uri,
       CASE
         WHEN redirect_uri REGEXP '^http://(127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?/' THEN 'loopback'
         WHEN redirect_uri REGEXP '^[a-zA-Z][a-zA-Z0-9+.-]*://' AND redirect_uri NOT LIKE 'http://%' AND redirect_uri NOT LIKE 'https://%' THEN 'custom_scheme'
         ELSE 'web'
       END
FROM clients
WHERE redirect_uri IS NOT NULL AND redirect_uri <> '';
