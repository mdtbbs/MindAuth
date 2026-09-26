import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AccountLoadState, AccountSection } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';

const SCOPE_OPTIONS = [
  ['profile', '查看基本资料', '允许应用查看你的用户名、头像等基本账户信息。'],
  ['forum.read', '浏览论坛', '读取你有权限查看的帖子和回复。'],
  ['forum.write', '发布论坛内容', '以你的身份发布帖子、回复以及执行相关论坛操作。'],
  ['resource.read', '浏览资源', '读取地图、蓝图、Mod 等资源信息。'],
  ['resource.download', '下载资源', '使用你的账户下载 MDTBBS 资源。'],
  ['resource.upload', '上传资源', '以你的身份提交地图、蓝图、Mod 等资源。'],
  ['notification.read', '读取通知', '读取你的 MDTBBS 通知。'],
  ['message.read', '读取私信', '读取你的私信和会话内容。'],
  ['message.write', '发送私信', '以你的身份向其他用户发送私信。'],
  ['openid', '账户标识（兼容）', '读取用于识别 MDTBBS 账户的稳定标识。'],
  ['email', '电子邮箱（兼容）', '读取邮箱地址和验证状态。'],
] as const;

type AppStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'deleted';
type DeveloperApplication = {
  id: number; client_id: string; name: string; description: string | null; website_url: string | null;
  status: AppStatus; client_type: string; party_type: string;
  requested_scopes: string[]; approved_scopes: string[]; redirect_uris: { redirect_uri: string }[];
  usage?: { authorization_count: number; last_used_at: string | null; requests_30d?: number;
    recent_errors?: { metric_date: string; error_count: number; last_error_at: string; last_error_code: string }[] };
};
type ApplicationsResponse = { success: boolean; applications: DeveloperApplication[] };
type Tab = 'overview' | 'oauth' | 'scopes' | 'usage';

function AppAvatar({ name }: { name: string }) {
  return <div className="public-app-avatar" aria-hidden="true">{(Array.from(name.trim())[0] || 'A').toUpperCase()}</div>;
}

function appLabel(application: DeveloperApplication) {
  return application.party_type === 'first_party' ? 'MDTBBS 官方应用' : '第三方应用';
}

export function DeveloperPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  const [applications, setApplications] = useState<DeveloperApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [redirectUris, setRedirectUris] = useState('');
  const [scopes, setScopes] = useState<string[]>(['profile', 'forum.read']);

  const selected = useMemo(() => applications.find(application => String(application.id) === routeId) || null, [applications, routeId]);
  const isCreate = routeId === 'new';
  const appPageUrl = selected ? `/apps/${encodeURIComponent(selected.client_id)}` : '';

  async function loadApplications() {
    setLoading(true);
    try {
      const response = await api.get<ApplicationsResponse>('/api/developer/clients');
      setApplications(response.applications || []);
    } catch (reason: unknown) {
      setFormError(reason instanceof Error ? reason.message : '获取应用失败');
    } finally { setLoading(false); }
  }

  useEffect(() => { if (user) void loadApplications(); }, [user]);
  useEffect(() => {
    if (selected) {
      setName(selected.name); setDescription(selected.description || ''); setWebsite(selected.website_url || '');
      setRedirectUris(selected.redirect_uris.map(item => item.redirect_uri).join('\n'));
      setScopes(selected.requested_scopes); setEditing(false); setTab('overview'); setFormError('');
    } else if (isCreate) {
      setName(''); setDescription(''); setWebsite(''); setRedirectUris(''); setScopes(['profile', 'forum.read']);
      setEditing(true); setTab('overview');
    }
  }, [selected, isCreate]);

  async function saveApplication() {
    setSaving(true); setFormError('');
    const body = {
      name: name.trim(), description: description.trim(), website_url: website.trim() || null,
      redirect_uris: redirectUris.split('\n').map(item => item.trim()).filter(Boolean), requested_scopes: scopes,
    };
    try {
      if (selected) {
        await api.put(`/api/developer/clients/${selected.id}`, body);
        await loadApplications(); setEditing(false);
      } else {
        const response = await api.post<{ application: { id: number } }>('/api/developer/clients', body);
        await loadApplications();
        const newId = response.application?.id;
        if (newId) navigate(`/developer/${newId}`, { replace: true });
      }
    } catch (reason: unknown) {
      setFormError(reason instanceof Error ? reason.message : '保存应用失败');
    } finally { setSaving(false); }
  }

  async function deleteApplication() {
    if (!selected) return;
    const confirmed = window.confirm(`删除“${selected.name}”后，所有用户授权和令牌立即失效，公开页不可访问，Client ID 永不复用。此操作无法恢复。确定删除吗？`);
    if (!confirmed) return;
    setSaving(true); setFormError('');
    try {
      await api.del(`/api/developer/clients/${selected.id}`);
      await loadApplications(); navigate('/developer', { replace: true });
    } catch (reason: unknown) {
      setFormError(reason instanceof Error ? reason.message : '删除应用失败');
    } finally { setSaving(false); }
  }

  const tabs: [Tab, string][] = [['overview', '概览'], ['oauth', 'OAuth'], ['scopes', '权限'], ['usage', '使用情况']];

  return (
    <AccountShell title={isCreate || !routeId ? '开发者应用' : '应用管理'} description={isCreate ? '创建应用，让第三方工具通过 MDTBBS 账号安全登录并调用社区 API。' : '管理应用配置、权限和使用情况。'}>
      {formError ? <p className="status-badge status-badge--danger" role="alert">{formError}</p> : null}
      {isCreate ? <div className="cluster developer-page-actions"><Button type="button" variant="secondary" onClick={() => navigate('/developer')}>返回应用列表</Button></div> : null}
      {!isCreate && !selected && !loading ? <AccountSection title="应用不存在" description="应用已删除，或你没有管理权限。"><Link className="btn btn--secondary" to="/developer">返回开发者应用</Link></AccountSection> : null}

      {isCreate ? (
        <AccountSection title="创建 Public Client" description="创建后会立即获得 client_id 并可开始 OAuth 2.0 + PKCE 登录，无需管理员审核。">
          <ApplicationForm name={name} setName={setName} description={description} setDescription={setDescription} website={website} setWebsite={setWebsite} redirectUris={redirectUris} setRedirectUris={setRedirectUris} scopes={scopes} setScopes={setScopes} onSave={() => void saveApplication()} onCancel={() => navigate('/developer')} saving={saving} saveLabel="创建应用" />
          {user && !user.phone_verified ? <p className="section-description">创建应用前需要先在 <Link to="/security">账户安全</Link> 完成手机号验证。</p> : null}
        </AccountSection>
      ) : null}

      {!isCreate && selected ? <>
        <header className="developer-app-header"><AppAvatar name={selected.name} /><div><h2>{selected.name}</h2><p><span className={`public-app-label ${selected.party_type === 'first_party' ? 'public-app-label--official' : ''}`}>{appLabel(selected)}</span> <span className="status-badge status-badge--success">{selected.status === 'approved' ? '可立即使用' : selected.status === 'suspended' ? '已停用' : selected.status}</span></p></div><Link className="btn btn--secondary" to="/developer">返回列表</Link></header>
        <nav className="developer-tabs" aria-label="应用管理分区">{tabs.map(([value, label]) => <button type="button" key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}</nav>
        {tab !== 'usage' ? <AccountSection title={tab === 'overview' ? '应用概览' : tab === 'oauth' ? 'OAuth 配置' : 'API 权限'} description={tab === 'oauth' ? 'Public Client 必须使用 Authorization Code + PKCE S256。' : undefined}>
          {tab === 'overview' ? <>
            <div className="stack"><p><strong>Client ID：</strong><code>{selected.client_id}</code></p><p><strong>类型：</strong>{appLabel(selected)} · Public Client</p><p><strong>公开应用页：</strong><Link to={appPageUrl}>{window.location.origin}{appPageUrl}</Link></p>
              {editing ? <><TextField label="应用名称" value={name} onChange={event => setName(event.target.value)} maxLength={120} /><label className="field"><span className="field__label">应用简介</span><textarea className="field__input" value={description} onChange={event => setDescription(event.target.value)} rows={4} maxLength={2000} /></label><TextField label="项目主页（HTTPS；本地开发可用 localhost）" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" /></> : <><p>{selected.description || '暂无应用简介。'}</p><p><strong>项目主页：</strong>{selected.website_url || '未设置'}</p></>}
              <div className="cluster">{editing ? <><Button type="button" disabled={saving} onClick={() => void saveApplication()}>{saving ? '保存中…' : '保存修改'}</Button><Button type="button" variant="secondary" onClick={() => { setName(selected.name); setDescription(selected.description || ''); setWebsite(selected.website_url || ''); setEditing(false); }}>取消</Button></> : <Button type="button" variant="secondary" onClick={() => setEditing(true)}>编辑信息</Button>}</div>
              <div className="developer-danger-zone"><h3>删除应用</h3><p>删除会立即撤销全部授权和令牌，Client ID 无法恢复或复用。</p><Button type="button" variant="danger" disabled={saving} onClick={() => void deleteApplication()}>删除应用</Button></div>
            </div>
          </> : null}
          {tab === 'oauth' ? <div className="stack"><p className="section-description">回调地址必须精确匹配。支持 HTTPS、自定义 URI Scheme 和 loopback 随机端口。</p>{editing ? <label className="field"><span className="field__label">Redirect URI（每行一个）</span><textarea className="field__input" value={redirectUris} onChange={event => setRedirectUris(event.target.value)} rows={6} placeholder={'https://example.com/oauth/callback\nmdtlauncher://oauth/callback\nhttp://127.0.0.1:0/callback\nhttp://localhost:0/callback'} /></label> : <ul className="developer-redirect-list">{selected.redirect_uris.map(item => <li key={item.redirect_uri}><code>{item.redirect_uri}</code></li>)}</ul>}<p><strong>PKCE：</strong>必需；只接受 S256</p><div className="cluster">{editing ? <Button type="button" disabled={saving} onClick={() => void saveApplication()}>{saving ? '保存中…' : '保存 OAuth 配置'}</Button> : <Button type="button" variant="secondary" onClick={() => setEditing(true)}>编辑回调地址</Button>}</div></div> : null}
          {tab === 'scopes' ? <><fieldset className="stack developer-scope-options"><legend className="field__label">允许应用请求的权限</legend>{SCOPE_OPTIONS.map(([scope, label, help]) => <label className="cluster developer-scope-option" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={event => setScopes(current => event.target.checked ? [...current, scope] : current.filter(item => item !== scope))} /><span><strong>{label}</strong>{scope === 'message.read' || scope === 'message.write' ? <span className="public-scope-sensitive">敏感权限</span> : null}<small>{scope} · {help}</small></span></label>)}</fieldset><div className="cluster"><Button type="button" disabled={saving} onClick={() => void saveApplication()}>{saving ? '保存中…' : '保存权限'}</Button></div></> : null}
        </AccountSection> : null}
        {tab === 'usage' ? <AccountSection title="应用使用情况" description="基础 OAuth 汇总数据，不包含令牌或授权码。"><AccountLoadState loading={loading} error={null} retry={loadApplications}><dl className="public-app-meta"><div><dt>已授权用户</dt><dd>{selected.usage?.authorization_count ?? 0}</dd></div><div><dt>过去 30 天 OAuth 请求</dt><dd>{selected.usage?.requests_30d ?? 0}</dd></div><div><dt>最近使用</dt><dd>{selected.usage?.last_used_at ? new Date(selected.usage.last_used_at).toLocaleString() : '暂无记录'}</dd></div></dl>{selected.usage?.recent_errors?.length ? <><h3>最近错误</h3><ul>{selected.usage.recent_errors.map(item => <li key={item.metric_date}>{item.metric_date} · {item.last_error_code} · {item.error_count} 次</li>)}</ul></> : <p>暂无错误记录。</p>}</AccountLoadState></AccountSection> : null}
      </> : null}

      {isCreate ? null : !routeId ? <AccountSection title="我的应用" description="每个应用都会单独生成 Public Client ID；目前不限制应用总数。">
        <AccountLoadState loading={loading} error={null} retry={loadApplications}>
          {applications.length ? <div className="developer-app-list">{applications.map(application => <Link className="developer-app-row" to={`/developer/${application.id}`} key={application.id}><AppAvatar name={application.name} /><div className="developer-app-row__main"><h3>{application.name}</h3><p><code>{application.client_id}</code></p><small>{appLabel(application)} · 权限 {application.requested_scopes.length} 项</small></div><div className="developer-app-row__usage"><span>授权用户 {application.usage?.authorization_count ?? 0}</span><small>最近使用：{application.usage?.last_used_at ? new Date(application.usage.last_used_at).toLocaleDateString() : '暂无'}</small></div><span aria-hidden="true">›</span></Link>)}</div> : <p>还没有应用。创建一个 Public Client，即可通过系统浏览器和 PKCE 登录。</p>}
        </AccountLoadState>
        <div className="cluster developer-page-actions"><Button type="button" onClick={() => navigate('/developer/new')}>创建应用</Button><Link className="btn btn--secondary" to="/apps">浏览社区应用</Link><Link className="account-text-link" to="/authorizations">管理已授权的应用</Link></div>
        <p className="section-description">第三方工具使用系统浏览器登录 MDTBBS，不需要也不应要求你交出账号密码。论坛 API 说明由 MDTBBS API Docs 提供。</p>
      </AccountSection> : null}
    </AccountShell>
  );
}

function ApplicationForm({
  name, setName, description, setDescription, website, setWebsite, redirectUris, setRedirectUris,
  scopes, setScopes, onSave, onCancel, saving, saveLabel,
}: {
  name: string; setName: (value: string) => void; description: string; setDescription: (value: string) => void;
  website: string; setWebsite: (value: string) => void; redirectUris: string; setRedirectUris: (value: string) => void;
  scopes: string[]; setScopes: Dispatch<SetStateAction<string[]>>;
  onSave: () => void; onCancel: () => void; saving: boolean; saveLabel: string;
}) {
  return <div className="stack">
    <TextField label="应用名称" value={name} onChange={event => setName(event.target.value)} maxLength={120} />
    <label className="field"><span className="field__label">应用简介</span><textarea className="field__input" value={description} onChange={event => setDescription(event.target.value)} rows={4} maxLength={2000} placeholder="说明应用的用途，用户会在授权页看到。" /></label>
    <TextField label="项目主页（可选）" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" />
    <label className="field"><span className="field__label">Redirect URI（至少一个，每行一个）</span><textarea className="field__input" value={redirectUris} onChange={event => setRedirectUris(event.target.value)} rows={5} placeholder={'https://example.com/oauth/callback\nmdtlauncher://oauth/callback\nhttp://127.0.0.1:0/callback\nhttp://localhost:0/callback'} /><span className="field__hint">支持 HTTPS、自定义应用协议，以及 localhost / loopback 随机端口。</span></label>
    <fieldset className="stack developer-scope-options"><legend className="field__label">API 权限</legend>{SCOPE_OPTIONS.map(([scope, label, help]) => <label className="cluster developer-scope-option" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={event => setScopes(current => event.target.checked ? [...current, scope] : current.filter(item => item !== scope))} /><span><strong>{label}</strong>{scope === 'message.read' || scope === 'message.write' ? <span className="public-scope-sensitive">敏感权限</span> : null}<small>{scope} · {help}</small></span></label>)}</fieldset>
    <div className="cluster"><Button type="button" disabled={saving} onClick={onSave}>{saving ? '处理中…' : saveLabel}</Button><Button type="button" variant="secondary" onClick={onCancel}>取消</Button></div>
  </div>;
}
