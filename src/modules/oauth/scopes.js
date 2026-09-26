const SCOPE_DESCRIPTIONS = Object.freeze({
  openid: { name: '账户标识', description: '读取用于识别 MDTBBS 账户的稳定标识。' },
  profile: { name: '基本资料', description: '读取用户名、头像和公开账户状态。' },
  email: { name: '电子邮箱', description: '读取邮箱地址和验证状态。' },
  'forum.read': { name: '读取论坛', description: '浏览帖子、回复和公开论坛资料。' },
  'forum.write': { name: '写入论坛', description: '代表你创建或修改帖子、回复等内容。' },
  'resource.read': { name: '读取资源', description: '浏览 MDTBBS 资源和版本信息。' },
  'resource.download': { name: '下载资源', description: '获取已发布资源的下载地址。' },
  'resource.upload': { name: '上传资源', description: '申请创建、上传和提交资源；论坛仍会执行审核与权限检查。' },
  'notification.read': { name: '读取通知', description: '查看你的 MDTBBS 通知并标记已读。' },
  'message.read': { name: '读取私信', description: '读取你的私信会话和消息。' },
  'message.write': { name: '发送私信', description: '代表你发送私信；论坛设置和用户规则仍然适用。' },
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
