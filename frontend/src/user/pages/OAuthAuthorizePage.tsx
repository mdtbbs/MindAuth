import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import api, { ApiError } from '@/api/client';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import { AccessSummary } from '@/shared/ForumAccess';
import { useI18n } from '@/i18n/I18nProvider';

type ScopeInfo = { scope?: string; name: string; description: string; sensitive?: boolean };
type ConsentInfo = {
  success: boolean;
  consent_required: boolean;
  client: {
    client_id: string; name: string; description: string | null; website_url: string | null;
    application_icon_url: string | null;
    client_type: string; party_type: string; developer_name: string | null;
    developer_url: string | null; owner_user_id: number | null;
  };
  scopes: ScopeInfo[];
  new_scopes: ScopeInfo[];
  previous_scopes: string[];
};

export function OAuthAuthorizePage() {
  const { t, locale } = useI18n();
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
  const [busy, setBusy] = useState(false);
  const [clientIconFailed, setClientIconFailed] = useState(false);

  const oauthErrorPath = useCallback((code: string, description: string) => {
    const errorParams = new URLSearchParams({ error: code, description });
    if (request.ui_locales) errorParams.set('ui_locales', request.ui_locales);
    return `/oauth/error?${errorParams.toString()}`;
  }, [request.ui_locales]);

  useEffect(() => {
    if (authLoading) return;
    if (!request.client_id || !request.redirect_uri) {
      navigate(oauthErrorPath('invalid_request', t('oauth.invalidConfiguration')), { replace: true });
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
        if (reason instanceof ApiError && reason.status === 401) {
          navigate(`/login?${query.toString()}`, { replace: true });
          return;
        }
        const code = reason instanceof ApiError && reason.status && reason.status < 500
          ? reason.code || 'invalid_request'
          : 'server_error';
        const description = reason instanceof ApiError ? reason.message : t('oauth.unavailable');
        navigate(oauthErrorPath(code, description), { replace: true });
      });
    return () => { active = false; };
  }, [authLoading, user, request.client_id, request.redirect_uri, request.ui_locales, query, navigate, t, oauthErrorPath]);

  useEffect(() => { setClientIconFailed(false); }, [consent?.client.client_id]);

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true);
    try {
      const response = await api.post<{ success: boolean; redirect_to: string }>('/api/authorize/consent', { ...request, decision });
      window.location.assign(response.redirect_to);
    } catch (reason: unknown) {
      if (reason instanceof ApiError && reason.status === 401) {
        navigate(`/login?${query.toString()}`, { replace: true });
        return;
      }
      const code = reason instanceof ApiError && reason.status && reason.status < 500
        ? reason.code || 'invalid_request'
        : 'server_error';
      const description = reason instanceof ApiError ? reason.message : t('oauth.submitFailed');
      navigate(oauthErrorPath(code, description), { replace: true });
    }
  }

  const official = consent?.client.party_type === 'first_party';
  const developerProfileUrl = consent?.client.developer_url || null;
  const initials = Array.from(consent?.client.name?.trim() || 'A')[0].toUpperCase();

  return (
    <AuthShell title={t('oauth.title')} description={t('oauth.description')}>
      {!consent ? <p className="section-description">{t('oauth.verifying')}</p> : (
        <div className="stack oauth-consent">
          <header className="oauth-consent__app">
            <div className="public-app-avatar">{consent.client.application_icon_url && !clientIconFailed
              ? <img className="oauth-consent__app-icon" src={consent.client.application_icon_url} alt="" onError={() => setClientIconFailed(true)} />
              : initials}</div>
            <div><h2>{consent.client.name}</h2><span className={`public-app-label ${official ? 'public-app-label--official' : ''}`}>{official ? t('oauth.official') : t('oauth.thirdParty')}</span></div>
          </header>
          <p className="oauth-consent__developer">{consent.client.developer_name ? developerProfileUrl ? <a href={developerProfileUrl} target="_blank" rel="noreferrer">{t('oauth.developerBy', { name: consent.client.developer_name })}</a> : t('oauth.developerBy', { name: consent.client.developer_name }) : t('oauth.officialProvider')}</p>
          <p>{consent.client.description || t('oauth.missingDescription')}</p>

          <AccessSummary scopes={consent.scopes.map(scope => scope.scope || scope.name)} locale={locale} />
          {consent.client.website_url ? <a href={consent.client.website_url} target="_blank" rel="noreferrer">{t('oauth.website')}</a> : null}
          <p className="section-description">{t('oauth.revokeNotice')}</p>
          <div className="oauth-consent__actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('deny')}>{t('oauth.cancel')}</Button>
            <Button type="button" disabled={busy} onClick={() => void decide('approve')}>{busy ? t('oauth.submitting') : t('access.approve')}</Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
