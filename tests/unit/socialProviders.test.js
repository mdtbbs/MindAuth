const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const originalFetch = global.fetch;
const mockConfig = {
  social: {
    github: { enabled: true, clientId: 'github-client', clientSecret: 'github-secret', redirectUri: 'https://auth.example.test/api/auth/social/github/callback', timeoutMs: 100 },
    discord: { enabled: true, clientId: 'discord-client', clientSecret: 'discord-secret', redirectUri: 'https://auth.example.test/api/auth/social/discord/callback', timeoutMs: 100 },
  },
};
const configPath = require.resolve('../../src/config');
require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: mockConfig };

const github = require('../../src/modules/social/githubProvider');
const discord = require('../../src/modules/social/discordProvider');
const registry = require('../../src/modules/social/providerRegistry');
const { requestJson } = require('../../src/modules/social/providerHttp');

beforeEach(() => { global.fetch = originalFetch; });
afterEach(() => { global.fetch = originalFetch; });

test('GitHub authorization requests only the read:user scope and never exposes the secret', () => {
  const url = new URL(github.getAuthorizationUrl('opaque-state'));
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'github-client');
  assert.equal(url.searchParams.get('redirect_uri'), mockConfig.social.github.redirectUri);
  assert.equal(url.searchParams.get('scope'), 'read:user');
  assert.equal(url.searchParams.get('state'), 'opaque-state');
  assert.equal(url.searchParams.has('client_secret'), false);
});

test('GitHub exchanges codes and returns a bounded profile without trusting arbitrary avatars', async () => {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return String(url).endsWith('/login/oauth/access_token')
      ? { ok: true, text: async () => JSON.stringify({ access_token: 'temporary-token', token_type: 'bearer' }) }
      : { ok: true, text: async () => JSON.stringify({ id: 42, login: 'player', name: 'Player', avatar_url: 'https://evil.example/avatar.png' }) };
  };
  const token = await github.exchangeCode('one-time-code');
  const profile = await github.getProfile(token);
  assert.equal(token, 'temporary-token');
  assert.equal(profile.providerUserId, '42');
  assert.equal(profile.nickname, 'Player');
  assert.equal(profile.avatarUrl, null);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer temporary-token');
});

test('Discord requests identify only and normalizes profile data', async () => {
  const authorize = new URL(discord.getAuthorizationUrl('discord-state'));
  assert.equal(authorize.searchParams.get('scope'), 'identify');
  assert.equal(authorize.searchParams.get('state'), 'discord-state');
  global.fetch = async (url) => String(url).endsWith('/oauth2/token')
    ? { ok: true, text: async () => JSON.stringify({ access_token: 'temporary-token', token_type: 'Bearer' }) }
    : { ok: true, text: async () => JSON.stringify({ id: '123456789012345678', username: 'player', global_name: 'Player', avatar: 'a_hash' }) };
  const token = await discord.exchangeCode('one-time-code');
  const profile = await discord.getProfile(token);
  assert.equal(token, 'temporary-token');
  assert.equal(profile.providerUserId, '123456789012345678');
  assert.equal(profile.avatarUrl, 'https://cdn.discordapp.com/avatars/123456789012345678/a_hash.png');
});

test('provider registry only advertises fully configured providers', () => {
  assert.deepEqual(registry.listEnabled(), ['github', 'discord']);
  mockConfig.social.discord.clientSecret = '';
  assert.deepEqual(registry.listEnabled(), ['github']);
  mockConfig.social.discord.clientSecret = 'discord-secret';
});

test('provider HTTP client rejects oversized and unsuccessful responses', async () => {
  global.fetch = async () => new Response('x'.repeat(256 * 1024 + 1), { status: 200 });
  await assert.rejects(() => requestJson('https://provider.example/profile', {}, 100, 'provider'), /response too large/);
  global.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(() => requestJson('https://provider.example/profile', {}, 100, 'provider'), /request failed/);
});

test('provider HTTP client enforces its timeout', async () => {
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(() => requestJson('https://provider.example/profile', {}, 5, 'provider'), /request timed out/);
});
