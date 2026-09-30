import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AccountLoadState, AccountSection } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { useI18n } from '@/i18n/I18nProvider';

const SCOPE_OPTIONS = [
  ['profile', 'developer.scope.profile', 'developer.scope.profileHelp'],
  ['forum.read', 'developer.scope.forumRead', 'developer.scope.forumReadHelp'],
  ['forum.write', 'developer.scope.forumWrite', 'developer.scope.forumWriteHelp'],
  ['resource.read', 'developer.scope.resourceRead', 'developer.scope.resourceReadHelp'],
  ['resource.download', 'developer.scope.resourceDownload', 'developer.scope.resourceDownloadHelp'],
  ['resource.upload', 'developer.scope.resourceUpload', 'developer.scope.resourceUploadHelp'],
  ['notification.read', 'developer.scope.notificationRead', 'developer.scope.notificationReadHelp'],
  ['message.read', 'developer.scope.messageRead', 'developer.scope.messageReadHelp'],
  ['message.write', 'developer.scope.messageWrite', 'developer.scope.messageWriteHelp'],
  ['friends.read', 'developer.scope.friendsRead', 'developer.scope.friendsReadHelp'],
  ['presence.read', 'developer.scope.presenceRead', 'developer.scope.presenceReadHelp'],
  ['presence.write', 'developer.scope.presenceWrite', 'developer.scope.presenceWriteHelp'],
  ['multiplayer.read', 'developer.scope.multiplayerRead', 'developer.scope.multiplayerReadHelp'],
  ['multiplayer.write', 'developer.scope.multiplayerWrite', 'developer.scope.multiplayerWriteHelp'],
  ['openid', 'developer.scope.openid', 'developer.scope.openidHelp'],
  ['email', 'developer.scope.email', 'developer.scope.emailHelp'],
] as const;

type AppStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'deleted';
type Ecosystem = 'mdtbbs' | 'mindustry-club' | 'global';
type Translate = (key: string, values?: Record<string, string | number>) => string;
type DeveloperApplication = {
  id: number; client_id: string; name: string; description: string | null; website_url: string | null;
  application_icon_url: string | null; launch_uri_template: string | null; launch_uri_approved: boolean | number;
  supports_presence_requested: boolean | number; supports_multiplayer_requested: boolean | number; supports_join_intent_requested: boolean | number;
  supports_presence: boolean | number; supports_multiplayer: boolean | number; supports_join_intent: boolean | number;
  status: AppStatus; client_type: string; party_type: string; ecosystem: Ecosystem;
  requested_scopes: string[]; approved_scopes: string[]; redirect_uris: { redirect_uri: string }[];
  usage?: { authorization_count: number; last_used_at: string | null; requests_30d?: number;
    recent_errors?: { metric_date: string; error_count: number; last_error_at: string; last_error_code: string }[] };
};
type ApplicationsResponse = { success: boolean; applications: DeveloperApplication[] };
type Tab = 'overview' | 'oauth' | 'scopes' | 'usage';

function AppAvatar({ name }: { name: string }) {
  return <div className="public-app-avatar" aria-hidden="true">{(Array.from(name.trim())[0] || 'A').toUpperCase()}</div>;
}

function appLabel(application: DeveloperApplication, t: Translate) {
  return application.party_type === 'first_party' ? t('developer.official') : t('developer.thirdParty');
}

function statusLabel(status: AppStatus, t: Translate) {
  return t(`developer.status.${status}`);
}

function localizedError(reason: unknown, t: Translate, fallback: string) {
  if (reason instanceof ApiError) {
    if (reason.code === 'EMAIL_VERIFICATION_REQUIRED') return t('developer.emailRequired');
    if (reason.code === 'PHONE_VERIFICATION_REQUIRED') return t('developer.phoneRequired');
  }
  return fallback;
}

function formatDate(value: string | null | undefined, locale: string, withTime = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

export function DeveloperPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
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
  const [applicationIconUrl, setApplicationIconUrl] = useState('');
  const [launchUriTemplate, setLaunchUriTemplate] = useState('');
  const [supportsPresence, setSupportsPresence] = useState(false);
  const [supportsMultiplayer, setSupportsMultiplayer] = useState(false);
  const [supportsJoinIntent, setSupportsJoinIntent] = useState(false);
  const [redirectUris, setRedirectUris] = useState('');
  const [scopes, setScopes] = useState<string[]>(['profile', 'forum.read']);
  const [ecosystem, setEcosystem] = useState<Ecosystem>('mdtbbs');
  const phoneRequired = ecosystem === 'mdtbbs';
  const eligibilityError = !user?.email_verified ? t('developer.emailRequired') : phoneRequired && !user.phone_verified ? t('developer.phoneRequired') : '';

  const selected = useMemo(() => applications.find(application => String(application.id) === routeId) || null, [applications, routeId]);
  const isCreate = routeId === 'new';
  const appPageUrl = selected ? `/apps/${encodeURIComponent(selected.client_id)}` : '';

  const loadApplications = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<ApplicationsResponse>('/api/developer/clients');
      setApplications(response.applications || []);
    } catch (reason: unknown) {
      setFormError(localizedError(reason, t, t('developer.loadFailed')));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { if (user) void loadApplications(); }, [user, loadApplications]);
  useEffect(() => {
    if (selected) {
      setName(selected.name); setDescription(selected.description || ''); setWebsite(selected.website_url || '');
      setApplicationIconUrl(selected.application_icon_url || ''); setLaunchUriTemplate(selected.launch_uri_template || '');
      setSupportsPresence(Boolean(selected.supports_presence_requested)); setSupportsMultiplayer(Boolean(selected.supports_multiplayer_requested));
      setSupportsJoinIntent(Boolean(selected.supports_join_intent_requested));
      setRedirectUris(selected.redirect_uris.map(item => item.redirect_uri).join('\n'));
      setScopes(selected.requested_scopes); setEcosystem(selected.ecosystem || 'mdtbbs'); setEditing(false); setTab('overview'); setFormError('');
    } else if (isCreate) {
      setName(''); setDescription(''); setWebsite(''); setApplicationIconUrl(''); setLaunchUriTemplate('');
      setSupportsPresence(false); setSupportsMultiplayer(false); setSupportsJoinIntent(false);
      setRedirectUris(''); setScopes(['profile', 'forum.read']);
      setEcosystem('mdtbbs');
      setEditing(true); setTab('overview');
    }
  }, [selected, isCreate]);

  async function saveApplication() {
    setFormError('');
    const normalizedName = name.trim();
    const normalizedDescription = description.trim();
    const normalizedRedirectUris = redirectUris.split('\n').map(item => item.trim()).filter(Boolean);

    if (eligibilityError) { setFormError(eligibilityError); return; }
    if (!normalizedName) { setFormError(t('developer.nameRequired')); return; }
    if (!normalizedDescription) { setFormError(t('developer.descriptionRequired')); return; }
    if (!normalizedRedirectUris.length) { setFormError(t('developer.redirectRequiredError')); return; }
    if (!scopes.length) { setFormError(t('developer.scopeRequired')); return; }

    setSaving(true);
    const body = {
      name: normalizedName, description: normalizedDescription, website_url: website.trim() || null,
      application_icon_url: applicationIconUrl.trim() || null, launch_uri_template: launchUriTemplate.trim() || null,
      supports_presence: supportsPresence, supports_multiplayer: supportsMultiplayer, supports_join_intent: supportsJoinIntent,
      redirect_uris: normalizedRedirectUris, requested_scopes: scopes, ecosystem,
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
      setFormError(localizedError(reason, t, t('developer.saveFailed')));
    } finally { setSaving(false); }
  }

  async function deleteApplication() {
    if (!selected) return;
    const confirmed = window.confirm(t('developer.deleteConfirm', { name: selected.name }));
    if (!confirmed) return;
    setSaving(true); setFormError('');
    try {
      await api.del(`/api/developer/clients/${selected.id}`);
      await loadApplications(); navigate('/developer', { replace: true });
    } catch (reason: unknown) {
      setFormError(localizedError(reason, t, t('developer.deleteFailed')));
    } finally { setSaving(false); }
  }

  const tabs: [Tab, string][] = [
    ['overview', t('developer.tab.overview')], ['oauth', t('developer.tab.oauth')],
    ['scopes', t('developer.tab.scopes')], ['usage', t('developer.tab.usage')],
  ];
  const pageTitle = isCreate || !routeId ? t('developer.title') : t('developer.manageTitle');
  const pageDescription = isCreate ? t('developer.createDescription') : t('developer.listDescription');

  return (
    <AccountShell title={pageTitle} description={pageDescription}>
      {formError ? <p className="status-badge status-badge--danger" role="alert">{formError}</p> : null}
      {isCreate ? <div className="cluster developer-page-actions"><Button type="button" variant="secondary" onClick={() => navigate('/developer')}>{t('developer.backToList')}</Button></div> : null}
      {!isCreate && !selected && !loading ? <AccountSection title={t('developer.appMissing')} description={t('developer.appMissingDescription')}><Link className="btn btn--secondary" to="/developer">{t('developer.backToApps')}</Link></AccountSection> : null}

      {isCreate ? (
        <AccountSection title={t('developer.createTitle')} description={t('developer.createDescription')}>
          {eligibilityError ? <div className="developer-create-gate" role="alert"><strong>{ecosystem === 'mdtbbs' ? t('developer.eligibilityMdtbbs') : t('developer.eligibilityGlobal')}</strong><p>{eligibilityError}</p>{ecosystem === 'mdtbbs' && !user?.phone_verified ? <Link className="btn btn--secondary" to="/security">{t('developer.openSecurity')}</Link> : null}</div> : null}
          <ApplicationForm ecosystem={ecosystem} setEcosystem={setEcosystem} name={name} setName={setName} description={description} setDescription={setDescription} website={website} setWebsite={setWebsite} applicationIconUrl={applicationIconUrl} setApplicationIconUrl={setApplicationIconUrl} launchUriTemplate={launchUriTemplate} setLaunchUriTemplate={setLaunchUriTemplate} supportsPresence={supportsPresence} setSupportsPresence={setSupportsPresence} supportsMultiplayer={supportsMultiplayer} setSupportsMultiplayer={setSupportsMultiplayer} supportsJoinIntent={supportsJoinIntent} setSupportsJoinIntent={setSupportsJoinIntent} redirectUris={redirectUris} setRedirectUris={setRedirectUris} scopes={scopes} setScopes={setScopes} onSave={() => void saveApplication()} onCancel={() => navigate('/developer')} saving={saving} saveDisabled={Boolean(eligibilityError)} saveLabel={t('developer.create')} />
        </AccountSection>
      ) : null}

      {!isCreate && selected ? <>
        <header className="developer-app-header"><AppAvatar name={selected.name} /><div><h2>{selected.name}</h2><p><span className={`public-app-label ${selected.party_type === 'first_party' ? 'public-app-label--official' : ''}`}>{appLabel(selected, t)}</span> <span className={`status-badge ${selected.status === 'approved' ? 'status-badge--success' : selected.status === 'rejected' ? 'status-badge--danger' : 'status-badge--warning'}`}>{statusLabel(selected.status, t)}</span></p></div><Link className="btn btn--secondary" to="/developer">{t('developer.backToListShort')}</Link></header>
        <nav className="developer-tabs" aria-label={t('developer.manageTitle')}>{tabs.map(([value, label]) => <button type="button" key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{label}</button>)}</nav>
        {tab !== 'usage' ? <AccountSection title={tab === 'overview' ? t('developer.section.overview') : tab === 'oauth' ? t('developer.section.oauth') : t('developer.section.scopes')} description={tab === 'oauth' ? t('developer.pkceDescription') : undefined}>
          {tab === 'overview' ? <div className="stack">
            <p><strong>Client ID:</strong> <code>{selected.client_id}</code></p><p><strong>{t('developer.clientType')}:</strong> {appLabel(selected, t)} · {t('developer.publicClient')}</p><p><strong>{t('developer.officialPage')}:</strong> <Link to={appPageUrl}>{window.location.origin}{appPageUrl}</Link></p>
            {editing ? <><EcosystemField value={ecosystem} onChange={setEcosystem} /><TextField label={t('developer.name')} value={name} onChange={event => setName(event.target.value)} maxLength={120} /><label className="field"><span className="field__label">{t('developer.description')}</span><textarea className="field__input" value={description} onChange={event => setDescription(event.target.value)} rows={4} maxLength={2000} /></label><TextField label={t('developer.websiteHttps')} value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" /><ClientCapabilitiesFields applicationIconUrl={applicationIconUrl} setApplicationIconUrl={setApplicationIconUrl} launchUriTemplate={launchUriTemplate} setLaunchUriTemplate={setLaunchUriTemplate} supportsPresence={supportsPresence} setSupportsPresence={setSupportsPresence} supportsMultiplayer={supportsMultiplayer} setSupportsMultiplayer={setSupportsMultiplayer} supportsJoinIntent={supportsJoinIntent} setSupportsJoinIntent={setSupportsJoinIntent} /></> : <><p>{selected.description || t('developer.noDescription')}</p><p><strong>{t('developer.ecosystem')}:</strong> {selected.ecosystem}</p><p><strong>{t('developer.projectHome')}:</strong> {selected.website_url || t('developer.notSet')}</p><p><strong>已批准能力：</strong> {[selected.supports_presence && 'Presence', selected.supports_multiplayer && 'Multiplayer', selected.supports_join_intent && 'Join Intent'].filter(Boolean).join(' · ') || '无'}</p></>}
            <div className="cluster">{editing ? <><Button type="button" disabled={saving || Boolean(eligibilityError)} onClick={() => void saveApplication()}>{saving ? t('developer.saving') : t('developer.saveChanges')}</Button><Button type="button" variant="secondary" onClick={() => { setName(selected.name); setDescription(selected.description || ''); setWebsite(selected.website_url || ''); setApplicationIconUrl(selected.application_icon_url || ''); setLaunchUriTemplate(selected.launch_uri_template || ''); setSupportsPresence(Boolean(selected.supports_presence_requested)); setSupportsMultiplayer(Boolean(selected.supports_multiplayer_requested)); setSupportsJoinIntent(Boolean(selected.supports_join_intent_requested)); setEcosystem(selected.ecosystem); setEditing(false); }}>{t('developer.cancel')}</Button></> : <Button type="button" variant="secondary" onClick={() => setEditing(true)}>{t('developer.edit')}</Button>}</div>
            <div className="developer-danger-zone"><h3>{t('developer.delete')}</h3><p>{t('developer.deleteWarning')}</p><Button type="button" variant="danger" disabled={saving} onClick={() => void deleteApplication()}>{t('developer.delete')}</Button></div>
          </div> : null}
          {tab === 'oauth' ? <div className="stack"><p className="section-description">{t('developer.redirectDescription')}</p>{editing ? <label className="field"><span className="field__label">{t('developer.redirectLabel')}</span><textarea className="field__input" value={redirectUris} onChange={event => setRedirectUris(event.target.value)} rows={6} placeholder={'https://example.com/oauth/callback\nmdtlauncher://oauth/callback\nhttp://127.0.0.1:0/callback\nhttp://localhost:0/callback'} /></label> : <ul className="developer-redirect-list">{selected.redirect_uris.map(item => <li key={item.redirect_uri}><code>{item.redirect_uri}</code></li>)}</ul>}<p>{t('developer.pkce')}</p><div className="cluster">{editing ? <Button type="button" disabled={saving} onClick={() => void saveApplication()}>{saving ? t('developer.saving') : t('developer.saveOAuth')}</Button> : <Button type="button" variant="secondary" onClick={() => setEditing(true)}>{t('developer.editRedirects')}</Button>}</div></div> : null}
          {tab === 'scopes' ? <><ScopeOptions scopes={scopes} setScopes={setScopes} /><div className="cluster"><Button type="button" disabled={saving} onClick={() => void saveApplication()}>{saving ? t('developer.saving') : t('developer.saveScopes')}</Button></div></> : null}
        </AccountSection> : null}
        {tab === 'usage' ? <AccountSection title={t('developer.usageTitle')} description={t('developer.usageDescription')}><AccountLoadState loading={loading} error={null} retry={loadApplications}><dl className="public-app-meta"><div><dt>{t('developer.authorizedUsers')}</dt><dd>{new Intl.NumberFormat(locale).format(selected.usage?.authorization_count ?? 0)}</dd></div><div><dt>{t('developer.requests30d')}</dt><dd>{new Intl.NumberFormat(locale).format(selected.usage?.requests_30d ?? 0)}</dd></div><div><dt>{t('developer.lastUsed')}</dt><dd>{formatDate(selected.usage?.last_used_at, locale, true) || t('developer.noRecords')}</dd></div></dl>{selected.usage?.recent_errors?.length ? <><h3>{t('developer.recentErrors')}</h3><ul>{selected.usage.recent_errors.map(item => <li key={item.metric_date}>{item.metric_date} · {item.last_error_code} · {t('developer.errorCount', { count: new Intl.NumberFormat(locale).format(item.error_count) })}</li>)}</ul></> : <p>{t('developer.noErrors')}</p>}</AccountLoadState></AccountSection> : null}
      </> : null}

      {isCreate ? null : !routeId ? <AccountSection title={t('developer.listTitle')} description={t('developer.listDescription')}>
        <AccountLoadState loading={loading} error={null} retry={loadApplications}>
          {applications.length ? <div className="developer-app-list">{applications.map(application => <Link className="developer-app-row" to={`/developer/${application.id}`} key={application.id}><AppAvatar name={application.name} /><div className="developer-app-row__main"><h3>{application.name}</h3><p><code>{application.client_id}</code></p><small>{appLabel(application, t)} · {t('developer.scopeCount', { count: new Intl.NumberFormat(locale).format(application.requested_scopes.length) })}</small></div><div className="developer-app-row__usage"><span>{t('developer.authorizedUsers')} {new Intl.NumberFormat(locale).format(application.usage?.authorization_count ?? 0)}</span><small>{t('developer.lastUsed')}: {formatDate(application.usage?.last_used_at, locale) || t('developer.noRecords')}</small></div><span aria-hidden="true">›</span></Link>)}</div> : <p>{t('developer.empty')}</p>}
        </AccountLoadState>
        <div className="cluster developer-page-actions"><Button type="button" onClick={() => navigate('/developer/new')}>{t('developer.createPublic')}</Button><Link className="btn btn--secondary" to="/apps">{t('developer.browseApps')}</Link><Link className="account-text-link" to="/authorizations">{t('developer.manageAuthorizations')}</Link></div>
        <p className="section-description">{t('developer.thirdPartyDescription')}</p>
      </AccountSection> : null}
    </AccountShell>
  );
}

function ScopeOptions({ scopes, setScopes }: { scopes: string[]; setScopes: Dispatch<SetStateAction<string[]>> }) {
  const { t } = useI18n();
}

function ApplicationForm({
  ecosystem, setEcosystem, name, setName, description, setDescription, website, setWebsite,
  applicationIconUrl, setApplicationIconUrl, launchUriTemplate, setLaunchUriTemplate,
  supportsPresence, setSupportsPresence, supportsMultiplayer, setSupportsMultiplayer, supportsJoinIntent, setSupportsJoinIntent,
  redirectUris, setRedirectUris,
  scopes, setScopes, onSave, onCancel, saving, saveDisabled = false, saveLabel,
}: {
  ecosystem: Ecosystem; setEcosystem: (value: Ecosystem) => void;
  name: string; setName: (value: string) => void; description: string; setDescription: (value: string) => void;
  website: string; setWebsite: (value: string) => void; redirectUris: string; setRedirectUris: (value: string) => void;
  applicationIconUrl: string; setApplicationIconUrl: (value: string) => void;
  launchUriTemplate: string; setLaunchUriTemplate: (value: string) => void;
  supportsPresence: boolean; setSupportsPresence: (value: boolean) => void;
  supportsMultiplayer: boolean; setSupportsMultiplayer: (value: boolean) => void;
  supportsJoinIntent: boolean; setSupportsJoinIntent: (value: boolean) => void;
  scopes: string[]; setScopes: Dispatch<SetStateAction<string[]>>;
  onSave: () => void; onCancel: () => void; saving: boolean; saveDisabled?: boolean; saveLabel: string;
}) {
  const { t } = useI18n();
  return <div className="stack">
    <EcosystemField value={ecosystem} onChange={setEcosystem} />
    <TextField label={t('developer.name')} value={name} onChange={event => setName(event.target.value)} maxLength={120} />
    <label className="field"><span className="field__label">{t('developer.description')}</span><textarea className="field__input" value={description} onChange={event => setDescription(event.target.value)} rows={4} maxLength={2000} placeholder={t('developer.descriptionHint')} /></label>
    <TextField label={t('developer.website')} value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" />
    <ClientCapabilitiesFields applicationIconUrl={applicationIconUrl} setApplicationIconUrl={setApplicationIconUrl} launchUriTemplate={launchUriTemplate} setLaunchUriTemplate={setLaunchUriTemplate} supportsPresence={supportsPresence} setSupportsPresence={setSupportsPresence} supportsMultiplayer={supportsMultiplayer} setSupportsMultiplayer={setSupportsMultiplayer} supportsJoinIntent={supportsJoinIntent} setSupportsJoinIntent={setSupportsJoinIntent} />
    <label className="field"><span className="field__label">{t('developer.redirectRequired')}</span><textarea className="field__input" value={redirectUris} onChange={event => setRedirectUris(event.target.value)} rows={5} placeholder={'https://example.com/oauth/callback\nmdtlauncher://oauth/callback\nhttp://127.0.0.1:0/callback\nhttp://localhost:0/callback'} /><span className="field__hint">{t('developer.redirectHelp')}</span></label>
    <ScopeOptions scopes={scopes} setScopes={setScopes} />
    <div className="cluster"><Button type="button" disabled={saving || saveDisabled} onClick={onSave}>{saving ? t('developer.processing') : saveLabel}</Button><Button type="button" variant="secondary" onClick={onCancel}>{t('developer.cancel')}</Button></div>
  </div>;
}

function ClientCapabilitiesFields({
  applicationIconUrl, setApplicationIconUrl, launchUriTemplate, setLaunchUriTemplate,
  supportsPresence, setSupportsPresence, supportsMultiplayer, setSupportsMultiplayer, supportsJoinIntent, setSupportsJoinIntent,
}: {
  applicationIconUrl: string; setApplicationIconUrl: (value: string) => void;
  launchUriTemplate: string; setLaunchUriTemplate: (value: string) => void;
  supportsPresence: boolean; setSupportsPresence: (value: boolean) => void;
  supportsMultiplayer: boolean; setSupportsMultiplayer: (value: boolean) => void;
  supportsJoinIntent: boolean; setSupportsJoinIntent: (value: boolean) => void;
}) {
  return <div className="stack">
    <TextField label="应用图标 HTTPS URL" value={applicationIconUrl} onChange={event => setApplicationIconUrl(event.target.value)} placeholder="https://example.com/icon.png" />
    <TextField label="启动 URI 模板" value={launchUriTemplate} onChange={event => setLaunchUriTemplate(event.target.value)} maxLength={1000} placeholder="xenon-launcher://join?intent={intent_id}" />
    <fieldset className="stack"><legend className="field__label">申请的客户端能力（需管理员审核）</legend>
      <label><input type="checkbox" checked={supportsPresence} onChange={event => setSupportsPresence(event.target.checked)} /> Presence 客户端</label>
      <label><input type="checkbox" checked={supportsMultiplayer} onChange={event => setSupportsMultiplayer(event.target.checked)} /> Multiplayer 客户端</label>
      <label><input type="checkbox" checked={supportsJoinIntent} onChange={event => setSupportsJoinIntent(event.target.checked)} /> Join Intent 启动器</label>
    </fieldset>
    <p className="section-description">Join Intent 模板必须包含且只能包含一个 {'{intent_id}'} 占位符。</p>
  </div>;
}

function EcosystemField({ value, onChange }: { value: Ecosystem; onChange: (value: Ecosystem) => void }) {
  const { t } = useI18n();
  return <label className="field"><span className="field__label">{t('developer.ecosystem')}</span><select className="field__input" value={value} onChange={event => onChange(event.target.value as Ecosystem)}><option value="mdtbbs">{t('developer.ecosystemMdtbbs')}</option><option value="mindustry-club">{t('developer.ecosystemClub')}</option><option value="global">{t('developer.ecosystemGlobal')}</option></select><span className="field__hint">{t('developer.ecosystemHelp')}</span></label>;
}
