const config = require('../../config');
const github = require('./githubProvider');
const discord = require('./discordProvider');

const providers = Object.freeze({ github, discord });

function isEnabled(provider) {
  const adapter = providers[provider];
  const settings = config.social?.[provider];
  return Boolean(adapter && settings?.enabled && settings.clientId && settings.clientSecret && settings.redirectUri);
}

function get(provider) {
  if (!providers[provider] || !isEnabled(provider)) throw new Error('SOCIAL_PROVIDER_UNAVAILABLE');
  return providers[provider];
}

function listEnabled() {
  return Object.keys(providers).filter(isEnabled);
}

module.exports = { get, isEnabled, listEnabled, providers };
