'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { pool, closePool } = require('../src/db/pool');
const { resolveLocale, SUPPORTED_LOCALES } = require('../src/utils/locale');
const { resolveMailLocale, localizeNotification } = require('../src/utils/emailTemplates');

const failures = [];
function check(name, passed, detail = '') {
  const ok = Boolean(passed);
  if (!ok) failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

function validProductionCallback(value, expectedPath) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === expectedPath && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function validHttpsRedirect(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function configuredRedirectUris() {
  return [...new Set(String(process.env.CLUB_OAUTH_REDIRECT_URIS || '').split(/[\n,]/).map((value) => value.trim()).filter(Boolean))].sort();
}

function walkFiles(directory) {
  const found = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) found.push(...walkFiles(full));
    else if (/\.(?:js|mjs|cjs|html|json)$/i.test(item.name)) found.push(full);
  }
  return found;
}

function secretsInPublicAssets() {
  const assetDirectory = path.join(__dirname, '../frontend/dist');
  if (!fs.existsSync(assetDirectory)) return false;
  const secretValues = [
    process.env.GITHUB_CLIENT_SECRET,
    process.env.DISCORD_CLIENT_SECRET,
    process.env.QQ_CLIENT_SECRET,
    process.env.ADMIN_SECRET,
    process.env.MYSQL_PASSWORD,
    process.env.REDIS_PASSWORD,
    process.env.SMTP_PASS,
    process.env.ALIYUN_ACCESS_KEY_SECRET,
  ].filter((value) => typeof value === 'string' && value.length >= 8);
  const publicValues = Object.entries(process.env)
    .filter(([name]) => name.startsWith('NEXT_PUBLIC_'))
    .map(([, value]) => value)
    .filter(Boolean);
  if (secretValues.some((secret) => publicValues.includes(secret))) return false;
  for (const file of walkFiles(assetDirectory)) {
    const content = fs.readFileSync(file, 'utf8');
    if (secretValues.some((secret) => content.includes(secret))) return false;
  }
  return true;
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('Set NODE_ENV=production and load the intended production environment before running this read-only check.');
  }

  const clubClientId = process.env.CLUB_OAUTH_CLIENT_ID || '';
  const expectedRedirectUris = configuredRedirectUris();
  check('Club OAuth client ID is explicitly configured', Boolean(clubClientId));
  check('Club OAuth redirect URI allowlist is explicitly configured', expectedRedirectUris.length > 0);
  check('Club redirect URI allowlist contains only HTTPS URLs', expectedRedirectUris.length > 0 && expectedRedirectUris.every(validHttpsRedirect));

  for (const [provider, settings, expectedPath] of [
    ['GitHub', config.social.github, '/api/auth/social/github/callback'],
    ['Discord', config.social.discord, '/api/auth/social/discord/callback'],
  ]) {
    if (!settings.enabled) {
      check(`${provider} OAuth callback configuration`, true, 'provider is disabled');
      continue;
    }
    const callback = validProductionCallback(settings.redirectUri, expectedPath);
    check(`${provider} OAuth client credentials are configured`, Boolean(settings.clientId && settings.clientSecret));
    check(`${provider} OAuth callback is HTTPS and uses the expected route`, callback);
    let sameOrigin = false;
    try { sameOrigin = new URL(settings.redirectUri).origin === new URL(config.server.baseUrl).origin; } catch { /* invalid URL is reported above */ }
    check(`${provider} OAuth callback uses the configured MindAuth origin`, callback && sameOrigin);
  }

  check('OAuth provider secrets are absent from public variables and built assets', secretsInPublicAssets());

  const uiFallback = resolveLocale({ preferredLocale: 'fr-FR', acceptLanguage: 'ru-RU,ja;q=0.8', clientDefaultLocale: 'xx' });
  const uiDefault = resolveLocale({ preferredLocale: 'fr-FR', acceptLanguage: 'xx', clientDefaultLocale: 'xx' });
  check('UI locale fallback resolves supported languages', uiFallback === 'ru' && uiDefault === 'en' && SUPPORTED_LOCALES.includes(uiFallback));
  check('Email locale fallback is zh-CN for unsupported preferences', resolveMailLocale('fr-FR') === 'zh-CN');
  const fallbackNotification = localizeNotification('fr-FR', 'password_changed');
  const zhNotification = localizeNotification('zh-CN', 'password_changed');
  check('Notification locale fallback matches the supported default', Boolean(fallbackNotification && zhNotification && fallbackNotification.title === zhNotification.title && fallbackNotification.content === zhNotification.content));

  const [migrationRows] = await pool.execute('SELECT version, name FROM schema_version WHERE version = 18');
  check('MindAuth migration 018 is applied', migrationRows.some((row) => row.name === '018_international_locales_and_ecosystems'));

  let clubClient = null;
  if (clubClientId) {
    const [clients] = await pool.execute(
      `SELECT id, client_type, party_type, ecosystem, status, client_secret
       FROM clients WHERE client_id = ? LIMIT 1`,
      [clubClientId],
    );
    clubClient = clients[0] || null;
  }
  check('Club OAuth client is confidential, first-party, approved, and uses mindustry-club ecosystem', Boolean(
    clubClient && clubClient.client_type === 'confidential' && clubClient.party_type === 'first_party'
      && clubClient.status === 'approved' && clubClient.ecosystem === 'mindustry-club' && clubClient.client_secret,
  ));

  let actualRedirectUris = [];
  if (clubClient) {
    const [redirects] = await pool.execute(
      'SELECT redirect_uri FROM oauth_client_redirect_uris WHERE oauth_client_id = ? ORDER BY redirect_uri',
      [clubClient.id],
    );
    actualRedirectUris = redirects.map((row) => row.redirect_uri).sort();
  }
  check('Club OAuth database redirects exactly match the configured allowlist', Boolean(
    expectedRedirectUris.length && actualRedirectUris.length === expectedRedirectUris.length
      && actualRedirectUris.every((value, index) => value === expectedRedirectUris[index]),
  ));

  console.log(`${failures.length ? 'NOT READY' : 'READY'}: ${failures.length ? `${failures.length} check(s) need attention.` : 'all checks passed.'}`);
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`NOT READY: read-only readiness check failed (${error.code || error.name || 'database/configuration error'}).`);
    process.exitCode = 1;
  })
  .finally(async () => closePool().catch(() => undefined));
