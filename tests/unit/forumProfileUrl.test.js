const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forumProfileUrl } = require('../../src/utils/forumProfileUrl');
const config = require('../../src/config');

test('builds public MDTBBS profile links from the configured site origin', () => {
  const previous = config.server.forumBaseUrl;
  try {
    config.server.forumBaseUrl = 'https://mdtbbs.cn';
    assert.equal(forumProfileUrl(42), 'https://mdtbbs.cn/users/42');
    config.server.forumBaseUrl = 'https://community.example.test/forum/';
    assert.equal(forumProfileUrl(42), 'https://community.example.test/forum/users/42');
    config.server.forumBaseUrl = 'http://example.test';
    assert.equal(forumProfileUrl(42), null);
  } finally {
    config.server.forumBaseUrl = previous;
  }
});
