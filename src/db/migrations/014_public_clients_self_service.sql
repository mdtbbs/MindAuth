-- Self-service public clients are immediately usable. Keep rejected and
-- suspended applications unchanged so prior administrative decisions remain.
ALTER TABLE clients
  MODIFY COLUMN status ENUM('draft', 'pending', 'approved', 'rejected', 'suspended', 'deleted') NOT NULL DEFAULT 'approved',
  ADD INDEX idx_clients_public_catalog (client_type, party_type, status, created_at);

-- Only auto-activate existing third-party rows that already meet the current
-- Public Client security contract. Historical validation allowed public HTTP
-- callbacks, so those rows remain untouched for an owner/admin to repair.
UPDATE clients
SET status = 'approved',
    approved_scopes = requested_scopes,
    approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
    approved_by = NULL
WHERE client_type = 'public'
  AND party_type = 'third_party'
  AND status IN ('draft', 'pending')
  AND client_secret IS NULL
  AND require_pkce = 1
  AND redirect_uri IS NOT NULL AND redirect_uri <> ''
  AND EXISTS (
    SELECT 1 FROM oauth_client_redirect_uris AS registered_uri
    WHERE registered_uri.oauth_client_id = clients.id
  )
  AND (
    LOWER(redirect_uri) NOT LIKE 'http://%'
    OR LOWER(redirect_uri) REGEXP '^http://(localhost|127[.]0[.]0[.]1|\\[::1\\])(:[0-9]+)?(/|\\?|$)'
  )
  AND NOT EXISTS (
    SELECT 1 FROM oauth_client_redirect_uris AS registered_uri
    WHERE registered_uri.oauth_client_id = clients.id
      AND LOWER(registered_uri.redirect_uri) LIKE 'http://%'
      AND LOWER(registered_uri.redirect_uri) NOT REGEXP '^http://(localhost|127[.]0[.]0[.]1|\\[::1\\])(:[0-9]+)?(/|\\?|$)'
  )
  AND JSON_TYPE(requested_scopes) = 'ARRAY'
  AND JSON_LENGTH(requested_scopes) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM JSON_TABLE(requested_scopes, '$[*]' COLUMNS(scope_name VARCHAR(64) PATH '$')) AS requested_scope
    WHERE requested_scope.scope_name IS NULL OR requested_scope.scope_name NOT IN (
      'openid', 'profile', 'email', 'forum.read', 'forum.write',
      'resource.read', 'resource.download', 'resource.upload',
      'notification.read', 'message.read', 'message.write'
    )
  );
