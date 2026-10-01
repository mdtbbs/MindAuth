-- The official LanLink Mod uses Authorization Code + PKCE as a public client.
-- Its fixed client ID and exact loopback callback are part of the shipped Mod;
-- third-party client IDs remain subject to the normal approval and capability gates.
INSERT INTO clients (
  name, description, website_url, client_id, client_secret, redirect_uri,
  require_pkce, client_type, party_type, status, owner_user_id,
  requested_scopes, approved_scopes, approved_at,
  supports_presence, supports_multiplayer
)
SELECT
  'MDTBBS Official LanLink Mod',
  'Official Mindustry Mod for MDTBBS multiplayer.',
  'https://mdtbbs.cn/',
  'lanlink-mindustry-mod',
  NULL,
  'http://127.0.0.1:0/oauth/callback',
  1,
  'public',
  'first_party',
  'approved',
  NULL,
  JSON_ARRAY('openid', 'profile', 'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write'),
  JSON_ARRAY('openid', 'profile', 'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write'),
  CURRENT_TIMESTAMP,
  1,
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM clients WHERE client_id = 'lanlink-mindustry-mod'
);

-- Register only the dynamic-port loopback callback used by the official Mod.
-- OAuth still checks the exact host, path, and PKCE challenge at authorization time.
INSERT IGNORE INTO oauth_client_redirect_uris (oauth_client_id, redirect_uri, redirect_type)
SELECT id, 'http://127.0.0.1:0/oauth/callback', 'loopback'
FROM clients
WHERE client_id = 'lanlink-mindustry-mod'
  AND client_type = 'public'
  AND party_type = 'first_party'
  AND status = 'approved'
  AND require_pkce = 1
  AND redirect_uri = 'http://127.0.0.1:0/oauth/callback';
