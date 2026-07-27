const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedEntries = [];
let cachedAt = 0;
let inFlight = null;
let refreshInterval = null;

function isEnabled() {
  return process.env.ALIYUN_ESA_AUTO_TRUST === 'true';
}

function getSiteId() {
  const raw = process.env.ALIYUN_ESA_SITE_ID;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRefreshIntervalMs() {
  const raw = process.env.ALIYUN_ESA_REFRESH_INTERVAL_MS;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : CACHE_TTL_MS;
}

function getCachedEntries() {
  return Array.isArray(cachedEntries) ? [...cachedEntries] : [];
}

function setCachedEntries(entries) {
  cachedEntries = Array.from(new Set(
    (entries || [])
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  ));
  cachedAt = Date.now();
}

function shouldRefresh() {
  return !cachedAt || (Date.now() - cachedAt) >= CACHE_TTL_MS;
}

function resetCacheForTests() {
  cachedEntries = [];
  cachedAt = 0;
  inFlight = null;
  stopAliyunEsaTrustedProxyRefresh();
}

async function fetchLatestEntries() {
  const siteId = getSiteId();
  if (!isEnabled() || !siteId) return [];

  let sdk;
  try {
    sdk = require('@alicloud/esa20240910');
  } catch (err) {
    console.warn('[AliyunESA] SDK unavailable:', err.message);
    return [];
  }

  const Client = sdk.default;
  const client = new Client({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
    regionId: process.env.ALIYUN_ESA_REGION_ID || 'cn-hangzhou',
  });

  const request = new sdk.GetOriginProtectionRequest({ siteId });
  const response = await client.getOriginProtection(request);
  const body = response?.body?.toMap?.() || response?.body || {};
  const latest = body.LatestIPWhitelist || body.latestIPWhitelist || {};
  const ipv4 = Array.isArray(latest.IPv4) ? latest.IPv4 : [];
  const ipv6 = Array.isArray(latest.IPv6) ? latest.IPv6 : [];

  return [...ipv4, ...ipv6]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function refreshAliyunEsaTrustedProxyCache(force = false) {
  if (!isEnabled()) {
    setCachedEntries([]);
    return [];
  }

  if (!force && !shouldRefresh()) {
    return getCachedEntries();
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const entries = await fetchLatestEntries();
      setCachedEntries(entries);
      if (entries.length > 0) {
        console.log(`[AliyunESA] loaded ${entries.length} trusted proxy entries for site ${getSiteId()}`);
      } else {
        console.warn('[AliyunESA] no trusted proxy entries returned from ESA origin protection');
      }
      return getCachedEntries();
    } catch (err) {
      console.warn('[AliyunESA] failed to refresh trusted proxy cache:', err.message);
      return getCachedEntries();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function startAliyunEsaTrustedProxyRefresh() {
  if (!isEnabled()) return null;
  if (refreshInterval) return refreshInterval;

  refreshInterval = setInterval(() => {
    refreshAliyunEsaTrustedProxyCache(true).catch((err) => {
      console.warn('[AliyunESA] scheduled trusted proxy refresh failed:', err.message);
    });
  }, getRefreshIntervalMs());

  if (typeof refreshInterval.unref === 'function') {
    refreshInterval.unref();
  }

  return refreshInterval;
}

function stopAliyunEsaTrustedProxyRefresh() {
  if (!refreshInterval) return;
  clearInterval(refreshInterval);
  refreshInterval = null;
}

module.exports = {
  isEnabled,
  getSiteId,
  getCachedEntries,
  refreshAliyunEsaTrustedProxyCache,
  startAliyunEsaTrustedProxyRefresh,
  stopAliyunEsaTrustedProxyRefresh,
  _setCachedEntries: setCachedEntries,
  _shouldRefresh: shouldRefresh,
  _resetCacheForTests: resetCacheForTests,
  _getRefreshIntervalMs: getRefreshIntervalMs,
  _fetchLatestEntries: fetchLatestEntries,
};
