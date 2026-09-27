const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLocale, resolveLocale, appendUiLocales } = require('../../src/utils/locale');

test('normalizes supported browser and BCP 47 locales', () => {
  assert.equal(normalizeLocale('ja-JP'), 'ja');
  assert.equal(normalizeLocale('ru-RU'), 'ru');
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeLocale('de-DE'), null);
});

test('resolves locale in OAuth and account preference order', () => {
  assert.equal(resolveLocale({ uiLocales: 'ja-JP en', explicitLocale: 'ru', preferredLocale: 'zh-CN' }), 'ja');
  assert.equal(resolveLocale({ explicitLocale: 'ru', preferredLocale: 'zh-CN' }), 'ru');
  assert.equal(resolveLocale({ preferredLocale: 'zh-CN', cookieLocale: 'ja' }), 'zh-CN');
  assert.equal(resolveLocale({ cookieLocale: 'ja', acceptLanguage: 'ru-RU, en;q=0.8' }), 'ja');
  assert.equal(resolveLocale({ acceptLanguage: 'ru-RU, en;q=0.8' }), 'ru');
  assert.equal(resolveLocale({ acceptLanguage: 'de-DE', clientDefaultLocale: 'zh-CN' }), 'zh-CN');
  assert.equal(resolveLocale({ acceptLanguage: 'de-DE', clientDefaultLocale: 'unsupported' }), 'en');
});

test('keeps supported ui_locales through login and consent redirect query construction', () => {
  const login = appendUiLocales(new URLSearchParams({ client_id: 'club' }), 'ja-JP ru-RU unsupported');
  const consent = appendUiLocales(new URLSearchParams(login), login.get('ui_locales'));
  assert.equal(login.get('ui_locales'), 'ja ru');
  assert.equal(consent.get('ui_locales'), 'ja ru');
});
