const config = require('../../config');
const { requestJson } = require('./providerHttp');

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const PROFILE_URL = 'https://discord.com/api/users/@me';

function getConfig() { return config.social.discord; }

function assertConfigured() {
  const value = getConfig();
  if (!value?.enabled || !value.clientId || !value.clientSecret || !value.redirectUri) throw new Error('Discord OAuth is not configured');
  return value;
}

function getAuthorizationUrl(state) {
  const value = assertConfigured();
  return `${AUTHORIZE_URL}?${new URLSearchParams({ client_id: value.clientId, redirect_uri: value.redirectUri, response_type: 'code', scope: 'identify', state })}`;
}

async function exchangeCode(code) {
  const value = assertConfigured();
  if (typeof code !== 'string' || code.length < 1 || code.length > 2048) throw new Error('Discord authorization code invalid');
  const body = new URLSearchParams({ client_id: value.clientId, client_secret: value.clientSecret, grant_type: 'authorization_code', code, redirect_uri: value.redirectUri });
  const result = await requestJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  }, value.timeoutMs, 'Discord');
  if (typeof result.access_token !== 'string' || !result.access_token || result.token_type?.toLowerCase() !== 'bearer') {
    throw new Error('Discord token exchange failed');
  }
  return result.access_token;
}

async function getProfile(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 4096) throw new Error('Discord access token invalid');
  const value = assertConfigured();
  const profile = await requestJson(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  }, value.timeoutMs, 'Discord');
  if (typeof profile.id !== 'string' || !/^\d{5,32}$/.test(profile.id)) throw new Error('Discord profile invalid');
  const avatarUrl = typeof profile.avatar === 'string' && /^[a-zA-Z0-9_]+$/.test(profile.avatar)
    ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
    : null;
  return {
    providerUserId: profile.id,
    nickname: String(profile.global_name || profile.username || 'Discord user').slice(0, 255),
    avatarUrl,
  };
}

module.exports = { getAuthorizationUrl, exchangeCode, getProfile };
