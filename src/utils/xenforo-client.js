/**
 * XenForo 2 OAuth 2 API Client Utility
 *
 * Provides functions for:
 * - Building OAuth authorization URLs
 * - Exchanging authorization codes for tokens
 * - Fetching user information from XenForo API
 * - Downloading user avatars
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

/**
 * Build XenForo OAuth 2 authorization URL
 * @param {string} baseUrl - XenForo forum base URL (e.g., 'https://forum.example.com')
 * @param {string} clientId - OAuth client ID
 * @param {string} redirectUri - Callback URL
 * @param {string} state - CSRF state token
 * @param {string[]} scopes - Requested scopes (default: ['user:read'])
 * @returns {string} Full authorization URL
 */
function buildAuthorizationUrl(baseUrl, clientId, redirectUri, state, scopes = ['user:read']) {
  const scopeParam = scopes.join(' ');
  const url = new URL(baseUrl);
  // XenForo 2.2+ uses /oauth2/authorize, some versions use /connected-account/authorize
  url.pathname = '/oauth2/authorize';
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scopeParam);
  return url.toString();
}

/**
 * Exchange authorization code for access token
 * @param {string} baseUrl - XenForo forum base URL
 * @param {string} clientId - OAuth client ID
 * @param {string} clientSecret - OAuth client secret
 * @param {string} code - Authorization code from callback
 * @param {string} redirectUri - Same redirect URI used in authorization
 * @returns {Promise<{access_token: string, refresh_token?: string, expires_in: number, token_type: string}>}
 */
async function exchangeCodeForToken(baseUrl, clientId, clientSecret, code, redirectUri) {
  const url = new URL(baseUrl);
  // XenForo API token endpoint
  url.pathname = '/api/oauth2/token';

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    redirect_uri: redirectUri
  }).toString();

  const response = await httpRequest(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body
  });

  if (!response.access_token) {
    throw new Error('Token exchange failed: ' + JSON.stringify(response));
  }

  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_in: response.expires_in || 3600,
    token_type: response.token_type || 'Bearer'
  };
}

/**
 * Fetch user information from XenForo API
 * @param {string} baseUrl - XenForo forum base URL
 * @param {string} accessToken - OAuth access token
 * @returns {Promise<Object>} User info object with user_id, username, email, avatar_urls, etc.
 */
async function fetchUserInfo(baseUrl, accessToken) {
  const url = new URL(baseUrl);
  url.pathname = '/api/me/';

  const response = await httpRequest(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  // XenForo returns user data in a nested structure
  // The actual user info is often in response.user or directly in response
  const user = response.user || response;

  if (!user || !user.user_id) {
    throw new Error('Invalid user info response: ' + JSON.stringify(response));
  }

  return {
    user_id: user.user_id,
    username: user.username,
    email: user.email,
    avatar_urls: user.avatar_urls || null,
    user_group_id: user.user_group_id,
    secondary_group_ids: user.secondary_group_ids || [],
    is_admin: user.is_admin || false,
    is_moderator: user.is_moderator || false,
    is_staff: user.is_staff || false,
    user_state: user.user_state,
    custom_fields: user.custom_fields || {},
    profile_banner_urls: user.profile_banner_urls || null
  };
}

/**
 * Download avatar from XenForo and save to local storage
 * @param {Object} avatarUrls - XenForo avatar_urls object {o, h, l, m, s}
 * @param {string|number} externalUserId - XenForo user ID for filename
 * @param {string} baseUrl - XenForo base URL for resolving relative URLs
 * @param {string} uploadDir - Local upload directory (default: 'public/uploads/avatars')
 * @returns {Promise<string|null>} Local file path or null if no avatar
 */
async function downloadAvatar(avatarUrls, externalUserId, baseUrl, uploadDir = 'public/uploads/avatars') {
  if (!avatarUrls) return null;

  // Choose 'l' (large) or 'm' (medium) size, fallback to any available
  const sizePriority = ['l', 'm', 'h', 'o', 's'];
  let avatarUrl = null;

  for (const size of sizePriority) {
    if (avatarUrls[size]) {
      avatarUrl = avatarUrls[size];
      break;
    }
  }

  if (!avatarUrl) return null;

  // Resolve relative URLs
  if (!avatarUrl.startsWith('http://') && !avatarUrl.startsWith('https://')) {
    const base = new URL(baseUrl);
    avatarUrl = new URL(avatarUrl, base).toString();
  }

  // Ensure upload directory exists
  const fullUploadDir = path.resolve(uploadDir);
  if (!fs.existsSync(fullUploadDir)) {
    fs.mkdirSync(fullUploadDir, { recursive: true });
  }

  // Generate filename
  const filename = `xenforo_${externalUserId}.jpg`;
  const filePath = path.join(fullUploadDir, filename);

  // Download and save
  try {
    const buffer = await downloadFile(avatarUrl);
    fs.writeFileSync(filePath, buffer);

    // Return relative URL path for database storage
    return `/uploads/avatars/${filename}`;
  } catch (err) {
    console.error('Avatar download failed:', err.message);
    return null;
  }
}

/**
 * Generic HTTP request helper
 * @param {string} url - Request URL
 * @param {Object} options - Request options (method, headers, body)
 * @returns {Promise<Object>} JSON response
 */
async function httpRequest(url, options = {}) {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  const requestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: options.method || 'GET',
    headers: options.headers || {}
  };

  return new Promise((resolve, reject) => {
    const req = httpModule.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            const errorData = JSON.parse(data);
            reject(new Error(`HTTP ${res.statusCode}: ${errorData.error || data}`));
          }
        } catch (parseErr) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

/**
 * Download file from URL and return buffer
 * @param {string} url - File URL
 * @returns {Promise<Buffer>} File buffer
 */
async function downloadFile(url) {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = httpModule.get(url, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  fetchUserInfo,
  downloadAvatar
};