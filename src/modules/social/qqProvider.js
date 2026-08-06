const config = require('../../config');

const AUTH_URL = 'https://graph.qq.com/oauth2.0/authorize';
const TOKEN_URL = 'https://graph.qq.com/oauth2.0/token';
const OPENID_URL = 'https://graph.qq.com/oauth2.0/me';
const USER_INFO_URL = 'https://graph.qq.com/user/get_user_info';

function getConfig() {
  return config.qq;
}

function assertConfigured() {
  const c = getConfig();
  if (!c?.clientId || !c.clientSecret || !c.redirectUri) throw new Error('QQ OAuth is not configured');
  return c;
}

function getAuthorizationUrl(state) {
  const c = assertConfigured();
  const params = new URLSearchParams({ response_type: 'code', client_id: c.clientId, redirect_uri: c.redirectUri, state });
  return `${AUTH_URL}?${params}`;
}

async function request(url, options = {}) {
  const timeoutMs = getConfig()?.timeoutMs || 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (text.length > 256 * 1024) throw new Error('QQ response too large');
    if (!response.ok) throw new Error('QQ request failed');
    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('QQ request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeCode(code) {
  const c = assertConfigured();
  if (!code || typeof code !== 'string' || code.length > 2048) throw new Error('QQ authorization code invalid');
  const params = new URLSearchParams({ grant_type: 'authorization_code', client_id: c.clientId, client_secret: c.clientSecret, code, redirect_uri: c.redirectUri });
  const text = await request(`${TOKEN_URL}?${params}`);
  if (/callback\(/.test(text)) throw new Error('QQ token exchange failed');
  const result = Object.fromEntries(new URLSearchParams(text));
  if (!result.access_token) throw new Error('QQ token exchange failed');
  return result;
}

async function getOpenId(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') throw new Error('QQ access token invalid');
  const text = await request(`${OPENID_URL}?access_token=${encodeURIComponent(accessToken)}`);
  const match = text.match(/callback\(\s*(\{.*\})\s*\)/s);
  if (!match) throw new Error('QQ openid lookup failed');
  let result;
  try { result = JSON.parse(match[1]); } catch { throw new Error('QQ openid lookup failed'); }
  if (result.error || !result.openid) throw new Error('QQ openid lookup failed');
  return result.openid;
}

async function getProfile(accessToken, openid) {
  const c = assertConfigured();
  const params = new URLSearchParams({ access_token: accessToken, oauth_consumer_key: c.clientId, openid });
  let result;
  try { result = JSON.parse(await request(`${USER_INFO_URL}?${params}`)); } catch (err) { throw new Error(err.message === 'QQ request timed out' ? err.message : 'QQ profile lookup failed'); }
  if (result.ret !== 0) throw new Error('QQ profile lookup failed');
  return result;
}

module.exports = { getAuthorizationUrl, exchangeCode, getOpenId, getProfile };
