const { normalizeLocale } = require('./locale');

const COPY = {
  'zh-CN': {
    resetSubject: '密码重置请求', resetTitle: '密码重置', resetBody: '您收到此邮件是因为有人请求重置您的密码。', resetAction: '重置密码', resetExpiry: '此链接将在 1 小时后失效。如果您没有请求重置密码，请忽略此邮件。',
    verifySubject: '邮箱验证', verifyTitle: '验证您的邮箱', verifyBody: '感谢您注册！请点击下方链接验证您的邮箱地址：', verifyAction: '验证邮箱', verifyExpiry: '此链接将在 1 小时后失效。',
    codeSubject: '注册邮箱验证码', codeTitle: '邮箱验证码', codeBody: '您正在注册 MindAuth 账户，请使用以下验证码完成注册：', codeExpiry: '验证码将在 5 分钟后失效。如果您未请求注册，请忽略此邮件。',
  },
  en: {
    resetSubject: 'Password reset request', resetTitle: 'Reset your password', resetBody: 'This email was sent because someone requested a password reset for your account.', resetAction: 'Reset password', resetExpiry: 'This link expires in 1 hour. If you did not request a reset, you can ignore this email.',
    verifySubject: 'Verify your email', verifyTitle: 'Verify your email address', verifyBody: 'Thanks for signing up. Use the link below to verify your email address:', verifyAction: 'Verify email', verifyExpiry: 'This link expires in 1 hour.',
    codeSubject: 'Your registration code', codeTitle: 'Email verification code', codeBody: 'Use this code to finish creating your MindAuth account:', codeExpiry: 'This code expires in 5 minutes. If you did not request an account, you can ignore this email.',
  },
  ru: {
    resetSubject: 'Сброс пароля', resetTitle: 'Сбросьте пароль', resetBody: 'Это письмо отправлено, потому что кто-то запросил сброс пароля вашего аккаунта.', resetAction: 'Сбросить пароль', resetExpiry: 'Ссылка действительна 1 час. Если вы не запрашивали сброс, просто проигнорируйте письмо.',
    verifySubject: 'Подтверждение почты', verifyTitle: 'Подтвердите адрес почты', verifyBody: 'Спасибо за регистрацию. Перейдите по ссылке ниже, чтобы подтвердить адрес почты:', verifyAction: 'Подтвердить почту', verifyExpiry: 'Ссылка действительна 1 час.',
    codeSubject: 'Код для регистрации', codeTitle: 'Код подтверждения почты', codeBody: 'Введите этот код, чтобы создать аккаунт MindAuth:', codeExpiry: 'Код действителен 5 минут. Если вы не регистрировались, проигнорируйте письмо.',
  },
  ja: {
    resetSubject: 'パスワード再設定のご案内', resetTitle: 'パスワードを再設定', resetBody: 'アカウントのパスワード再設定がリクエストされたため、このメールをお送りしています。', resetAction: 'パスワードを再設定', resetExpiry: 'リンクの有効期限は 1 時間です。心当たりがない場合は、このメールを無視してください。',
    verifySubject: 'メールアドレスの確認', verifyTitle: 'メールアドレスを確認', verifyBody: 'ご登録ありがとうございます。次のリンクからメールアドレスを確認してください。', verifyAction: 'メールアドレスを確認', verifyExpiry: 'リンクの有効期限は 1 時間です。',
    codeSubject: '登録確認コード', codeTitle: 'メール確認コード', codeBody: '次のコードを入力して、MindAuth アカウントの作成を完了してください。', codeExpiry: 'コードの有効期限は 5 分です。登録した覚えがない場合は、このメールを無視してください。',
  },
};

function resolveMailLocale(preferredLocale, acceptLanguage) {
  return normalizeLocale(preferredLocale)
    || String(acceptLanguage || '').split(',').map(item => normalizeLocale(item.split(';')[0])).find(Boolean)
    || 'zh-CN';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderLinkEmail(locale, kind, link) {
  const copy = COPY[resolveMailLocale(locale)];
  const isReset = kind === 'reset';
  const title = isReset ? copy.resetTitle : copy.verifyTitle;
  const body = isReset ? copy.resetBody : copy.verifyBody;
  const action = isReset ? copy.resetAction : copy.verifyAction;
  const expiry = isReset ? copy.resetExpiry : copy.verifyExpiry;
  return {
    subject: isReset ? copy.resetSubject : copy.verifySubject,
    html: `<div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif"><h2 style="color:#3b82f6">${title}</h2><p>${body}</p><p style="margin:20px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;background:${isReset ? '#3b82f6' : '#22c55e'};color:white;text-decoration:none;border-radius:4px">${action}</a></p><p style="color:#666;font-size:12px">${expiry}</p></div>`,
  };
}

function buildPasswordResetEmail(locale, link) {
  return renderLinkEmail(locale, 'reset', link);
}

function buildVerificationEmail(locale, link) {
  return renderLinkEmail(locale, 'verify', link);
}

function buildRegistrationCodeEmail(locale, code) {
  const copy = COPY[resolveMailLocale(locale)];
  return {
    subject: copy.codeSubject,
    html: `<div style="max-width:600px;margin:0 auto;padding:20px;font-family:Arial,sans-serif"><h2 style="color:#3b82f6">${copy.codeTitle}</h2><p>${copy.codeBody}</p><p style="margin:20px 0;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;color:#3b82f6">${escapeHtml(code)}</p><p style="color:#666;font-size:12px">${copy.codeExpiry}</p></div>`,
  };
}

module.exports = { resolveMailLocale, buildPasswordResetEmail, buildVerificationEmail, buildRegistrationCodeEmail };
