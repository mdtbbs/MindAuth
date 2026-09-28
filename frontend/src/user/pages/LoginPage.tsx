import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';
import { SocialProviderButtons } from '@/user/components/SocialProviderButtons';

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login, user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();

  const redirectUri = params.get('redirect_uri') || params.get('redirect') || '';
  const clientId = params.get('client_id') || '';
  const clientName = params.get('client_name') || '';
  const ecosystem = params.get('ecosystem') || '';
  const uiLocales = params.get('ui_locales') || '';
  const state = params.get('state') || '';
  const scope = params.get('scope') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const codeChallengeMethod = params.get('code_challenge_method') || '';
  const deviceUserCode = params.get('device_user_code') || '';
  const errorParam = params.get('error') || '';
  const messageParam = params.get('message') || '';
  const providerError = errorParam === 'social_login_failed' || errorParam === 'qq_login_failed'
    ? t('social.loginFailed')
    : errorParam === 'USER_BANNED' || errorParam === 'ACCOUNT_LOCKED'
      ? t('social.accountUnavailable')
      : errorParam;

  const isOAuthFlow = Boolean(redirectUri && clientId);

  const authorizeParams = useMemo(() => new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      ...(state && { state }),
      ...(scope && { scope }),
      ...(codeChallenge && { code_challenge: codeChallenge }),
      ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
      ...(uiLocales && { ui_locales: uiLocales }),
    }), [clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, uiLocales]);

  function buildAuthFlowParams() {
    return new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      ...(clientName && { client_name: clientName }),
      ...(ecosystem && { ecosystem }),
      ...(state && { state }),
      ...(scope && { scope }),
      ...(codeChallenge && { code_challenge: codeChallenge }),
      ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
      ...(uiLocales && { ui_locales: uiLocales }),
    });
  }

  const authFlowQuery = isOAuthFlow ? buildAuthFlowParams().toString() : '';
  const registerHref = authFlowQuery ? `/register?${authFlowQuery}` : '/register';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'password' | 'social'>('password');

  useEffect(() => {
    if (user && !authLoading) {
      if (deviceUserCode) {
        navigate(`/device?user_code=${encodeURIComponent(deviceUserCode)}`, { replace: true });
      } else if (isOAuthFlow) {
        window.location.href = `/api/authorize?${authorizeParams.toString()}`;
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, authLoading, isOAuthFlow, authorizeParams, deviceUserCode, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!username.trim() || !password) {
      setFormError(t('auth.enterCredentials'));
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
      toast('success', t('auth.loginSuccess'));

      if (deviceUserCode) {
        navigate(`/device?user_code=${encodeURIComponent(deviceUserCode)}`, { replace: true });
      } else if (isOAuthFlow) {
        window.location.href = `/api/authorize?${authorizeParams.toString()}`;
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err: unknown) {
      const errorCode = (err as { code?: string } | null)?.code;
      const msg = errorCode === 'USER_BANNED' || errorCode === 'ACCOUNT_LOCKED'
        ? t('social.accountUnavailable')
        : errorCode === 'RATE_LIMITED'
          ? t('social.rateLimited')
          : t('auth.loginFailed');
      setFormError(msg);
      toast('error', msg);
    } finally {
      setLoading(false);
    }
  }

  const title = isOAuthFlow && clientName ? t('auth.login') : t('auth.login');
  const description = isOAuthFlow
    ? t('auth.continue', { client: clientName || 'the application' })
    : t('auth.directDescription');

  return (
    <AuthShell
      title={title}
      description={description}
      footer={
        <>
          <Link to={registerHref} className="inline-link">
            {t('auth.noAccount')} {t('auth.register')}
          </Link>
          <span className="text-muted">/</span>
          <Link to="/reset-request" className="inline-link">
            {t('auth.forgot')}
          </Link>
        </>
      }
    >
      <form id="login-form" onSubmit={handleSubmit} data-testid="login-form">
        <div className="stack">
          <div className="auth-method-tabs" role="tablist" aria-label={t('auth.chooseLogin')}>
            <button
              id="password-login-tab"
              type="button"
              role="tab"
              aria-selected={loginMethod === 'password'}
              aria-controls="login-method-panel"
              className="auth-method-tab"
              onClick={() => setLoginMethod('password')}
            >
              {t('auth.passwordTab')}
            </button>
            <button
              id="social-login-tab"
              type="button"
              role="tab"
              aria-selected={loginMethod === 'social'}
              aria-controls="login-method-panel"
              className="auth-method-tab"
              onClick={() => setLoginMethod('social')}
            >
              {t('social.providers')}
            </button>
          </div>

          <div id="login-method-panel" role="tabpanel" aria-labelledby={`${loginMethod}-login-tab`}>
            {isOAuthFlow && clientName ? (
              <div className="status-badge status-badge--info auth-login__context">{t('auth.connecting', { client: clientName })}</div>
            ) : null}
            {formError || errorParam || messageParam ? (
              <div className="auth-form__alert" role="alert">
                <div className="status-badge status-badge--danger">{t('auth.loginError')}</div>
                <p className="section-description auth-form__alert-text">{formError || (messageParam && !errorParam.endsWith('_failed') && errorParam !== 'USER_BANNED' && errorParam !== 'ACCOUNT_LOCKED' ? messageParam : '') || providerError}</p>
              </div>
            ) : null}

            {loginMethod === 'password' ? (
              <div className="stack auth-method-panel">
                <TextField
                  id="username"
                  label={t('auth.usernameOrEmail')}
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('auth.usernamePlaceholder')}
                  autoComplete="username"
                  autoFocus
                />
                <TextField
                  id="password"
                  label={t('auth.password')}
                  type="password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  autoComplete="current-password"
                />
                <Button type="submit" fullWidth size="lg" loading={loading} data-testid="login-submit">
                  {t('auth.login')}
                </Button>
              </div>
            ) : (
              <div className="auth-method-panel">
                <SocialProviderButtons authorizeQuery={authFlowQuery} />
              </div>
            )}
          </div>
        </div>
      </form>
    </AuthShell>
  );
}
