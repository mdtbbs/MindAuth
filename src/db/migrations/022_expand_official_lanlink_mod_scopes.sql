-- The integrated Mindustry Mod reuses the approved LanLink public client so
-- MindAuth's LanLink exchange endpoint can validate its OAuth access token.
-- The migration is safe when 020 already seeded the client and only expands
-- scopes on the expected first-party loopback PKCE registration.
INSERT INTO clients (
  name, description, website_url, client_id, client_secret, redirect_uri,
  require_pkce, client_type, party_type, status, owner_user_id,
  requested_scopes, approved_scopes, approved_at,
  supports_presence, supports_multiplayer
)
SELECT
  'MDTBBS Official Mindustry Mod',
  'Official Mindustry Mod for MDTBBS community, resources, and multiplayer.',
  'https://mdtbbs.cn/',
  'lanlink-mindustry-mod',
  NULL,
  'http://127.0.0.1:0/oauth/callback',
  1,
  'public',
  'first_party',
  'approved',
  NULL,
  JSON_ARRAY(
    'openid', 'profile', 'forum.read', 'forum.write',
    'resource.read', 'resource.download', 'resource.upload', 'notification.read',
    'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write'
  ),
  JSON_ARRAY(
    'openid', 'profile', 'forum.read', 'forum.write',
    'resource.read', 'resource.download', 'resource.upload', 'notification.read',
    'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write'
  ),
  CURRENT_TIMESTAMP,
  1,
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM clients WHERE client_id = 'lanlink-mindustry-mod'
);

UPDATE clients
SET name = 'MDTBBS Official Mindustry Mod',
    description = 'Official Mindustry Mod for MDTBBS community, resources, and multiplayer.',
    website_url = 'https://mdtbbs.cn/',
    requested_scopes = JSON_ARRAY(
      'openid', 'profile', 'forum.read', 'forum.write',
      'resource.read', 'resource.download', 'resource.upload', 'notification.read',
      'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write'
    ),
    approved_scopes = JSON_ARRAY(
      'openid', 'profile', 'forum.read', 'forum.write',
      'resource.read', 'resource.download', 'resource.upload', 'notification.read',
      'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write'
    ),
    approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
    supports_presence = 1,
    supports_multiplayer = 1
WHERE client_id = 'lanlink-mindustry-mod'
  AND client_secret IS NULL
  AND client_type = 'public'
  AND party_type = 'first_party'
  AND status = 'approved'
  AND require_pkce = 1
  AND redirect_uri = 'http://127.0.0.1:0/oauth/callback';

-- Port 0 is the registered dynamic-port callback; actual callbacks retain the
-- same loopback host and /oauth/callback path.
INSERT IGNORE INTO oauth_client_redirect_uris (oauth_client_id, redirect_uri, redirect_type)
SELECT id, 'http://127.0.0.1:0/oauth/callback', 'loopback'
FROM clients
WHERE client_id = 'lanlink-mindustry-mod'
  AND client_secret IS NULL
  AND client_type = 'public'
  AND party_type = 'first_party'
  AND status = 'approved'
  AND require_pkce = 1
  AND redirect_uri = 'http://127.0.0.1:0/oauth/callback';
