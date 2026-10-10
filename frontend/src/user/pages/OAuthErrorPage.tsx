import { useSearchParams, Link } from 'react-router-dom';
import { useI18n } from '@/i18n/I18nProvider';
import './OAuthCompletePage.css';

const KNOWN_ERRORS = new Set([
  'invalid_request', 'invalid_client', 'invalid_redirect', 'invalid_scope',
  'unsupported_response_type', 'server_error', 'access_denied',
]);

export function OAuthErrorPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const error = params.get('error') || 'server_error';
  const description = params.get('description') || '';
  const messageKey = `oauth.complete.error.${KNOWN_ERRORS.has(error) ? error : 'server_error'}`;

  return (
    <div className="oauth-complete">
      <header className="oauth-complete__header">
        <Link to="/login" className="oauth-complete__brand" aria-label={t('oauth.complete.brand')}>
          <img src="/account-logo.svg" alt="" aria-hidden="true" />
          <span>{t('oauth.complete.brand')}</span>
        </Link>
      </header>
      <main className="oauth-complete__main">
        <section className="oauth-complete__error" role="alert">
          <div className="oauth-complete__error-mark" aria-hidden="true">!</div>
          <h1>{t('oauth.complete.genericError')}</h1>
          <p>{t(messageKey)}</p>
          <details className="oauth-complete__technical">
            <summary>{t('oauth.complete.technical')}</summary>
            <code>{error}</code>
            {description ? <p>{description}</p> : null}
          </details>
          <Link className="oauth-complete__button" to="/login">{t('oauth.complete.backToLogin')}</Link>
        </section>
      </main>
    </div>
  );
}
