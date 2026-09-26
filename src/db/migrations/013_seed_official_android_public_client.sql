-- The official Android application is a first-party Public Client. Its ID is
-- public by design; no client secret is created or shipped in the APK.
INSERT INTO clients (
  name, description, website_url, client_id, client_secret, redirect_uri,
  require_pkce, client_type, party_type, status, owner_user_id,
  requested_scopes, approved_scopes, approved_at
)
SELECT
  'MDTBBS Official Android',
  'Official Android application for MDTBBS.',
  'https://mdtbbs.cn/',
  'mdtbbs_android_public',
  NULL,
  'mdtbbs://oauth/callback',
  1,
  'public',
  'first_party',
  'approved',
  NULL,
  JSON_ARRAY('openid', 'profile', 'email', 'forum.read', 'forum.write', 'resource.read', 'resource.download', 'resource.upload', 'notification.read', 'message.read', 'message.write'),
  JSON_ARRAY('openid', 'profile', 'email', 'forum.read', 'forum.write', 'resource.read', 'resource.download', 'resource.upload', 'notification.read', 'message.read', 'message.write'),
  CURRENT_TIMESTAMP
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM clients WHERE client_id = 'mdtbbs_android_public'
);

-- Add the exact registered deep link only when the seeded client has the
-- expected type and redirect. A conflicting pre-existing ID is left untouched.
INSERT IGNORE INTO oauth_client_redirect_uris (oauth_client_id, redirect_uri, redirect_type)
SELECT id, 'mdtbbs://oauth/callback', 'custom_scheme'
FROM clients
WHERE client_id = 'mdtbbs_android_public'
  AND client_type = 'public'
  AND party_type = 'first_party'
  AND require_pkce = 1
  AND redirect_uri = 'mdtbbs://oauth/callback';
