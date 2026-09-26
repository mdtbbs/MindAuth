const config = require('../config');

/** Build a public MDTBBS profile link only from the operator-configured origin. */
function forumProfileUrl(userId) {
  const configuredBase = config.server.forumBaseUrl;
  try {
    const url = new URL(configuredBase);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if ((!local && url.protocol !== 'https:') || url.username || url.password) return null;
    url.pathname = `${url.pathname.replace(/\/$/, '')}/users/${encodeURIComponent(userId)}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

module.exports = { forumProfileUrl };
