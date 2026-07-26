-- ─────────────────────────────────────────────────────────────
-- 003: Auth page background config
-- Seed the system_config key for the login/auth page custom
-- background image. Empty value = use the default CSS grid
-- background. runtimeConfig.set() is UPDATE-only, so this row
-- must exist before the admin panel can save a value.
-- ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO system_config (`key`, value, description) VALUES
  ('auth_background_url', '', '登录页自定义背景图 URL（空 = 使用默认网格背景）');
