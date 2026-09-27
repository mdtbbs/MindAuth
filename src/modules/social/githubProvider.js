const config = require('../../config');
const { requestJson } = require('./providerHttp');

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const PROFILE_URL = 'https://api.github.com/user';

function getConfig() { return config.social.github; }

function assertConfigured() {
  const value = getConfig();
  if (!value?.enabled || !value.clientId || !value.clientSecret || !value.redirectUri) throw new Error('GitHub OAuth is not configured');
  return value;
}

function getAuthorizationUrl(state) {
  const value = assertConfigured();
  return `${AUTHORIZE_URL}?${new URLSearchParams({ client_id: value.clientId, redirect_uri: value.redirectUri, scope: 'read:user', state })}`;
}

async function exchangeCode(code) {
  const value = assertConfigured();
  if (typeof code !== 'string' || code.length < 1 || code.length > 2048) throw new Error('GitHub authorization code invalid');
  const result = await requestJson(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'MindAuth' },
    body: JSON.stringify({ client_id: value.clientId, client_secret: value.clientSecret, code, redirect_uri: value.redirectUri }),
  }, value.timeoutMs, 'GitHub');
  if (typeof result.access_token !== 'string' || !result.access_token || result.token_type?.toLowerCase() !== 'bearer') {
    throw new Error('GitHub token exchange failed');
  }
  return result.access_token;
}

async function getProfile(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 4096) throw new Error('GitHub access token invalid');
  const value = assertConfigured();
  const profile = await requestJson(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MindAuth' },
  }, value.timeoutMs, 'GitHub');
  if ((typeof profile.id !== 'number' && typeof profile.id !== 'string') || !String(profile.id).trim() || typeof profile.login !== 'string') {
    throw new Error('GitHub profile invalid');
  }
  let avatarUrl = null;
  try {
    const avatar = new URL(profile.avatar_url);
    if (avatar.protocol === 'https:' && avatar.hostname === 'avatars.githubusercontent.com') avatarUrl = avatar.toString().slice(0, 500);
  } catch { /* Keep the avatar empty when the provider response has no valid URL. */ }
  return {
    providerUserId: String(profile.id).slice(0, 255),
    nickname: String(profile.name || profile.login).slice(0, 255),
    avatarUrl,
  };
}

module.exports = { getAuthorizationUrl, exchangeCode, getProfile };
