import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '@/api/client';
import { AuthShell } from '@/user/components/AuthShell';

type PublicScope = { scope: string; name: string; description: string; sensitive?: boolean };
type PublicApplication = {
  client_id: string; name: string; description: string; website_url: string | null;
  official: boolean; developer_name: string | null; developer_url: string | null;
  authorization_count: number; scopes: PublicScope[]; available?: boolean;
};

function AppAvatar({ name }: { name: string }) {
  const initial = Array.from(name.trim())[0] || 'A';
  return <div className="public-app-avatar" aria-hidden="true">{initial.toUpperCase()}</div>;
}

export function PublicAppsPage() {
  const { clientId } = useParams();
  const [applications, setApplications] = useState<PublicApplication[]>([]);
  const [application, setApplication] = useState<PublicApplication | null>(null);
  const [filter, setFilter] = useState<'all' | 'community' | 'official'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (clientId) {
      api.get<{ application: PublicApplication }>(`/api/public/apps/${encodeURIComponent(clientId)}`)
        .then(response => { if (active) setApplication(response.application); })
        .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '无法读取应用信息'); })
        .finally(() => { if (active) setLoading(false); });
    } else {
      api.get<{ applications: PublicApplication[] }>('/api/public/apps')
        .then(response => { if (active) setApplications(response.applications || []); })
        .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '无法读取应用目录'); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [clientId]);

  const visibleApplications = useMemo(() => applications.filter(item =>
    filter === 'all' || (filter === 'official' ? item.official : !item.official)), [applications, filter]);

  if (clientId) {
    return (
      <AuthShell title="应用信息" description="查看 MDTBBS 社区应用的用途和权限。" footer={<Link to="/apps" className="inline-link">返回应用目录</Link>}>
        {loading ? <p className="section-description">正在读取应用信息…</p> : null}
        {error ? <p className="status-badge status-badge--danger" role="alert">{error}</p> : null}
        {!loading && application?.available === false ? (
          <section className="public-app-unavailable"><h2>该应用当前不可用。</h2><p>此应用已暂停或删除。</p></section>
        ) : null}
        {!loading && application?.available !== false && application ? (
          <div className="stack public-app-detail">
            <header className="public-app-detail__header">
              <AppAvatar name={application.name} />
              <div><h2>{application.name}</h2><span className={`public-app-label ${application.official ? 'public-app-label--official' : ''}`}>{application.official ? 'MDTBBS 官方应用' : '第三方应用'}</span></div>
            </header>
            <p>{application.description || '暂无应用简介。'}</p>
            <dl className="public-app-meta">
              <div><dt>开发者</dt><dd>{application.developer_url ? <a href={application.developer_url}>{application.developer_name || 'MDTBBS 开发者'}</a> : application.developer_name || 'MDTBBS'}</dd></div>
              <div><dt>授权用户</dt><dd>{application.authorization_count.toLocaleString()}</dd></div>
              {application.website_url ? <div><dt>项目主页</dt><dd><a href={application.website_url} target="_blank" rel="noreferrer">{application.website_url}</a></dd></div> : null}
            </dl>
            <section><h3>应用权限</h3><ul className="public-scope-list">{application.scopes.map(scope => (
              <li key={scope.scope}><div><strong>{scope.name}</strong>{scope.sensitive ? <span className="public-scope-sensitive">敏感权限</span> : null}<p>{scope.description}</p><small>{scope.scope}</small></div></li>
            ))}</ul></section>
            <p className="section-description">授权后，你可以在 MindAuth 的“已授权应用”页面随时撤销访问。</p>
          </div>
        ) : null}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="社区应用" description="了解社区应用使用 MDTBBS 账号登录时请求的权限。" footer={<Link to="/developer" className="inline-link">开发者应用</Link>}>
      <div className="public-app-directory">
        <nav className="public-app-filters" aria-label="筛选应用">
          {([['all', '全部应用'], ['community', '第三方应用'], ['official', '官方应用']] as const).map(([value, label]) => (
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </nav>
        {loading ? <p className="section-description">正在读取社区应用…</p> : null}
        {error ? <p className="status-badge status-badge--danger" role="alert">{error}</p> : null}
        {!loading && !error && !visibleApplications.length ? <p className="section-description">暂时没有符合条件的应用。</p> : null}
        <div className="public-app-grid">
          {visibleApplications.map(item => (
            <Link className="public-app-card" to={`/apps/${encodeURIComponent(item.client_id)}`} key={item.client_id}>
              <header><AppAvatar name={item.name} /><span className={`public-app-label ${item.official ? 'public-app-label--official' : ''}`}>{item.official ? '官方' : '第三方'}</span></header>
              <h2>{item.name}</h2><p>{item.description || '暂无应用简介。'}</p>
              <div className="public-app-card__meta"><span>开发者：{item.developer_name || 'MDTBBS'}</span><span>授权用户：{item.authorization_count.toLocaleString()}</span></div>
              <div className="public-app-card__scopes">{item.scopes.slice(0, 3).map(scope => <span key={scope.scope}>{scope.name}</span>)}{item.scopes.length > 3 ? <span>+{item.scopes.length - 3}</span> : null}</div>
            </Link>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
