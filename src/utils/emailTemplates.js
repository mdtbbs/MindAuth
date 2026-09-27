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

const NOTIFICATION_COPY = {
  'zh-CN': {
    passwordTitle: '密码已修改', passwordBody: '您的登录密码已修改。若这不是您本人的操作，请立即联系管理员。',
    usernameTitle: '用户名已修改', usernameBody: (data) => `用户名已从“${data.oldUsername || '未知'}”改为“${data.newUsername || '未知'}”。`,
    lockedTitle: '账号暂时锁定', lockedBody: (data) => `由于多次登录失败，账号已锁定 ${data.durationMinutes || 0} 分钟。`,
    loginTitle: '检测到新设备登录', loginBody: (data) => `设备：${data.deviceName || '未知设备'}\nIP：${data.ipAddress || '未知'}`,
    bannedTitle: '账号已被封禁', bannedBody: (data) => data.reason ? `原因：${data.reason}` : '管理员已限制此账号。',
    unbannedTitle: '账号已解封', unbannedBody: '账号访问权限已恢复。',
    genericTitle: '账号安全通知', genericBody: '您的账号有一项安全相关更新。', footer: '此邮件由 MindAuth 自动发送，请勿回复。',
  },
  en: {
    passwordTitle: 'Password changed', passwordBody: 'Your sign-in password was changed. If you did not make this change, contact the site administrators.',
    usernameTitle: 'Username changed', usernameBody: (data) => `Your username changed from “${data.oldUsername || 'unknown'}” to “${data.newUsername || 'unknown'}”.`,
    lockedTitle: 'Account temporarily locked', lockedBody: (data) => `Your account was locked for ${data.durationMinutes || 0} minutes after repeated unsuccessful sign-in attempts.`,
    loginTitle: 'New device sign-in', loginBody: (data) => `Device: ${data.deviceName || 'Unknown device'}\nIP: ${data.ipAddress || 'Unknown'}`,
    bannedTitle: 'Account restricted', bannedBody: (data) => data.reason ? `Reason: ${data.reason}` : 'An administrator has restricted this account.',
    unbannedTitle: 'Account restriction lifted', unbannedBody: 'Access to your account has been restored.',
    genericTitle: 'Account security notice', genericBody: 'There is a security-related update for your account.', footer: 'This email was sent automatically by MindAuth. Please do not reply.',
  },
  ru: {
    passwordTitle: 'Пароль изменён', passwordBody: 'Пароль для входа в аккаунт изменён. Если это сделали не вы, свяжитесь с администраторами сайта.',
    usernameTitle: 'Имя пользователя изменено', usernameBody: (data) => `Имя пользователя изменено с «${data.oldUsername || 'неизвестно'}» на «${data.newUsername || 'неизвестно'}».`,
    lockedTitle: 'Временная блокировка аккаунта', lockedBody: (data) => `Аккаунт заблокирован на ${data.durationMinutes || 0} мин. из-за нескольких неудачных попыток входа.`,
    loginTitle: 'Вход с нового устройства', loginBody: (data) => `Устройство: ${data.deviceName || 'неизвестное устройство'}\nIP: ${data.ipAddress || 'неизвестно'}`,
    bannedTitle: 'Доступ к аккаунту ограничен', bannedBody: (data) => data.reason ? `Причина: ${data.reason}` : 'Администратор ограничил доступ к аккаунту.',
    unbannedTitle: 'Ограничение снято', unbannedBody: 'Доступ к аккаунту восстановлен.',
    genericTitle: 'Уведомление безопасности аккаунта', genericBody: 'Для вашего аккаунта есть обновление, связанное с безопасностью.', footer: 'Это автоматическое письмо MindAuth. Не отвечайте на него.',
  },
  ja: {
    passwordTitle: 'パスワードを変更しました', passwordBody: 'ログインパスワードが変更されました。心当たりがない場合は、サイト管理者にご連絡ください。',
    usernameTitle: 'ユーザー名を変更しました', usernameBody: (data) => `ユーザー名を「${data.oldUsername || '不明'}」から「${data.newUsername || '不明'}」に変更しました。`,
    lockedTitle: 'アカウントを一時的にロックしました', lockedBody: (data) => `ログインに複数回失敗したため、アカウントを ${data.durationMinutes || 0} 分間ロックしました。`,
    loginTitle: '新しい端末からのログイン', loginBody: (data) => `端末：${data.deviceName || '不明な端末'}\nIP：${data.ipAddress || '不明'}`,
    bannedTitle: 'アカウントの利用が制限されています', bannedBody: (data) => data.reason ? `理由：${data.reason}` : '管理者がアカウントの利用を制限しました。',
    unbannedTitle: 'アカウントの制限を解除しました', unbannedBody: 'アカウントを再び利用できます。',
    genericTitle: 'アカウントのセキュリティ通知', genericBody: 'アカウントのセキュリティに関する更新があります。', footer: 'このメールは MindAuth から自動送信されています。返信しないでください。',
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

function localizeNotification(locale, type, data = {}) {
  const copy = NOTIFICATION_COPY[resolveMailLocale(locale)];
  const entries = {
    password_changed: ['passwordTitle', 'passwordBody'],
    username_changed: ['usernameTitle', 'usernameBody'],
    account_locked: ['lockedTitle', 'lockedBody'],
    login_new_device: ['loginTitle', 'loginBody'],
    account_banned: ['bannedTitle', 'bannedBody'],
    account_unbanned: ['unbannedTitle', 'unbannedBody'],
  };
  const keys = entries[type];
  if (!keys) return null;
  const [titleKey, bodyKey] = keys;
  return { title: copy[titleKey], content: copy[bodyKey](data) };
}

function buildNotificationEmail(locale, input = {}) {
  const copy = NOTIFICATION_COPY[resolveMailLocale(locale)];
  const localized = localizeNotification(locale, input.type, input.emailData || {});
  const title = localized?.title || input.title || copy.genericTitle;
  const content = localized?.content || input.content || copy.genericBody;
  const htmlContent = escapeHtml(content).replace(/\r?\n/g, '<br>');
  return {
    subject: `[MindAuth] ${title}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#ff6b35">${escapeHtml(title)}</h2><p>${htmlContent}</p>${input.ip_address && input.type !== 'login_new_device' ? `<p style="color:#666;font-size:12px">IP: ${escapeHtml(input.ip_address)}</p>` : ''}<hr style="border:0;border-top:1px solid #eee;margin:20px 0"><p style="color:#999;font-size:12px">${escapeHtml(copy.footer)}</p></div>`,
  };
}

module.exports = {
  resolveMailLocale,
  buildPasswordResetEmail,
  buildVerificationEmail,
  buildRegistrationCodeEmail,
  localizeNotification,
  buildNotificationEmail,
};
