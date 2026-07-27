/**
 * Unit tests for Aliyun ESA trusted proxy cache.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../../src/utils/aliyunEsaTrustedProxy');
const sdkPath = '@alicloud/esa20240910';

function loadModule() {
  delete require.cache[modulePath];
  return require('../../src/utils/aliyunEsaTrustedProxy');
}

function setEnv(overrides = {}) {
  const previous = {
    ALIYUN_ESA_AUTO_TRUST: process.env.ALIYUN_ESA_AUTO_TRUST,
    ALIYUN_ESA_SITE_ID: process.env.ALIYUN_ESA_SITE_ID,
    ALIYUN_ESA_REGION_ID: process.env.ALIYUN_ESA_REGION_ID,
    ALIYUN_ESA_REFRESH_INTERVAL_MS: process.env.ALIYUN_ESA_REFRESH_INTERVAL_MS,
    ALIYUN_ACCESS_KEY_ID: process.env.ALIYUN_ACCESS_KEY_ID,
    ALIYUN_ACCESS_KEY_SECRET: process.env.ALIYUN_ACCESS_KEY_SECRET,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

beforeEach(() => {
  delete require.cache[modulePath];
  delete require.cache[require.resolve('../../src/config')];
  try {
    delete require.cache[require.resolve(sdkPath)];
  } catch {}
});

afterEach(() => {
  delete require.cache[modulePath];
  delete require.cache[require.resolve('../../src/config')];
  try {
    delete require.cache[require.resolve(sdkPath)];
  } catch {}
});

test('refreshAliyunEsaTrustedProxyCache returns empty when auto trust is disabled', async () => {
  const restore = setEnv({
    ALIYUN_ESA_AUTO_TRUST: 'false',
    ALIYUN_ESA_SITE_ID: undefined,
  });

  try {
    const mod = loadModule();
    mod._setCachedEntries(['203.0.113.0/24']);

    const entries = await mod.refreshAliyunEsaTrustedProxyCache(true);
    assert.deepEqual(entries, []);
    assert.deepEqual(mod.getCachedEntries(), []);
  } finally {
    restore();
  }
});

test('refreshAliyunEsaTrustedProxyCache loads and deduplicates IPv4 and IPv6 ESA entries', async () => {
  const restore = setEnv({
    ALIYUN_ESA_AUTO_TRUST: 'true',
    ALIYUN_ESA_SITE_ID: '123456',
    ALIYUN_ESA_REGION_ID: 'cn-hangzhou',
    ALIYUN_ACCESS_KEY_ID: 'test-ak',
    ALIYUN_ACCESS_KEY_SECRET: 'test-sk',
  });

  const calls = [];
  class FakeClient {
    constructor(options) {
      calls.push({ type: 'construct', options });
    }

    async getOriginProtection(request) {
      calls.push({ type: 'request', siteId: request.siteId });
      return {
        body: {
          LatestIPWhitelist: {
            IPv4: ['203.0.113.0/24', '203.0.113.0/24', ' 198.51.100.7 '],
            IPv6: ['2408:4000::/32', '2408:4000::/32'],
          },
        },
      };
    }
  }

  class FakeRequest {
    constructor({ siteId }) {
      this.siteId = siteId;
    }
  }

  require.cache[require.resolve(sdkPath)] = {
    id: require.resolve(sdkPath),
    filename: require.resolve(sdkPath),
    loaded: true,
    exports: {
      default: FakeClient,
      GetOriginProtectionRequest: FakeRequest,
    },
  };

  try {
    const mod = loadModule();
    const entries = await mod.refreshAliyunEsaTrustedProxyCache(true);

    assert.deepEqual(entries, ['203.0.113.0/24', '198.51.100.7', '2408:4000::/32']);
    assert.deepEqual(mod.getCachedEntries(), ['203.0.113.0/24', '198.51.100.7', '2408:4000::/32']);
    assert.deepEqual(calls, [
      {
        type: 'construct',
        options: {
          accessKeyId: 'test-ak',
          accessKeySecret: 'test-sk',
          regionId: 'cn-hangzhou',
        },
      },
      { type: 'request', siteId: 123456 },
    ]);
  } finally {
    restore();
  }
});

test('refreshAliyunEsaTrustedProxyCache keeps prior cache when ESA fetch fails', async () => {
  const restore = setEnv({
    ALIYUN_ESA_AUTO_TRUST: 'true',
    ALIYUN_ESA_SITE_ID: '123456',
    ALIYUN_ACCESS_KEY_ID: 'test-ak',
    ALIYUN_ACCESS_KEY_SECRET: 'test-sk',
  });

  class FakeClient {
    async getOriginProtection() {
      throw new Error('ESA down');
    }
  }

  class FakeRequest {
    constructor({ siteId }) {
      this.siteId = siteId;
    }
  }

  require.cache[require.resolve(sdkPath)] = {
    id: require.resolve(sdkPath),
    filename: require.resolve(sdkPath),
    loaded: true,
    exports: {
      default: FakeClient,
      GetOriginProtectionRequest: FakeRequest,
    },
  };

  try {
    const mod = loadModule();
    mod._setCachedEntries(['203.0.113.0/24']);

    const entries = await mod.refreshAliyunEsaTrustedProxyCache(true);
    assert.deepEqual(entries, ['203.0.113.0/24']);
    assert.deepEqual(mod.getCachedEntries(), ['203.0.113.0/24']);
  } finally {
    restore();
  }
});

test('startAliyunEsaTrustedProxyRefresh schedules one interval with the configured cadence', () => {
  const restore = setEnv({
    ALIYUN_ESA_AUTO_TRUST: 'true',
    ALIYUN_ESA_REFRESH_INTERVAL_MS: '15000',
  });

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const seen = [];

  global.setInterval = (fn, ms) => {
    const handle = { fn, ms, unrefCalled: false, unref() { this.unrefCalled = true; } };
    seen.push(handle);
    return handle;
  };
  global.clearInterval = (handle) => {
    seen.push({ cleared: handle });
  };

  try {
    const mod = loadModule();
    mod._resetCacheForTests();

    const first = mod.startAliyunEsaTrustedProxyRefresh();
    const second = mod.startAliyunEsaTrustedProxyRefresh();

    assert.equal(first, second);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].ms, 15000);
    assert.equal(seen[0].unrefCalled, true);

    mod.stopAliyunEsaTrustedProxyRefresh();
    assert.equal(seen.length, 2);
    assert.equal(seen[1].cleared, first);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    restore();
  }
});
