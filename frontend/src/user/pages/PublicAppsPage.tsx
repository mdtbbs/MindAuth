import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '@/api/client';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';

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
  const { locale, t } = useI18n();
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
        .catch(() => { if (active) setError(t('apps.loadingDetail')); })
        .finally(() => { if (active) setLoading(false); });
    } else {
      api.get<{ applications: PublicApplication[] }>('/api/public/apps')
        .then(response => { if (active) setApplications(response.applications || []); })
        .catch(() => { if (active) setError(t('apps.loading')); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [clientId, t]);

  const visibleApplications = useMemo(() => applications.filter(item =>
    filter === 'all' || (filter === 'official' ? item.official : !item.official)), [applications, filter]);

  if (clientId) {
    return (
      <AuthShell title={t('apps.detailTitle')} description={t('apps.detailDescription')} footer={<Link to="/apps" className="inline-link">{t('apps.backToDirectory')}</Link>}>
        {loading ? <p className="section-description">{t('apps.loadingDetail')}</p> : null}
        {error ? <p className="status-badge status-badge--danger" role="alert">{error}</p> : null}
        {!loading && application?.available === false ? (
          <section className="public-app-unavailable"><h2>{t('apps.unavailable')}</h2><p>{t('apps.suspended')}</p></section>
        ) : null}
        {!loading && application?.available !== false && application ? (
          <div className="stack public-app-detail">
            <header className="public-app-detail__header">
              <AppAvatar name={application.name} />
              <div><h2>{application.name}</h2><span className={`public-app-label ${application.official ? 'public-app-label--official' : ''}`}>{application.official ? t('apps.official') : t('apps.thirdParty')}</span></div>
            </header>
            <p>{application.description || t('apps.noDescription')}</p>
            <dl className="public-app-meta">
              <div><dt>{t('apps.developer')}</dt><dd>{application.developer_url ? <a href={application.developer_url}>{application.developer_name || t('apps.defaultDeveloper')}</a> : application.developer_name || t('apps.defaultDeveloper')}</dd></div>
              <div><dt>{t('apps.authorizationCount')}</dt><dd>{new Intl.NumberFormat(locale).format(application.authorization_count)}</dd></div>
              {application.website_url ? <div><dt>{t('apps.projectHome')}</dt><dd><a href={application.website_url} target="_blank" rel="noreferrer">{application.website_url}</a></dd></div> : null}
            </dl>
            <section><h3>{t('apps.permissions')}</h3><ul className="public-scope-list">{application.scopes.map(scope => (
              <li key={scope.scope}><div><strong>{scope.name}</strong>{scope.sensitive ? <span className="public-scope-sensitive">{t('apps.sensitive')}</span> : null}<p>{scope.description}</p><small>{scope.scope}</small></div></li>
            ))}</ul></section>
            <p className="section-description">{t('apps.afterGrant')}</p>
          </div>
        ) : null}
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('apps.title')} description={t('apps.description')} footer={<Link to="/developer" className="inline-link">{t('apps.developerCenter')}</Link>}>
      <div className="public-app-directory">
        <nav className="public-app-filters" aria-label={t('apps.filter')}>
          {([['all', t('apps.all')], ['community', t('apps.community')], ['official', t('apps.official')]] as const).map(([value, label]) => (
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </nav>
        {loading ? <p className="section-description">{t('apps.loading')}</p> : null}
        {error ? <p className="status-badge status-badge--danger" role="alert">{error}</p> : null}
        {!loading && !error && !visibleApplications.length ? <p className="section-description">{t('apps.empty')}</p> : null}
        <div className="public-app-grid">
          {visibleApplications.map(item => (
            <Link className="public-app-card" to={`/apps/${encodeURIComponent(item.client_id)}`} key={item.client_id}>
              <header><AppAvatar name={item.name} /><span className={`public-app-label ${item.official ? 'public-app-label--official' : ''}`}>{item.official ? t('apps.officialShort') : t('apps.thirdPartyShort')}</span></header>
              <h2>{item.name}</h2><p>{item.description || t('apps.noDescription')}</p>
              <div className="public-app-card__meta"><span>{t('apps.developerLabel')}{item.developer_name || t('apps.defaultDeveloper')}</span><span>{t('apps.authorizationLabel')}{new Intl.NumberFormat(locale).format(item.authorization_count)}</span></div>
              <div className="public-app-card__scopes">{item.scopes.slice(0, 3).map(scope => <span key={scope.scope}>{scope.name}</span>)}{item.scopes.length > 3 ? <span>+{item.scopes.length - 3}</span> : null}</div>
            </Link>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}
