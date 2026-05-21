const http = require('http');

const MINDAUTH = 'http://localhost:4001';
const FORUM = 'http://localhost:4000';
const CLIENT_ID = '6d875cc521f1c60ba17dd53c7b9edc5a';
const REDIRECT_URI = encodeURIComponent(`${FORUM}/api/auth/callback`);

console.log('=== 模拟登录流程 ===');
console.log(`1. 论坛登录按钮跳转: ${MINDAUTH}/login?redirect=${REDIRECT_URI}&client_id=${CLIENT_ID}`);

const jar = {};
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join('; ')
      }
    }, (res) => {
      const setCookies = res.headers['set-cookie'];
      if (setCookies) {
        setCookies.forEach(c => {
          const match = c.match(/^(.*?)=(.*?);/);
          if (match) jar[match[1]] = match[2];
        });
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const location = res.headers['location'];
        resolve({ status: res.statusCode, data, location });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

(async () => {
  // Login
  const loginRes = await request(`${MINDAUTH}/api/login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'testuser', password: 'test123456' })
  });
  console.log(`2. 登录: ${loginRes.data}`);

  // Authorize
  const authRes = await request(`${MINDAUTH}/api/authorize?redirect_uri=${FORUM}/api/auth/callback&client_id=${CLIENT_ID}`);
  console.log(`3. Authorize 重定向: ${authRes.location}`);

  if (authRes.location && authRes.location.includes('code=')) {
    const code = authRes.location.split('code=')[1].split('&')[0];

    // Forum callback
    const callbackRes = await request(`${FORUM}/api/auth/callback?code=${code}`);
    console.log(`4. 论坛回调: ${callbackRes.data}`);
    console.log(`   forum_session cookie: ${jar['forum_session'] ? '✓' : '✗'}`);

    // Check auth
    const checkRes = await request(`${FORUM}/api/auth/check`);
    console.log(`5. 登录检查: ${checkRes.data}`);
  }
})();
