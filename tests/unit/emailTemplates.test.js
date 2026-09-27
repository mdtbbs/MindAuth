const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveMailLocale,
  buildPasswordResetEmail,
  buildVerificationEmail,
  buildRegistrationCodeEmail,
} = require('../../src/utils/emailTemplates');

test('email locale uses the account preference before Accept-Language', () => {
  assert.equal(resolveMailLocale('ja-JP', 'ru-RU, en;q=0.8'), 'ja');
  assert.equal(resolveMailLocale(null, 'ru-RU, en;q=0.8'), 'ru');
  assert.equal(resolveMailLocale('xx', 'xx, de;q=0.8'), 'zh-CN');
});

test('password reset and verification emails use the selected language', () => {
  const reset = buildPasswordResetEmail('en', 'https://auth.example/reset?token=abc');
  const verify = buildVerificationEmail('ja', 'https://auth.example/verify?token=xyz');

  assert.equal(reset.subject, 'Password reset request');
  assert.match(reset.html, /Reset your password/);
  assert.equal(verify.subject, 'メールアドレスの確認');
  assert.match(verify.html, /メールアドレスを確認/);
});

test('email templates escape values placed in HTML', () => {
  const verification = buildVerificationEmail('en', 'https://auth.example/verify?x="<&');
  const code = buildRegistrationCodeEmail('en', '<script>');

  assert.match(verification.html, /x=&quot;&lt;&amp;/);
  assert.doesNotMatch(code.html, /<script>/);
  assert.match(code.html, /&lt;script&gt;/);
});
