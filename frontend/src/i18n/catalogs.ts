export type Locale = 'zh-CN' | 'en' | 'ru' | 'ja';

export const SUPPORTED_LOCALES: readonly Locale[] = ['zh-CN', 'en', 'ru', 'ja'];

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    'language.label': '语言', 'language.zh-CN': '简体中文', 'language.en': 'English', 'language.ru': 'Русский', 'language.ja': '日本語',
    'brand.account': '用户中心', 'brand.back': '返回论坛', 'brand.powered': 'MindAuth 为 MDTBBS 及关联社区应用提供统一账号服务。',
    'brand.tagline': 'Mindustry 中文玩家社区', 'brand.description': '寻找 Mod、地图、蓝图与讨论。', 'brand.visit': '访问 MDTBBS',
    'auth.continue': '登录后继续访问 {client}', 'auth.directDescription': '使用 MindAuth 账号访问社区与关联服务。', 'auth.login': '登录',
    'auth.register': '注册', 'auth.noAccount': '没有账号？', 'auth.haveAccount': '已有账号？', 'auth.forgot': '忘记密码', 'auth.usernameOrEmail': '用户名或邮箱',
    'auth.password': '密码', 'auth.usernamePlaceholder': '请输入用户名或邮箱', 'auth.passwordPlaceholder': '请输入密码',
    'auth.loginError': '登录失败', 'auth.connecting': '正在连接应用：{client}', 'auth.chooseLogin': '选择登录方式',
    'auth.passwordTab': '账号密码', 'auth.qq': 'QQ 登录', 'auth.qqDescription': '使用已绑定的 QQ 账号登录 MDTBBS。', 'auth.loginWithQQ': '使用 QQ 登录',
    'auth.loginSuccess': '登录成功', 'auth.loginFailed': '登录失败', 'auth.enterCredentials': '请输入用户名/邮箱和密码',
    'oauth.title': '确认应用授权', 'oauth.description': '请确认应用的身份和它申请的权限。',
    'error.emailVerification': '请先验证邮箱，再创建开发者应用。', 'error.phoneVerification': 'MDTBBS 生态的开发者应用需要验证手机号。',
    'nav.dashboard': '概览', 'nav.account': '账户', 'nav.profile': '个人资料', 'nav.security': '安全', 'nav.sessions': '登录设备', 'nav.activity': '登录记录', 'nav.apps': '应用', 'nav.authorizations': '授权应用', 'nav.messages': '消息', 'nav.notifications': '通知', 'nav.developer': '开发', 'nav.developerApps': '应用管理',
    'nav.securityGroup': '安全', 'nav.messagesGroup': '消息',
    'legal.terms': '用户协议', 'legal.privacy': '隐私政策', 'legal.about': '关于与声明', 'legal.aria': '法律与站点信息',
  },
  en: {
    'language.label': 'Language', 'language.zh-CN': '简体中文', 'language.en': 'English', 'language.ru': 'Русский', 'language.ja': '日本語',
    'brand.account': 'Account', 'brand.back': 'Back to community', 'brand.powered': 'One account for MDTBBS and its community applications.',
    'brand.tagline': 'Mindustry community', 'brand.description': 'Discover mods, maps, schematics and discussions.', 'brand.visit': 'Visit MDTBBS',
    'auth.continue': 'Sign in to continue to {client}', 'auth.directDescription': 'Use your MindAuth account for community services.', 'auth.login': 'Sign in',
    'auth.register': 'Create account', 'auth.noAccount': 'New here?', 'auth.haveAccount': 'Already have an account?', 'auth.forgot': 'Forgot password', 'auth.usernameOrEmail': 'Username or email',
    'auth.password': 'Password', 'auth.usernamePlaceholder': 'Enter your username or email', 'auth.passwordPlaceholder': 'Enter your password',
    'auth.loginError': 'Sign-in failed', 'auth.connecting': 'Connecting to {client}', 'auth.chooseLogin': 'Choose a sign-in method',
    'auth.passwordTab': 'Password', 'auth.qq': 'QQ', 'auth.qqDescription': 'Sign in with a QQ account linked to MDTBBS.', 'auth.loginWithQQ': 'Continue with QQ',
    'auth.loginSuccess': 'Signed in', 'auth.loginFailed': 'Sign-in failed', 'auth.enterCredentials': 'Enter your username or email and password',
    'oauth.title': 'Review access request', 'oauth.description': 'Check the application and permissions before continuing.',
    'error.emailVerification': 'Verify your email before creating a developer application.', 'error.phoneVerification': 'MDTBBS developer applications require a verified phone number.',
    'nav.dashboard': 'Overview', 'nav.account': 'Account', 'nav.profile': 'Profile', 'nav.security': 'Security', 'nav.sessions': 'Sessions', 'nav.activity': 'Sign-in history', 'nav.apps': 'Applications', 'nav.authorizations': 'Authorized apps', 'nav.messages': 'Messages', 'nav.notifications': 'Notifications', 'nav.developer': 'Developer', 'nav.developerApps': 'My applications',
    'nav.securityGroup': 'Security', 'nav.messagesGroup': 'Messages',
    'legal.terms': 'Terms of Service', 'legal.privacy': 'Privacy Policy', 'legal.about': 'About', 'legal.aria': 'Legal and site information',
  },
  ru: {
    'language.label': 'Язык', 'language.zh-CN': '简体中文', 'language.en': 'English', 'language.ru': 'Русский', 'language.ja': '日本語',
    'brand.account': 'Аккаунт', 'brand.back': 'К сообществу', 'brand.powered': 'Единый аккаунт для MDTBBS и связанных приложений сообщества.',
    'brand.tagline': 'Сообщество Mindustry', 'brand.description': 'Моды, карты, схемы и обсуждения.', 'brand.visit': 'Открыть MDTBBS',
    'auth.continue': 'Войдите, чтобы продолжить в {client}', 'auth.directDescription': 'Используйте аккаунт MindAuth для сервисов сообщества.', 'auth.login': 'Войти',
    'auth.register': 'Создать аккаунт', 'auth.noAccount': 'Впервые здесь?', 'auth.haveAccount': 'Уже есть аккаунт?', 'auth.forgot': 'Забыли пароль?', 'auth.usernameOrEmail': 'Имя пользователя или почта',
    'auth.password': 'Пароль', 'auth.usernamePlaceholder': 'Введите имя пользователя или почту', 'auth.passwordPlaceholder': 'Введите пароль',
    'auth.loginError': 'Не удалось войти', 'auth.connecting': 'Подключение к приложению: {client}', 'auth.chooseLogin': 'Выберите способ входа',
    'auth.passwordTab': 'Пароль', 'auth.qq': 'QQ', 'auth.qqDescription': 'Войдите через QQ, связанный с MDTBBS.', 'auth.loginWithQQ': 'Войти через QQ',
    'auth.loginSuccess': 'Вы вошли', 'auth.loginFailed': 'Не удалось войти', 'auth.enterCredentials': 'Введите имя пользователя или почту и пароль',
    'oauth.title': 'Проверка доступа приложения', 'oauth.description': 'Проверьте приложение и запрашиваемые разрешения.',
    'error.emailVerification': 'Подтвердите почту, чтобы создать приложение разработчика.', 'error.phoneVerification': 'Для приложений экосистемы MDTBBS нужен подтверждённый номер телефона.',
    'nav.dashboard': 'Обзор', 'nav.account': 'Аккаунт', 'nav.profile': 'Профиль', 'nav.security': 'Безопасность', 'nav.sessions': 'Сеансы', 'nav.activity': 'История входов', 'nav.apps': 'Приложения', 'nav.authorizations': 'Разрешённые приложения', 'nav.messages': 'Сообщения', 'nav.notifications': 'Уведомления', 'nav.developer': 'Разработка', 'nav.developerApps': 'Мои приложения',
    'nav.securityGroup': 'Безопасность', 'nav.messagesGroup': 'Сообщения',
    'legal.terms': 'Условия использования', 'legal.privacy': 'Политика конфиденциальности', 'legal.about': 'О проекте', 'legal.aria': 'Правовая информация',
  },
  ja: {
    'language.label': '言語', 'language.zh-CN': '简体中文', 'language.en': 'English', 'language.ru': 'Русский', 'language.ja': '日本語',
    'brand.account': 'アカウント', 'brand.back': 'コミュニティに戻る', 'brand.powered': 'MDTBBS と関連コミュニティアプリの共通アカウントです。',
    'brand.tagline': 'Mindustry コミュニティ', 'brand.description': 'Mod、マップ、設計図、ディスカッション。', 'brand.visit': 'MDTBBS を見る',
    'auth.continue': '{client} を続けるにはログインしてください', 'auth.directDescription': 'MindAuth アカウントでコミュニティサービスを利用できます。', 'auth.login': 'ログイン',
    'auth.register': 'アカウントを作成', 'auth.noAccount': '初めてですか？', 'auth.haveAccount': 'すでにアカウントをお持ちですか？', 'auth.forgot': 'パスワードをお忘れですか', 'auth.usernameOrEmail': 'ユーザー名またはメールアドレス',
    'auth.password': 'パスワード', 'auth.usernamePlaceholder': 'ユーザー名またはメールアドレスを入力', 'auth.passwordPlaceholder': 'パスワードを入力',
    'auth.loginError': 'ログインできませんでした', 'auth.connecting': 'アプリに接続中: {client}', 'auth.chooseLogin': 'ログイン方法を選択',
    'auth.passwordTab': 'パスワード', 'auth.qq': 'QQ', 'auth.qqDescription': 'MDTBBS に連携した QQ アカウントでログインします。', 'auth.loginWithQQ': 'QQ で続ける',
    'auth.loginSuccess': 'ログインしました', 'auth.loginFailed': 'ログインできませんでした', 'auth.enterCredentials': 'ユーザー名またはメールアドレスとパスワードを入力してください',
    'oauth.title': 'アプリのアクセスを確認', 'oauth.description': 'アプリ名と要求されている権限を確認してください。',
    'error.emailVerification': '開発者アプリを作成する前にメールアドレスを確認してください。', 'error.phoneVerification': 'MDTBBS の開発者アプリには電話番号の確認が必要です。',
    'nav.dashboard': '概要', 'nav.account': 'アカウント', 'nav.profile': 'プロフィール', 'nav.security': 'セキュリティ', 'nav.sessions': 'セッション', 'nav.activity': 'ログイン履歴', 'nav.apps': 'アプリ', 'nav.authorizations': '許可したアプリ', 'nav.messages': 'メッセージ', 'nav.notifications': '通知', 'nav.developer': '開発者', 'nav.developerApps': 'アプリ管理',
    'nav.securityGroup': 'セキュリティ', 'nav.messagesGroup': 'メッセージ',
    'legal.terms': '利用規約', 'legal.privacy': 'プライバシーポリシー', 'legal.about': 'このサイトについて', 'legal.aria': '法的情報とサイト情報',
  },
};

export function normalizeLocale(value: string | null | undefined): Locale | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-cn')) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru';
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  return null;
}

export function translate(locale: Locale, key: string, values: Record<string, string> = {}) {
  const template = messages[locale][key] || messages.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}
