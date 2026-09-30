-- Public launch metadata remains disabled until a developer application is reviewed.
ALTER TABLE clients
  ADD COLUMN application_icon_url VARCHAR(2048) NULL AFTER website_url,
  ADD COLUMN launch_uri_template VARCHAR(1000) NULL AFTER application_icon_url,
  ADD COLUMN launch_uri_approved TINYINT(1) NOT NULL DEFAULT 0 AFTER launch_uri_template,
  ADD COLUMN supports_presence_requested TINYINT(1) NOT NULL DEFAULT 0 AFTER launch_uri_approved,
  ADD COLUMN supports_multiplayer_requested TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_presence_requested,
  ADD COLUMN supports_join_intent_requested TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_multiplayer_requested,
  ADD COLUMN supports_presence TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_join_intent_requested,
  ADD COLUMN supports_multiplayer TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_presence,
  ADD COLUMN supports_join_intent TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_multiplayer;
