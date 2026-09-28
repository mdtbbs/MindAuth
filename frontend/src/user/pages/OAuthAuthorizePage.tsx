import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import api, { ApiError } from '@/api/client';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';

type ScopeInfo = { name: string; description: string; sensitive?: boolean };
type ConsentInfo = {
  success: boolean;
  consent_required: boolean;
  client: {
    client_id: string; name: string; description: string | null; website_url: string | null;
    client_type: string; party_type: string; developer_name: string | null;
    developer_url: string | null; owner_user_id: number | null;
  };
  scopes: ScopeInfo[];
  new_scopes: ScopeInfo[];
  previous_scopes: string[];
};

const SCOPE_ICONS: Record<string, string> = {
  openid: '◉', profile: '👤', email: '✉️', 'forum.read': '💬', 'forum.write': '✍️',
  'resource.read': '🗂️', 'resource.download': '⬇️', 'resource.upload': '⬆️',
  'notification.read': '🔔', 'message.read': '📨', 'message.write': '✉️',
};

export function OAuthAuthorizePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const request = useMemo(() => ({
    client_id: params.get('client_id') || '',
    redirect_uri: params.get('redirect_uri') || params.get('redirect') || '',
    state: params.get('state') || '',
    scope: params.get('scope') || '',
    response_type: params.get('response_type') || 'code',
    code_challenge: params.get('code_challenge') || '',
    code_challenge_method: params.get('code_challenge_method') || '',
    ui_locales: params.get('ui_locales') || '',
  }), [params]);
  const query = useMemo(() => {
    const value = new URLSearchParams();
    Object.entries(request).forEach(([key, item]) => { if (item) value.set(key, item); });
    return value;
  }, [request]);
  const [consent, setConsent] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading) return;
      if (!request.client_id || !request.redirect_uri) {
      setError(t('oauth.invalidConfiguration'));
      return;
    }
    if (!user) {
      navigate(`/login?${query.toString()}`, { replace: true });
      return;
    }
    let active = true;
    api.get<ConsentInfo>(`/api/authorize/consent-info?${query.toString()}`)
      .then((data) => {
        if (!active) return;
        setConsent(data);
        if (!data.consent_required) window.location.assign(`/api/authorize?${query.toString()}`);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof ApiError && reason.status && reason.status < 500
          ? t('oauth.invalidConfiguration')
          : t('oauth.unavailable'));
      });
    return () => { active = false; };
  }, [authLoading, user, request.client_id, request.redirect_uri, query, navigate, t]);

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true); setError('');
    try {
      const response = await api.post<{ success: boolean; redirect_to: string }>('/api/authorize/consent', { ...request, decision });
      window.location.assign(response.redirect_to);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError && reason.status && reason.status < 500
        ? t('oauth.invalidConfiguration')
        : t('oauth.submitFailed'));
      setBusy(false);
    }
  }

  const scopesToShow = consent?.new_scopes?.length ? consent.new_scopes : consent?.scopes || [];
  const redirectHost = (() => { try { return new URL(request.redirect_uri).host || new URL(request.redirect_uri).protocol.slice(0, -1); } catch { return t('oauth.registeredCallback'); } })();
  const official = consent?.client.party_type === 'first_party';
  const developerProfileUrl = consent?.client.developer_url || null;
  const initials = Array.from(consent?.client.name?.trim() || 'A')[0].toUpperCase();

  return (
    <AuthShell title={t('oauth.title')} description={t('oauth.description')}>
      {error ? <div className="status-badge status-badge--danger" role="alert">{error}</div> : null}
      {!consent ? <p className="section-description">{t('oauth.verifying')}</p> : (
        <div className="stack oauth-consent">
          <header className="oauth-consent__app">
            <div className="public-app-avatar">{initials}</div>
            <div><h2>{consent.client.name}</h2><span className={`public-app-label ${official ? 'public-app-label--official' : ''}`}>{official ? t('oauth.official') : t('oauth.thirdParty')}</span></div>
          </header>
          <p className="oauth-consent__developer">{consent.client.developer_name ? developerProfileUrl ? <a href={developerProfileUrl} target="_blank" rel="noreferrer">{t('oauth.developerBy', { name: consent.client.developer_name })}</a> : t('oauth.developerBy', { name: consent.client.developer_name }) : t('oauth.officialProvider')}</p>
          <p>{consent.client.description || t('oauth.missingDescription')}</p>

          <section className="oauth-consent__permissions">
            <h2>{consent.previous_scopes.length ? t('oauth.newScopes') : t('oauth.requestedScopes')}</h2>
            <ul className="public-scope-list">
              {scopesToShow.map((scope) => (
                <li key={scope.name}>
                  <span className="oauth-scope-icon" aria-hidden="true">{SCOPE_ICONS[scope.name] || '•'}</span>
                  <div><strong>{t(`oauth.scope.${scope.name}`) === `oauth.scope.${scope.name}` ? scope.name : t(`oauth.scope.${scope.name}`)}</strong>{scope.sensitive ? <span className="public-scope-sensitive">{t('oauth.sensitive')}</span> : null}<p>{t(`oauth.scopeDesc.${scope.name}`) === `oauth.scopeDesc.${scope.name}` ? scope.description : t(`oauth.scopeDesc.${scope.name}`)}</p><small>{scope.name}</small></div>
                </li>
              ))}
            </ul>
            {consent.previous_scopes.length ? <p className="section-description">{t('oauth.previousConsent')}</p> : null}
          </section>

          <details className="oauth-consent__details">
            <summary>{t('oauth.details')}</summary>
            <dl><div><dt>{t('oauth.clientId')}</dt><dd><code>{consent.client.client_id}</code></dd></div><div><dt>{t('oauth.redirectHost')}</dt><dd>{redirectHost}</dd></div>
              {consent.client.website_url ? <div><dt>{t('oauth.website')}</dt><dd><a href={consent.client.website_url} target="_blank" rel="noreferrer">{consent.client.website_url}</a></dd></div> : null}
              {consent.client.developer_name ? <div><dt>{t('oauth.developer')}</dt><dd>{consent.client.developer_name}</dd></div> : null}
            </dl>
          </details>
          <p className="section-description">{t('oauth.revokeNotice')}</p>
          <div className="oauth-consent__actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('deny')}>{t('oauth.cancel')}</Button>
            <Button type="button" disabled={busy} onClick={() => void decide('approve')}>{busy ? t('oauth.submitting') : t('oauth.approve')}</Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
