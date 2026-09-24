const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { pool, closePool, runMigrations } = require('../../src/db');
const { client, connectRedis, closeRedis } = require('../../src/redis');
const { createPasswordLogin } = require('../../src/modules/auth/passwordLogin');
const { createNativeClientService } = require('../../src/modules/nativeAuth/nativeClientService');
const oauthIssuer = require('../../src/modules/oauth/oauthIssuer');
const sessionManager = require('../../src/modules/sessions/sessionManager');

const enabled = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';
const req = { headers: { 'user-agent': 'Mindustry integration test' }, socket: { remoteAddress: '127.0.0.1' } };
const CLIENT = 'mdtbbs-mindustry-mod';
const deviceA = '3f764e93-8d14-4a53-8c11-123456789abc';
const deviceB = 'a1a1a1a1-8d14-4a53-8c11-123456789abc';

describe('native first-party client sessions', { skip: !enabled }, () => {
  let userId;
  let service;
  let forumSecret;
  const issuedAccessTokens = [];

  before(async () => {
    await connectRedis();
    await runMigrations(pool);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const [user] = await pool.execute(
      'INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, 1)',
      [`mod_${suffix}`, `mod_${suffix}@test.invalid`, await bcrypt.hash('NativePass123', 4)]
    );
    userId = user.insertId;
    forumSecret = 'forum_secret_key_for_development';
    service = createNativeClientService({ pool, redis: client, auth: createPasswordLogin({ pool, redis: client }) });
  });

  after(async () => {
    if (userId) {
      const [sessions] = await pool.execute('SELECT id FROM native_client_sessions WHERE user_id = ?', [userId]);
      for (const session of sessions) await oauthIssuer.revokeNativeSession(session.id);
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    for (const token of issuedAccessTokens) await oauthIssuer.revoke({ token, clientId: 'forum', clientSecret: forumSecret }).catch(() => {});
    await closeRedis();
    await closePool();
  });

  it('issues interoperable Bearer tokens, rotates, and revokes only one device', async () => {
    assert.ok(forumSecret, 'test fixture must seed the downstream forum OAuth client');
    const [users] = await pool.execute('SELECT username, email FROM users WHERE id = ?', [userId]);
    const first = await service.login({ clientId: CLIENT, login: users[0].email.toUpperCase(), password: 'NativePass123', deviceId: deviceA, deviceName: 'Mindustry Linux', req });
    const second = await service.login({ clientId: CLIENT, login: users[0].username, password: 'NativePass123', deviceId: deviceB, deviceName: 'Mindustry Android', req });
    issuedAccessTokens.push(first.access_token, second.access_token);

    const introspection = await oauthIssuer.introspect({ token: first.access_token, clientId: 'forum', clientSecret: forumSecret });
    assert.equal(introspection.active, true);
    assert.equal(introspection.sub, String(userId));
    const claims = await oauthIssuer.userinfo(first.access_token);
    assert.equal(claims.sub, String(userId));
    assert.ok(claims.scope === undefined || claims.username === users[0].username);

    const rotated = await service.refresh({ clientId: CLIENT, refreshToken: first.refresh_token, deviceId: deviceA });
    issuedAccessTokens.push(rotated.access_token);
    assert.notEqual(rotated.refresh_token, first.refresh_token);
    await assert.rejects(() => service.refresh({ clientId: CLIENT, refreshToken: first.refresh_token, deviceId: deviceA }));
    assert.equal((await oauthIssuer.introspect({ token: rotated.access_token, clientId: 'forum', clientSecret: forumSecret })).active, false);
    assert.equal((await oauthIssuer.introspect({ token: second.access_token, clientId: 'forum', clientSecret: forumSecret })).active, true);

    const sessions = await sessionManager.listUserSessions(userId);
    const surviving = sessions.find(session => session.session_type === 'native' && session.device_info.includes('Mindustry Android'));
    assert.ok(surviving);
    await sessionManager.revokeUserSession({ sessionId: surviving.id, userId });
    assert.equal((await oauthIssuer.introspect({ token: second.access_token, clientId: 'forum', clientSecret: forumSecret })).active, false);
  });

  it('password-wide session revocation also invalidates Native refresh tokens', async () => {
    const [users] = await pool.execute('SELECT username FROM users WHERE id = ?', [userId]);
    const session = await service.login({ clientId: CLIENT, login: users[0].username, password: 'NativePass123', deviceId: deviceA, req });
    issuedAccessTokens.push(session.access_token);
    await sessionManager.revokeAllUserSessions(userId);
    await assert.rejects(() => service.refresh({ clientId: CLIENT, refreshToken: session.refresh_token, deviceId: deviceA }));
    assert.equal((await oauthIssuer.introspect({ token: session.access_token, clientId: 'forum', clientSecret: forumSecret })).active, false);
  });
});
