import { useCallback, useState } from 'react';

export type AdminLocale = 'en' | 'ru' | 'ja' | 'zh-CN';

const messages: Record<AdminLocale, Record<string, string>> = {
  en: {
    language: 'Language', pageTitle: 'OAuth client management', createClient: 'Create client', retry: 'Retry', globalEcosystem: 'Global',
    name: 'Name', redirectUris: 'Redirect URIs', ecosystemTypeStatus: 'Ecosystem / type / status', scopes: 'Scopes', pkce: 'PKCE', createdAt: 'Created', ownerUsers: 'Owner / authorizations', lastUsed: 'Last used', actions: 'Actions',
    firstParty: 'First party', thirdParty: 'Third party', pending: 'Pending review', approved: 'Approved', suspended: 'Suspended', rejected: 'Rejected', draft: 'Draft', publicClient: 'Public client', confidentialClient: 'Confidential client', requested: 'Requested: {value}', approvedScopes: 'Approved: {value}', approvedTitle: 'Approved: {value}', s256Required: 'S256 required', enabled: 'Enabled', disabled: 'Off', platformApp: 'Platform app', authorizationCount: '{count} authorizations', readOnly: 'Read only', empty: 'No clients yet',
    edit: 'Edit', rotateSecret: 'Rotate secret', review: 'Review', disable: 'Disable', restore: 'Restore', revokeAll: 'Revoke all authorizations', delete: 'Delete',
    revokeTitle: 'Revoke all client authorizations', cancel: 'Cancel', confirmRevoke: 'Revoke access', revokeBody: 'This will revoke every user authorization for {name} and immediately invalidate its access and refresh tokens. The client will remain active.',
    createTitle: 'Create OAuth client', create: 'Create', ecosystem: 'Ecosystem', clientName: 'Client name', createNamePlaceholder: 'For example: MindFourm', callbackLabel: 'Redirect URIs, one per line', callbackHint: 'HTTPS, custom app schemes, and loopback random ports are supported.', requirePkceRecommended: 'Require PKCE (recommended)',
    editTitle: 'Edit OAuth client', save: 'Save', editNamePlaceholder: 'Client name', requirePkce: 'Require PKCE', allowedScopes: 'Allowed OAuth scopes', scopeChangeWarning: 'Changing scopes on an active client immediately revokes all of its user authorizations and related tokens.',
    deleteTitle: 'Delete client', confirmDelete: 'Confirm delete', deleteBody: 'Delete client {name}? Authorizations that use it will stop working.', rotateTitle: 'Rotate client secret', confirmRotate: 'Rotate secret', rotateBody: 'Generate a new client secret for {name}?', rotateWarning: 'The old secret will stop working immediately. Update applications using it before they can obtain tokens again.',
    secretCreated: 'Client created', secretRotated: 'Secret rotated', createdToast: 'Client created.', updatedToast: 'Client updated.', deletedToast: 'Client deleted.', deleteFailed: 'Could not delete the client.', rotatedToast: 'Secret rotated.', rotateFailed: 'Could not rotate the secret.', reviewApproved: 'Client approved.', reviewSuspended: 'Client suspended.', reviewFailed: 'Could not update the review status.', revokeSuccess: 'All client authorizations and tokens were revoked.', revokeFailed: 'Could not revoke authorizations.', createFailed: 'Could not create the client.', updateFailed: 'Could not update the client.', loadFailed: 'Could not load clients.', nameRequired: 'A client name is required.', scopeRequired: 'Select at least one OAuth scope.', redirectRequired: 'Add at least one redirect URI.', redirectCredentials: 'Redirect URIs cannot contain credentials or a fragment.', redirectPrivate: 'Redirect URIs cannot use private network addresses.', redirectUnsafeScheme: 'The custom redirect scheme is invalid or unsafe.', invalidUrl: 'Invalid URL: {value}',
    savedClose: 'I saved it, close', saveSecretNow: 'Save this client secret now. It will not be shown again after closing this dialog.', clientId: 'Client ID', clientSecret: 'Client Secret',
  },
  ru: {
    language: 'Язык', pageTitle: 'Управление OAuth-клиентами', createClient: 'Создать клиент', retry: 'Повторить', globalEcosystem: 'Общая',
    name: 'Название', redirectUris: 'URI перенаправления', ecosystemTypeStatus: 'Экосистема / тип / статус', scopes: 'Права', pkce: 'PKCE', createdAt: 'Создан', ownerUsers: 'Владелец / авторизации', lastUsed: 'Последнее использование', actions: 'Действия',
    firstParty: 'Первый', thirdParty: 'Сторонний', pending: 'Ожидает проверки', approved: 'Одобрен', suspended: 'Приостановлен', rejected: 'Отклонён', draft: 'Черновик', publicClient: 'Публичный клиент', confidentialClient: 'Конфиденциальный клиент', requested: 'Запрошено: {value}', approvedScopes: 'Одобрено: {value}', approvedTitle: 'Одобрено: {value}', s256Required: 'Требуется S256', enabled: 'Включено', disabled: 'Выключено', platformApp: 'Приложение платформы', authorizationCount: 'Авторизаций: {count}', readOnly: 'Только чтение', empty: 'Клиентов пока нет',
    edit: 'Изменить', rotateSecret: 'Сменить секрет', review: 'Проверить', disable: 'Отключить', restore: 'Восстановить', revokeAll: 'Отозвать все разрешения', delete: 'Удалить',
    revokeTitle: 'Отозвать все разрешения клиента', cancel: 'Отмена', confirmRevoke: 'Отозвать доступ', revokeBody: 'Будут отозваны все разрешения пользователей для {name}, а его токены доступа и обновления немедленно станут недействительными. Клиент останется включённым.',
    createTitle: 'Создать OAuth-клиент', create: 'Создать', ecosystem: 'Экосистема', clientName: 'Название клиента', createNamePlaceholder: 'Например: MindFourm', callbackLabel: 'URI перенаправления, по одному в строке', callbackHint: 'Поддерживаются HTTPS, пользовательские схемы приложений и случайные loopback-порты.', requirePkceRecommended: 'Требовать PKCE (рекомендуется)',
    editTitle: 'Изменить OAuth-клиент', save: 'Сохранить', editNamePlaceholder: 'Название клиента', requirePkce: 'Требовать PKCE', allowedScopes: 'Разрешённые права OAuth', scopeChangeWarning: 'Изменение прав активного клиента немедленно отзывает все разрешения пользователей и связанные токены.',
    deleteTitle: 'Удалить клиента', confirmDelete: 'Подтвердить удаление', deleteBody: 'Удалить клиента {name}? Его авторизации перестанут работать.', rotateTitle: 'Сменить секрет клиента', confirmRotate: 'Сменить секрет', rotateBody: 'Создать новый секрет клиента для {name}?', rotateWarning: 'Старый секрет сразу перестанет работать. Обновите настройки приложений, чтобы они могли получать токены.',
    secretCreated: 'Клиент создан', secretRotated: 'Секрет изменён', createdToast: 'Клиент создан.', updatedToast: 'Клиент обновлён.', deletedToast: 'Клиент удалён.', deleteFailed: 'Не удалось удалить клиента.', rotatedToast: 'Секрет изменён.', rotateFailed: 'Не удалось сменить секрет.', reviewApproved: 'Клиент одобрен.', reviewSuspended: 'Клиент приостановлен.', reviewFailed: 'Не удалось изменить статус проверки.', revokeSuccess: 'Все разрешения и токены клиента отозваны.', revokeFailed: 'Не удалось отозвать разрешения.', createFailed: 'Не удалось создать клиента.', updateFailed: 'Не удалось обновить клиента.', loadFailed: 'Не удалось загрузить список клиентов.', nameRequired: 'Укажите название клиента.', scopeRequired: 'Выберите хотя бы одно право OAuth.', redirectRequired: 'Добавьте хотя бы один URI перенаправления.', redirectCredentials: 'URI перенаправления не может содержать учётные данные или фрагмент.', redirectPrivate: 'Нельзя использовать адрес частной сети.', redirectUnsafeScheme: 'Пользовательская схема перенаправления некорректна или небезопасна.', invalidUrl: 'Некорректный URL: {value}',
    savedClose: 'Сохранить и закрыть', saveSecretNow: 'Сохраните секрет клиента сейчас. После закрытия он больше не будет показан.', clientId: 'Client ID', clientSecret: 'Client Secret',
  },
  ja: {
    language: '言語', pageTitle: 'OAuth クライアント管理', createClient: 'クライアントを作成', retry: '再試行', globalEcosystem: 'グローバル',
    name: '名前', redirectUris: 'リダイレクト URI', ecosystemTypeStatus: 'エコシステム / 種類 / 状態', scopes: 'スコープ', pkce: 'PKCE', createdAt: '作成日', ownerUsers: '所有者 / 認可数', lastUsed: '最終使用', actions: '操作',
    firstParty: '公式', thirdParty: 'サードパーティ', pending: '審査待ち', approved: '承認済み', suspended: '停止中', rejected: '却下', draft: '下書き', publicClient: 'パブリッククライアント', confidentialClient: '機密クライアント', requested: '申請: {value}', approvedScopes: '承認: {value}', approvedTitle: '承認済み: {value}', s256Required: 'S256 必須', enabled: '有効', disabled: '無効', platformApp: 'プラットフォームアプリ', authorizationCount: '{count} 件の認可', readOnly: '読み取り専用', empty: 'クライアントはありません',
    edit: '編集', rotateSecret: 'シークレットを更新', review: '審査', disable: '停止', restore: '再開', revokeAll: 'すべての認可を取り消す', delete: '削除',
    revokeTitle: 'クライアントの認可をすべて取り消す', cancel: 'キャンセル', confirmRevoke: 'アクセスを取り消す', revokeBody: '{name} のすべてのユーザー認可を取り消し、関連するアクセストークンとリフレッシュトークンを直ちに無効にします。クライアント自体は有効のままです。',
    createTitle: 'OAuth クライアントを作成', create: '作成', ecosystem: 'エコシステム', clientName: 'クライアント名', createNamePlaceholder: '例: MindFourm', callbackLabel: 'リダイレクト URI（1 行に 1 件）', callbackHint: 'HTTPS、カスタムアプリスキーム、loopback のランダムポートに対応しています。', requirePkceRecommended: 'PKCE を必須にする（推奨）',
    editTitle: 'OAuth クライアントを編集', save: '保存', editNamePlaceholder: 'クライアント名', requirePkce: 'PKCE を必須にする', allowedScopes: '許可する OAuth スコープ', scopeChangeWarning: '有効なクライアントのスコープを変更すると、すべてのユーザー認可と関連トークンが直ちに取り消されます。',
    deleteTitle: 'クライアントを削除', confirmDelete: '削除を確定', deleteBody: 'クライアント {name} を削除しますか？このクライアントを使う認可は無効になります。', rotateTitle: 'クライアントシークレットを更新', confirmRotate: 'シークレットを更新', rotateBody: '{name} の新しいクライアントシークレットを生成しますか？', rotateWarning: '古いシークレットは直ちに無効になります。トークン取得を続けるにはアプリの設定を更新してください。',
    secretCreated: 'クライアントを作成しました', secretRotated: 'シークレットを更新しました', createdToast: 'クライアントを作成しました。', updatedToast: 'クライアントを更新しました。', deletedToast: 'クライアントを削除しました。', deleteFailed: 'クライアントを削除できませんでした。', rotatedToast: 'シークレットを更新しました。', rotateFailed: 'シークレットを更新できませんでした。', reviewApproved: 'クライアントを承認しました。', reviewSuspended: 'クライアントを停止しました。', reviewFailed: '審査状態を更新できませんでした。', revokeSuccess: 'クライアントの認可とトークンをすべて取り消しました。', revokeFailed: '認可を取り消せませんでした。', createFailed: 'クライアントを作成できませんでした。', updateFailed: 'クライアントを更新できませんでした。', loadFailed: 'クライアント一覧を読み込めませんでした。', nameRequired: 'クライアント名を入力してください。', scopeRequired: 'OAuth スコープを 1 つ以上選択してください。', redirectRequired: 'リダイレクト URI を 1 つ以上入力してください。', redirectCredentials: 'リダイレクト URI に認証情報やフラグメントは指定できません。', redirectPrivate: 'プライベートネットワークのアドレスは使用できません。', redirectUnsafeScheme: 'カスタムリダイレクトスキームが無効または安全ではありません。', invalidUrl: '無効な URL: {value}',
    savedClose: '保存して閉じる', saveSecretNow: 'クライアントシークレットを今すぐ保存してください。閉じると再表示できません。', clientId: 'Client ID', clientSecret: 'Client Secret',
  },
  'zh-CN': {
    language: '语言', pageTitle: 'OAuth 客户端管理', createClient: '创建客户端', retry: '重试', globalEcosystem: '全球',
    name: '名称', redirectUris: '回调地址', ecosystemTypeStatus: '生态 / 应用类型 / 状态', scopes: 'Scope', pkce: 'PKCE', createdAt: '创建时间', ownerUsers: '所有者 / 授权用户', lastUsed: '最近使用', actions: '操作',
    firstParty: '第一方', thirdParty: '第三方', pending: '待审核', approved: '已启用', suspended: '已停用', rejected: '已拒绝', draft: '草稿', publicClient: 'Public Client', confidentialClient: 'Confidential Client', requested: '申请：{value}', approvedScopes: '批准：{value}', approvedTitle: '已批准：{value}', s256Required: '必须使用 S256', enabled: '启用', disabled: '关闭', platformApp: '平台应用', authorizationCount: '{count} 人授权', readOnly: '只读', empty: '暂无客户端',
    edit: '编辑', rotateSecret: '轮换密钥', review: '前往审核', disable: '停用', restore: '恢复', revokeAll: '撤销全部授权', delete: '删除',
    revokeTitle: '撤销客户端全部授权', cancel: '取消', confirmRevoke: '确认撤销', revokeBody: '将撤销 {name} 的全部用户授权，并立即吊销相关 access token 和 refresh token。此操作不会停用客户端。',
    createTitle: '创建 OAuth 客户端', create: '创建', ecosystem: '所属生态', clientName: '客户端名称', createNamePlaceholder: '例如: MindFourm', callbackLabel: '回调地址（Redirect URI），每行一个', callbackHint: '支持 HTTPS、自定义应用协议，以及 loopback 随机端口。', requirePkceRecommended: '要求 PKCE（推荐）',
    editTitle: '编辑 OAuth 客户端', save: '保存', editNamePlaceholder: '客户端名称', requirePkce: '要求 PKCE', allowedScopes: '允许的 OAuth Scope', scopeChangeWarning: '修改已启用客户端的 Scope 会立即撤销它的全部用户授权及相关令牌。',
    deleteTitle: '删除客户端', confirmDelete: '确认删除', deleteBody: '确认删除客户端 {name}？所有使用该客户端的授权将失效。', rotateTitle: '轮换客户端密钥', confirmRotate: '确认轮换', rotateBody: '确认为客户端 {name} 生成新的 Client Secret？', rotateWarning: '旧密钥将立即失效。使用旧密钥的应用需要更新配置后才能继续换取令牌。',
    secretCreated: '客户端创建成功', secretRotated: '密钥轮换成功', createdToast: '客户端已创建', updatedToast: '客户端已更新', deletedToast: '客户端已删除', deleteFailed: '删除失败', rotatedToast: '密钥已轮换', rotateFailed: '轮换密钥失败', reviewApproved: '应用已启用', reviewSuspended: '应用已停用', reviewFailed: '审核操作失败', revokeSuccess: '该客户端的全部授权和令牌已撤销', revokeFailed: '撤销授权失败', createFailed: '创建失败', updateFailed: '更新失败', loadFailed: '获取客户端列表失败', nameRequired: '名称必填', scopeRequired: '至少选择一个 OAuth Scope', redirectRequired: '至少需要一个回调地址', redirectCredentials: '回调地址不能包含用户凭证或 fragment', redirectPrivate: '回调地址不能使用内网地址', redirectUnsafeScheme: '自定义回调协议不安全或格式不正确', invalidUrl: '无效的 URL 格式：{value}',
    savedClose: '我已保存，关闭', saveSecretNow: '请立即保存 Client Secret，关闭后将无法再次查看！', clientId: 'Client ID', clientSecret: 'Client Secret',
  },
};

function initialLocale(): AdminLocale {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem('mindauth_admin_locale');
  if (saved === 'en' || saved === 'ru' || saved === 'ja' || saved === 'zh-CN') return saved;
  const browser = window.navigator.language.toLowerCase();
  if (browser.startsWith('ru')) return 'ru';
  if (browser.startsWith('ja')) return 'ja';
  if (browser.startsWith('zh')) return 'zh-CN';
  return 'en';
}

export function useAdminClientsI18n() {
  const [locale, setLocale] = useState<AdminLocale>(initialLocale);
  const t = useCallback((key: string, values: Record<string, string | number> = {}) => {
    const template = messages[locale][key] || messages.en[key] || key;
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? ''));
  }, [locale]);
  const changeLocale = useCallback((value: AdminLocale) => {
    setLocale(value);
    window.localStorage.setItem('mindauth_admin_locale', value);
  }, []);
  return { locale, setLocale: changeLocale, t };
}
