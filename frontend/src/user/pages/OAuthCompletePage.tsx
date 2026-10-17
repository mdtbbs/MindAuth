import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { ApiError } from '@/api/client';
import { AccessSummary } from '@/shared/ForumAccess';
import { useI18n } from '@/i18n/I18nProvider';
import { ThemeToggle } from '@/shared/ThemeToggle';
import './OAuthCompletePage.css';

type OAuthCompletion = {
  success: boolean;
  status: 'success' | 'cancelled';
  client: {
    name: string;
    application_icon_url: string | null;
    party_type: string;
    ecosystem: string;
    developer_name: string | null;
    developer_url: string | null;
  };
  account: { display_name: string; username: string; avatar_url: string | null };
  scopes: Array<{ scope?: string; name: string; description: string; sensitive?: boolean }>;
};

type ReturnState = 'idle' | 'returning' | 'manual' | 'opened';

function isRegisteredAppUri(value: string) {
  try {
    const url = new URL(value);
    return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
      && !['http:', 'https:', 'javascript:', 'vbscript:', 'data:', 'file:', 'blob:', 'about:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function IdentityAvatar({ name, src, failedLabel }: { name: string; src: string | null; failedLabel: string }) {
  const [failed, setFailed] = useState(false);
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() || '?';
  if (src && !failed) {
    return <img className="oauth-complete__avatar" src={src} alt={failedLabel} onError={() => setFailed(true)} />;
  }
  return <span className="oauth-complete__avatar oauth-complete__avatar--fallback" aria-hidden="true">{initial}</span>;
}

export function OAuthCompletePage() {
  const { t, locale } = useI18n();
  const [ticket, setTicket] = useState('');
  const [completion, setCompletion] = useState<OAuthCompletion | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'expired' | 'failed'>('loading');
  const [returnState, setReturnState] = useState<ReturnState>('idle');
  const autoAttempted = useRef(false);
  const returnInFlight = useRef(false);
  const returnTimer = useRef<number | null>(null);

  useEffect(() => {
    const ticketValue = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('ticket') || '';
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    setTicket(ticketValue);
  }, []);

  const attemptReturn = useCallback(async () => {
    if (!ticket || returnInFlight.current) return;
    returnInFlight.current = true;
    setReturnState('returning');
    try {
      const response = await api.post<{ success: boolean; redirect_to: string }>('/api/authorize/complete-return', { ticket });
      if (!isRegisteredAppUri(response.redirect_to)) throw new Error('Registered app callback is unavailable');
      window.location.assign(response.redirect_to);
      if (returnTimer.current !== null) window.clearTimeout(returnTimer.current);
      returnTimer.current = window.setTimeout(() => {
        returnInFlight.current = false;
        setReturnState(document.visibilityState === 'hidden' ? 'opened' : 'manual');
      }, 2200);
    } catch {
      returnInFlight.current = false;
      setReturnState('manual');
    }
  }, [ticket]);

  useEffect(() => {
    if (!ticket) {
      setLoadState('expired');
      return;
    }
    let active = true;
    api.post<OAuthCompletion>('/api/authorize/complete-info', { ticket })
      .then((data) => {
        if (!active) return;
        setCompletion(data);
        setLoadState('ready');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 410) setLoadState('expired');
        else setLoadState('failed');
      });
    return () => { active = false; };
  }, [ticket]);

  useEffect(() => {
    if (loadState !== 'ready' || autoAttempted.current) return;
    autoAttempted.current = true;
    const timer = window.setTimeout(() => { void attemptReturn(); }, 250);
    return () => window.clearTimeout(timer);
  }, [loadState, attemptReturn]);

  useEffect(() => {
    const markReturned = () => {
      if ((document.visibilityState === 'hidden' || !document.hasFocus()) && returnState === 'returning') {
        returnInFlight.current = false;
        if (returnTimer.current !== null) window.clearTimeout(returnTimer.current);
        setReturnState('opened');
      }
    };
    document.addEventListener('visibilitychange', markReturned);
    window.addEventListener('blur', markReturned);
    return () => {
      document.removeEventListener('visibilitychange', markReturned);
      window.removeEventListener('blur', markReturned);
    };
  }, [returnState]);

  useEffect(() => () => {
    if (returnTimer.current !== null) window.clearTimeout(returnTimer.current);
  }, []);

  const clientName = completion?.client.name || '';
  const displayName = completion?.account.display_name || completion?.account.username || '';
  const cancelled = completion?.status === 'cancelled';
  const errorTitle = loadState === 'expired' ? t('oauth.complete.expiredTitle') : t('oauth.complete.genericError');

  return (
    <div className="oauth-complete">
      <header className="oauth-complete__header">
        <Link to="/login" className="oauth-complete__brand" aria-label={t('oauth.complete.brand')}>
          <img src="/account-logo.svg" alt="" aria-hidden="true" />
          <span>{t('oauth.complete.brand')}</span>
        </Link>
        <nav className="oauth-complete__header-links" aria-label={t('legal.aria')}>
          <ThemeToggle label={t('shell.themeToggle')} />
          <a href="https://mdtbbs.cn/about" target="_blank" rel="noopener noreferrer">{t('oauth.complete.help')}</a>
          <a href="https://mdtbbs.cn/privacy" target="_blank" rel="noopener noreferrer">{t('legal.privacy')}</a>
          <a href="https://mdtbbs.cn/terms" target="_blank" rel="noopener noreferrer">{t('legal.terms')}</a>
          <Link to="/security">{t('oauth.complete.security')}</Link>
        </nav>
      </header>

      <main className="oauth-complete__main">
        {loadState === 'loading' ? (
          <section className="oauth-complete__message" role="status" aria-live="polite">
            <span className="oauth-complete__spinner" aria-hidden="true" />
            <p>{t('oauth.verifying')}</p>
          </section>
        ) : loadState !== 'ready' || !completion ? (
          <section className="oauth-complete__error" role="alert">
            <div className="oauth-complete__error-mark" aria-hidden="true">!</div>
            <h1>{errorTitle}</h1>
            <p>{loadState === 'expired' ? t('oauth.complete.expiredDescription') : t('oauth.complete.loadFailed')}</p>
            <Link className="oauth-complete__button" to="/login">{t('oauth.complete.backToLogin')}</Link>
          </section>
        ) : (
          <article className="oauth-complete__content" aria-labelledby="oauth-complete-title">
            <section className={`oauth-complete__hero${cancelled ? ' oauth-complete__hero--cancelled' : ''}`}>
              <div className="oauth-complete__success-mark" aria-hidden="true">{cancelled ? '×' : '✓'}</div>
              <h1 id="oauth-complete-title">{cancelled ? t('oauth.complete.cancelledTitle') : t('oauth.complete.title')}</h1>
              <p className="oauth-complete__welcome">
                {cancelled ? t('oauth.complete.cancelledDescription', { client: clientName }) : t('oauth.complete.welcome', { name: displayName })}
              </p>
              {!cancelled ? <p className="oauth-complete__signed-in">{t('oauth.complete.signedInTo', { client: clientName })}</p> : null}
              {returnState === 'returning' || returnState === 'opened' ? (
                <p className="oauth-complete__return-status" role="status" aria-live="polite" aria-atomic="true">
                  {returnState === 'returning' ? <span className="oauth-complete__spinner" aria-hidden="true" /> : <span aria-hidden="true">✓</span>}
                  {t('oauth.complete.returning')}
                </p>
              ) : returnState === 'manual' ? (
                <p className="oauth-complete__return-status oauth-complete__return-status--manual" role="status" aria-live="polite" aria-atomic="true">
                  <span aria-hidden="true">!</span>{t('oauth.complete.openFailed')}
                </p>
              ) : null}
              <button className="oauth-complete__button" type="button" disabled={returnState === 'returning'} onClick={() => void attemptReturn()}>
                {returnState === 'manual' ? t('oauth.complete.retry', { client: clientName }) : (
                  <><span className="oauth-complete__desktop-label">{t('oauth.complete.return', { client: clientName })}</span><span className="oauth-complete__mobile-label">{t('oauth.complete.open', { client: clientName })}</span></>
                )}
              </button>
              {returnState === 'manual' ? <p className="oauth-complete__return-hint">{t('oauth.complete.returnHint')}</p> : null}
            </section>

            <ol className="oauth-complete__progress" aria-label={t('oauth.complete.statusLabel')}>
              <li className="oauth-complete__progress-step oauth-complete__progress-step--done">
                <span aria-hidden="true">✓</span><span>{t('oauth.complete.authentication')}</span>
              </li>
              <li className={`oauth-complete__progress-step ${cancelled ? 'oauth-complete__progress-step--cancelled' : 'oauth-complete__progress-step--done'}`}>
                <span aria-hidden="true">{cancelled ? '!' : '✓'}</span><span>{cancelled ? t('oauth.complete.cancelledTitle') : t('oauth.complete.authorization')}</span>
              </li>
              <li className={`oauth-complete__progress-step ${returnState === 'manual' ? 'oauth-complete__progress-step--failed' : returnState === 'opened' ? 'oauth-complete__progress-step--done' : 'oauth-complete__progress-step--active'}`}>
                <span aria-hidden="true">{returnState === 'manual' ? '!' : returnState === 'opened' ? '✓' : '3'}</span>
                <span>{returnState === 'manual' ? t('oauth.complete.openFailed') : t('oauth.complete.returnStep')}</span>
              </li>
            </ol>

            <section className="oauth-complete__identities" aria-label={`${t('oauth.complete.account')} / ${t('oauth.complete.application')}`}>
              <div className="oauth-complete__identity">
                <h2>{t('oauth.complete.account')}</h2>
                <div className="oauth-complete__identity-body">
                  <IdentityAvatar name={displayName || completion.account.username} src={completion.account.avatar_url} failedLabel={t('oauth.complete.avatarFallback')} />
                  <div className="oauth-complete__identity-copy">
                    <strong title={displayName}>{displayName}</strong>
                    <span>@{completion.account.username}</span>
                  </div>
                </div>
              </div>
              <div className="oauth-complete__identity">
                <h2>{t('oauth.complete.application')}</h2>
                <div className="oauth-complete__identity-body">
                  <IdentityAvatar name={clientName} src={completion.client.application_icon_url} failedLabel={clientName} />
                  <div className="oauth-complete__identity-copy">
                    <strong title={clientName}>{clientName}</strong>
                    <span>{completion.client.party_type === 'first_party' ? t('oauth.complete.firstParty') : t('oauth.complete.thirdParty')}</span>
                    {completion.client.party_type !== 'first_party' && completion.client.developer_name ? (
                      completion.client.developer_url
                        ? <a href={completion.client.developer_url} target="_blank" rel="noopener noreferrer">{t('oauth.developerBy', { name: completion.client.developer_name })}</a>
                        : <span>{t('oauth.developerBy', { name: completion.client.developer_name })}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {!cancelled && completion.scopes.length ? (
              <section className="oauth-complete__access">
                <h2>{t('oauth.complete.authorizedAccess')}</h2>
                <AccessSummary scopes={completion.scopes.map(scope => scope.scope || scope.name)} locale={locale} />
              </section>
            ) : null}
          </article>
        )}
      </main>
    </div>
  );
}
