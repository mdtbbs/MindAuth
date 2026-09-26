import { useEffect, useState } from 'react';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AccountSection, AccountLoadState } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';

const SCOPE_OPTIONS = [
  ['openid', '账户标识', '读取稳定账户标识。'],
  ['profile', '基本资料', '读取用户名、头像和公开账户状态。'],
  ['email', '电子邮箱', '读取邮箱地址和验证状态。'],
  ['forum.read', '读取论坛', '浏览帖子、回复和公开论坛资料。'],
  ['forum.write', '写入论坛', '代表你创建或修改帖子、回复等内容。'],
  ['resource.read', '读取资源', '浏览 MDTBBS 资源和版本信息。'],
  ['resource.download', '下载资源', '获取已发布资源的下载地址。'],
  ['resource.upload', '上传资源', '申请上传并提交资源，论坛仍会执行权限和审核检查。'],
  ['notification.read', '读取通知', '查看通知并标记已读。'],
  ['message.read', '读取私信', '读取你的私信会话和消息。'],
  ['message.write', '发送私信', '代表你发送私信。'],
] as const;

type DeveloperApplication = {
  id: number; client_id: string; name: string; description: string | null; website_url: string | null;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';
  requested_scopes: string[]; approved_scopes: string[]; redirect_uris: { redirect_uri: string }[];
  usage?: {
    authorization_count: number; last_used_at: string | null; requests_30d?: number;
    recent_errors?: { metric_date: string; error_count: number; last_error_at: string; last_error_code: string }[];
  };
};
type ApplicationsResponse = { success: boolean; applications: DeveloperApplication[] };
const STATUS_LABEL: Record<DeveloperApplication['status'], string> = {
  draft: '草稿', pending: '审核中', approved: '已批准', rejected: '已拒绝', suspended: '已停用',
};

export function DeveloperPage() {
  const { user } = useAuth();
  const [applications, setApplications] = useState<DeveloperApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<DeveloperApplication | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [redirectUris, setRedirectUris] = useState('');
  const [scopes, setScopes] = useState<string[]>(['openid', 'profile']);

  async function loadApplications() {
    setLoading(true);
    try {
      const response = await api.get<ApplicationsResponse>('/api/developer/clients');
      setApplications(response.applications || []);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '获取应用失败');
    } finally { setLoading(false); }
  }

  useEffect(() => { if (user) void loadApplications(); }, [user]);

  function resetForm() {
    setEditing(null); setName(''); setDescription(''); setWebsite(''); setRedirectUris('');
    setScopes(['openid', 'profile']); setError('');
  }

  function editApplication(application: DeveloperApplication) {
    setEditing(application); setName(application.name); setDescription(application.description || '');
    setWebsite(application.website_url || '');
    setRedirectUris(application.redirect_uris.map(item => item.redirect_uri).join('\n'));
    setScopes(application.requested_scopes); setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveApplication() {
    setSaving(true); setError('');
    const body = {
      name: name.trim(), description: description.trim(), website_url: website.trim() || null,
      redirect_uris: redirectUris.split('\n').map(item => item.trim()).filter(Boolean), requested_scopes: scopes,
    };
    try {
      if (editing) await api.put(`/api/developer/clients/${editing.id}`, body);
      else await api.post('/api/developer/clients', body);
      resetForm(); await loadApplications();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '保存应用失败');
    } finally { setSaving(false); }
  }

  async function submitApplication(application: DeveloperApplication) {
    setSaving(true); setError('');
    try {
      await api.post(`/api/developer/clients/${application.id}/submit`, {});
      await loadApplications();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '提交审核失败');
    } finally { setSaving(false); }
  }

  return (
    <AccountShell title="开发者中心" description="创建和管理 MDTBBS Public Client OAuth 应用。Public Client 只使用 Authorization Code + PKCE，不会获得 client_secret。">
      <div className="account-page-sections">
        <AccountSection title={editing ? '编辑应用申请' : '申请 Public Client'} description="申请通过后，应用会获得公开 client_id；访问仍受用户授权、OAuth scope 和论坛策略共同控制。">
          <div className="stack">
            <TextField label="应用名称" value={name} onChange={event => setName(event.target.value)} maxLength={120} />
            <label className="field"><span className="field__label">应用说明</span><textarea className="field__input" value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={2000} /></label>
            <TextField label="应用主页（HTTPS）" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" />
            <label className="field"><span className="field__label">Redirect URI（每行一个）</span><textarea className="field__input" value={redirectUris} onChange={event => setRedirectUris(event.target.value)} rows={4} placeholder={'https://example.com/oauth/callback\nmyapp://oauth/callback\nhttp://127.0.0.1:0/callback'} /><span className="field__hint">HTTPS 网站、自定义应用协议，以及 127.0.0.1 / [::1] loopback。loopback 注册端口为 0 时可使用运行时随机端口。</span></label>
            <fieldset className="stack"><legend className="field__label">申请的权限 scope</legend>
              {SCOPE_OPTIONS.map(([scope, label, help]) => (
                <label className="cluster" key={scope} style={{ alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                  <input type="checkbox" checked={scopes.includes(scope)} onChange={event => setScopes(current => event.target.checked ? [...current, scope] : current.filter(item => item !== scope))} />
                  <span><strong>{label}</strong><br /><small>{scope} · {help}</small></span>
                </label>
              ))}
            </fieldset>
            {error ? <p className="status-badge status-badge--danger" role="alert">{error}</p> : null}
            <div className="cluster">
              <Button type="button" disabled={saving} onClick={() => void saveApplication()}>{saving ? '保存中…' : editing ? '保存草稿' : '创建草稿'}</Button>
              {editing ? <Button type="button" variant="secondary" onClick={resetForm}>取消编辑</Button> : null}
            </div>
          </div>
        </AccountSection>

        <AccountSection title="我的应用" description="审核通过后，在此查看 client_id、批准的权限和最近使用情况。">
          <AccountLoadState loading={loading} error={null} retry={loadApplications}>
            {applications.length ? <div className="account-list">{applications.map(application => (
              <article className="authorization-item" key={application.id}>
                <div className="authorization-item__header"><div><h3>{application.name}</h3><p>{STATUS_LABEL[application.status]} · Public Client</p></div></div>
                <p>{application.description || '未填写应用说明'}</p>
                <p>Client ID：<code>{application.client_id}</code></p>
                <p>Redirect URI：{application.redirect_uris.map(item => item.redirect_uri).join('、')}</p>
                <p>申请 scope：{application.requested_scopes.join(' ')}</p>
                {application.status === 'approved' ? <><p>批准 scope：{application.approved_scopes.join(' ')}</p><p>授权用户数：{application.usage?.authorization_count ?? 0}；最近使用：{application.usage?.last_used_at ? new Date(application.usage.last_used_at).toLocaleString() : '暂无'}；近 30 天 OAuth 请求：{application.usage?.requests_30d ?? 0}</p>{application.usage?.recent_errors?.length ? <div><p>最近错误（每日聚合）：</p><ul>{application.usage.recent_errors.map((entry) => <li key={entry.metric_date}>{entry.metric_date} · {entry.last_error_code} · {entry.error_count} 次 · {entry.last_error_at ? new Date(entry.last_error_at).toLocaleString() : ''}</li>)}</ul></div> : <p>最近无 OAuth 错误记录</p>}</> : null}
                <div className="cluster">
                  {['draft', 'rejected'].includes(application.status) ? <><Button size="sm" variant="secondary" onClick={() => editApplication(application)}>编辑</Button><Button size="sm" disabled={saving} onClick={() => void submitApplication(application)}>提交审核</Button></> : null}
                  {application.status === 'approved' ? <Button size="sm" variant="secondary" disabled={saving} onClick={() => { if (window.confirm('停用后应用令牌会立即失效，用户需要重新授权。确定继续吗？')) void api.post(`/api/developer/clients/${application.id}/deactivate`, {}).then(loadApplications).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '停用应用失败')); }}>停用应用</Button> : null}
                </div>
              </article>
            ))}</div> : <p>还没有应用申请。</p>}
          </AccountLoadState>
        </AccountSection>
        <AccountSection title="Public Client 接入" description="所有客户端共用标准 OAuth，不存在 Xenon 等应用的硬编码特权。">
          <div className="developer-panel"><p>客户端使用系统浏览器打开 MindAuth，通过 Authorization Code + PKCE S256 登录，再以 client_id、授权码、redirect_uri 和 verifier 换取令牌。注册、密码、验证码和风控都留在 MindAuth 网站。</p><a className="btn btn--secondary" href="/docs.html">查看 OAuth 接入文档</a><p><a className="account-text-link" href="/authorizations">管理已授权应用 →</a></p></div>
        </AccountSection>
      </div>
    </AccountShell>
  );
}
