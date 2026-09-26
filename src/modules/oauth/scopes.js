const SCOPE_DESCRIPTIONS = Object.freeze({
  openid: { name: '账户标识', description: '读取用于识别 MDTBBS 账户的稳定标识。' },
  profile: { name: '查看基本资料', description: '允许此应用查看你的用户名、头像等基本账户信息。' },
  email: { name: '查看电子邮箱', description: '允许此应用读取你的邮箱地址和验证状态。' },
  'forum.read': { name: '浏览论坛', description: '允许此应用读取你有权限查看的论坛帖子和回复。' },
  'forum.write': { name: '发布论坛内容', description: '允许此应用以你的身份发布帖子、回复以及执行相关论坛操作。' },
  'resource.read': { name: '浏览资源', description: '允许此应用读取 MDTBBS 中的地图、蓝图、Mod 等资源信息。' },
  'resource.download': { name: '下载资源', description: '允许此应用使用你的账户下载 MDTBBS 资源。' },
  'resource.upload': { name: '上传资源', description: '允许此应用以你的身份提交地图、蓝图、Mod 等资源。' },
  'notification.read': { name: '读取通知', description: '允许此应用读取你的 MDTBBS 通知。' },
  'message.read': { name: '读取你的私信', description: '允许此应用读取你在 MDTBBS 中的私信和会话内容。', sensitive: true },
  'message.write': { name: '发送私信', description: '允许此应用以你的身份向其他用户发送私信。', sensitive: true },
});

const VALID_SCOPES = Object.freeze(Object.keys(SCOPE_DESCRIPTIONS));
const LEGACY_NATIVE_SCOPES = Object.freeze([...VALID_SCOPES, 'game_content']);

function normalizeScopes(value, fallback = []) {
  let scopes = value;
  if (typeof scopes === 'string') {
    try { scopes = JSON.parse(scopes); } catch { scopes = scopes.split(/\s+/); }
  }
  if (!Array.isArray(scopes)) scopes = fallback;
  return [...new Set(scopes.filter(scope => typeof scope === 'string' && VALID_SCOPES.includes(scope)))];
}

module.exports = { SCOPE_DESCRIPTIONS, VALID_SCOPES, LEGACY_NATIVE_SCOPES, normalizeScopes };
