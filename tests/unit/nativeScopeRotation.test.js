const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../src/db');
const oauthIssuer = require('../../src/modules/oauth/oauthIssuer');
const tokenStore = require('../../src/modules/oauth/tokenStore');

test('Native refresh rotation preserves the scope stored on a legacy session', async () => {
  const originalGetConnection = pool.getConnection;
  const originalStoreAccessToken = tokenStore.storeAccessToken;
  const storedLegacyScope = 'openid profile game_content';
  const refreshInsertParams = [];
  let accessPayload;

  pool.getConnection = async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params = []) => {
      if (sql.startsWith('INSERT INTO refresh_tokens')) refreshInsertParams.push(params);
      if (sql.startsWith('SELECT * FROM refresh_tokens')) return [[{
        id: 7, user_id: 42, client_id: 'mdtbbs-mindustry-mod', native_session_id: 11,
        scope: storedLegacyScope, revoked: 0, expires_at: new Date(Date.now() + 60_000),
      }]];
      if (sql.startsWith('SELECT * FROM native_client_sessions')) return [[{
        id: 11, client_id: 'mdtbbs-mindustry-mod', device_id: 'device-legacy', revoked_at: null,
      }]];
      if (sql.startsWith('SELECT id, ban_status FROM users')) return [[{ id: 42, ban_status: 'none' }]];
      return [{ affectedRows: 1 }];
    },
  });
  tokenStore.storeAccessToken = async (_accessToken, payload) => { accessPayload = payload; };

  try {
    const result = await oauthIssuer.refreshNative({
      refreshToken: 'legacy-refresh-token', clientId: 'mdtbbs-mindustry-mod',
      accessClientId: 'forum', deviceId: 'device-legacy',
    });

    assert.equal(result.scope, storedLegacyScope);
    assert.equal(refreshInsertParams[0][3], storedLegacyScope);
    assert.equal(accessPayload.scope, storedLegacyScope);
    assert.equal(result.scope.includes('game_content.saves.'), false);
  } finally {
    pool.getConnection = originalGetConnection;
    tokenStore.storeAccessToken = originalStoreAccessToken;
  }
});
