/**
 * Quick routing verification for Task 13.
 *
 * This script verifies Express serves the correct files for key routes
 * WITHOUT requiring a real MySQL/Redis connection.  It creates the app
 * with mock database pools and exercises the static + SPA middleware.
 *
 * Run: node scripts/verify-routing.js
 */

const http = require('http');
const path = require('path');

// Provide fake DB/Redis so app.js can be required.
process.env.USE_MEMORY_REDIS = '1';

// Mock the DB and Redis modules BEFORE requiring app.js
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  // Let our app resolve normally; we mock at the require-cache level instead.
  return origResolve.call(this, request, parent, ...rest);
};

// Stub DB pool
const fakePool = {
  execute: async () => [[{ 1: 1 }]],
  query: async () => [[{ 1: 1 }]],
};

// Stub Redis client
const fakeRedis = {
  ping: async () => 'PONG',
  get: async () => null,
  set: async () => 'OK',
  del: async () => 1,
  expire: async () => 1,
  keys: async () => [],
};

// Patch require cache
require.cache[require.resolve('../src/db')] = {
  id: require.resolve('../src/db'),
  filename: require.resolve('../src/db'),
  loaded: true,
  exports: {
    pool: fakePool,
    client: fakeRedis,
  },
};
require.cache[require.resolve('../src/redis')] = {
  id: require.resolve('../src/redis'),
  filename: require.resolve('../src/redis'),
  loaded: true,
  exports: {
    client: fakeRedis,
  },
};

// Now require the app
const { createApp } = require('../src/app');

const app = createApp({ pool: fakePool, client: fakeRedis });

const PORT = 14099;  // Non-standard port to avoid conflicts
const server = http.createServer(app);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ ${message}`);
    passed++;
  } else {
    console.error(`  ✖ ${message}`);
    failed++;
  }
}

async function fetch(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${urlPath}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function run() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`\nRouting verification on port ${PORT}\n`);

  try {
    // 1. User SPA — / should serve React index.html from dist/client
    {
      const res = await fetch('/');
      assert(res.status === 200, `GET / → ${res.status}`);
      assert(res.body.includes('id="root"'), `GET / contains React root element`);
      assert(res.body.includes('/assets/'), `GET / references Vite /assets/`);
      assert(!res.body.includes('/shared-styles/'), `GET / has no /shared-styles/ reference`);
      assert(!res.body.includes('/js/common.js'), `GET / has no /js/common.js reference`);
      assert(!res.body.includes('/style.css'), `GET / has no /style.css reference (except Vite)`);
    }

    // 2. User SPA — /login should serve React index.html
    {
      const res = await fetch('/login');
      assert(res.status === 200, `GET /login → ${res.status} (SPA fallback)`);
      assert(res.body.includes('id="root"'), `GET /login contains React root`);
    }

    // 3. User SPA — /register should serve React index.html
    {
      const res = await fetch('/register');
      assert(res.status === 200, `GET /register → ${res.status} (SPA fallback)`);
      assert(res.body.includes('id="root"'), `GET /register contains React root`);
    }

    // 4. User SPA — /dashboard should serve React index.html
    {
      const res = await fetch('/dashboard');
      assert(res.status === 200, `GET /dashboard → ${res.status} (SPA fallback)`);
      assert(res.body.includes('id="root"'), `GET /dashboard contains React root`);
    }

    // 5. Admin SPA — /admin should serve admin.html from dist/client
    {
      const res = await fetch('/admin');
      assert(res.status === 200, `GET /admin → ${res.status}`);
      assert(res.body.includes('MindAuth Admin'), `GET /admin contains admin title`);
      assert(res.body.includes('/assets/'), `GET /admin references Vite /assets/`);
      assert(!res.body.includes('/shared-styles/'), `GET /admin has no /shared-styles/ reference`);
    }

    // 6. Admin SPA — /admin/users should serve admin.html
    {
      const res = await fetch('/admin/users');
      assert(res.status === 200, `GET /admin/users → ${res.status} (admin SPA)`);
      assert(res.body.includes('MindAuth Admin'), `GET /admin/users contains admin title`);
    }

    // 7. API route — /api/health should return JSON
    {
      const res = await fetch('/api/health');
      assert(res.status === 200, `GET /api/health → ${res.status}`);
      const body = JSON.parse(res.body);
      assert(body.status === 'ok', `GET /api/health returns status:ok`);
    }

    // 8. API 404 — /api/nonexistent should return JSON 404
    {
      const res = await fetch('/api/nonexistent');
      assert(res.status === 404, `GET /api/nonexistent → ${res.status}`);
      const body = JSON.parse(res.body);
      assert(body.success === false, `GET /api/nonexistent returns success:false`);
    }

    // 9. Legacy files — /error.html should still be accessible
    {
      const res = await fetch('/error.html');
      assert(res.status === 200, `GET /error.html → ${res.status}`);
      assert(res.body.includes('<!DOCTYPE html>'), `GET /error.html contains DOCTYPE`);
    }

    // 10. Legacy files — /oauth-error.html should still be accessible
    {
      const res = await fetch('/oauth-error.html');
      assert(res.status === 200, `GET /oauth-error.html → ${res.status}`);
    }

    // 11. robots.txt should still be accessible
    {
      const res = await fetch('/robots.txt');
      assert(res.status === 200, `GET /robots.txt → ${res.status}`);
    }

    // 12. Vite assets — should serve with long cache headers
    {
      // Get a real asset URL from the HTML
      const indexRes = await fetch('/');
      const assetMatch = indexRes.body.match(/src="(\/assets\/[^"]+)"/);
      if (assetMatch) {
        const assetRes = await fetch(assetMatch[1]);
        assert(assetRes.status === 200, `GET ${assetMatch[1]} → ${assetRes.status}`);
        const cc = assetRes.headers['cache-control'] || '';
        assert(cc.includes('max-age=31536000'), `Asset has 1-year cache: ${cc}`);
        assert(cc.includes('immutable'), `Asset is immutable: ${cc}`);
      } else {
        console.log('  ⚠ No asset URL found in HTML (skipping cache header check)');
      }
    }

    // 13. OIDC Discovery still works
    {
      const res = await fetch('/.well-known/openid-configuration');
      assert(res.status === 200, `GET /.well-known/openid-configuration → ${res.status}`);
      const body = JSON.parse(res.body);
      assert(body.issuer !== undefined, `OIDC config has issuer`);
    }

  } catch (err) {
    console.error('\nUnexpected error:', err);
    failed++;
  }

  server.close();

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
