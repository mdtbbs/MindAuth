import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import type { SendRegistrationCodeResponse } from '@/api/types';
import { useI18n } from '@/i18n/I18nProvider';
import { localizeRegistrationError } from '@/i18n/authErrors';
import { SocialProviderButtons } from '@/user/components/SocialProviderButtons';

interface ChallengeQuestion {
  challenge_id: string | number;
  question: string;
}

// Mirrors backend rules (utils/validation.js): 8+ chars, upper + lower + digit
function validateUsername(v: string, t: (key: string) => string): string {
  if (!v.trim()) return t('register.usernameRequired');
  if (v.trim().length < 3) return t('register.usernameMin');
  return '';
}
function validateEmail(v: string, t: (key: string) => string): string {
  if (!v.trim()) return t('register.emailRequired');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return t('register.emailInvalid');
  return '';
}
function validatePassword(v: string, t: (key: string) => string): string {
  if (!v) return t('register.passwordRequired');
  if (v.length < 8) return t('register.passwordMin');
  if (!(/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v))) return t('register.passwordComplexity');
  return '';
}
function validateEmailCode(v: string, t: (key: string) => string): string {
  if (!v) return t('register.codeRequired');
  if (!/^\d{6}$/.test(v)) return t('register.codeFormat');
  return '';
}

/** 0–4 strength score from length + character variety. */
function passwordStrength(v: string): number {
  if (!v) return 0;
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
  return Math.min(score, 4);
}
const SEND_COOLDOWN_SECONDS = 60;

export function RegisterPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, login } = useAuth();
  const { toast } = useToast();

  const redirectUri = params.get('redirect_uri') || params.get('redirect') || '';
  const clientId = params.get('client_id') || '';
  const clientName = params.get('client_name') || '';
  const ecosystem = params.get('ecosystem') || '';
  const stateParam = params.get('state') || '';
  const scope = params.get('scope') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const codeChallengeMethod = params.get('code_challenge_method') || '';
  const uiLocales = params.get('ui_locales') || '';
  const errorParam = params.get('error') || '';
  const messageParam = params.get('message') || '';
  const isOAuthFlow = Boolean(clientId && redirectUri);
  const socialRegisterParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    ...(clientName && { client_name: clientName }),
    ...(ecosystem && { ecosystem }),
    ...(stateParam && { state: stateParam }),
    ...(scope && { scope }),
    ...(codeChallenge && { code_challenge: codeChallenge }),
    ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
    ...(uiLocales && { ui_locales: uiLocales }),
  });

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string;
    email?: string;
    password?: string;
  }>({});
  const [touched, setTouched] = useState<{
    username?: boolean;
    email?: boolean;
    password?: boolean;
  }>({});
  const [loading, setLoading] = useState(false);

  // Email code state
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [emailFieldError, setEmailFieldError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<number | null>(null);

  const strength = passwordStrength(password);
  const strengthLabel = t(`register.strength.${strength}`);

  const [challenge, setChallenge] = useState<ChallengeQuestion | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [challengeError, setChallengeError] = useState('');
  const [challengeLoading, setChallengeLoading] = useState(true);

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  // Clear the countdown timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (countdownRef.current !== null) {
        window.clearInterval(countdownRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setChallengeLoading(true);
    api
      .get<{ success: boolean; challenge_id?: string | number | null; question?: string | null }>('/api/challenge/random')
      .then((res) => {
        if (res.success && res.challenge_id && res.question) {
          setChallenge({ challenge_id: res.challenge_id, question: res.question });
        } else {
          setChallenge(null);
        }
      })
      .catch(() => setChallengeError(t('register.challengeLoadFailed')))
      .finally(() => setChallengeLoading(false));
  }, [t]);

  function runValidation() {
    const errs = {
      username: validateUsername(username, t),
      email: validateEmail(email, t),
      password: validatePassword(password, t),
    };
    setFieldErrors(errs);
    setTouched({ username: true, email: true, password: true });
    return !errs.username && !errs.email && !errs.password;
  }

  function startCountdown(seconds: number) {
    setCountdown(seconds);
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current);
    }
    countdownRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current !== null) {
            window.clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSendCode() {
    const emailErr = validateEmail(email, t);
    if (emailErr) {
      setFieldErrors((p) => ({ ...p, email: emailErr }));
      setTouched((p) => ({ ...p, email: true }));
      return;
    }

    setCodeSending(true);
    setCodeError('');
    setEmailFieldError('');
    try {
      const res = await api.post<SendRegistrationCodeResponse>('/api/register/send-code', {
        email: email.trim(),
      });
      if (res.success) {
        setCodeSent(true);
        startCountdown(SEND_COOLDOWN_SECONDS);
        // In dev mode, the response includes the code for tests.
        // If it's there, pre-fill for convenience (dev-only).
        if (res.code) {
          setEmailCode(res.code);
        }
      }
    } catch (err: unknown) {
      const msg = localizeRegistrationError(err, t, t('register.codeSendFailed'));
      // Map known error codes to inline email field errors
      const errObj = err as { code?: string; message?: string } | null;
      const code = errObj?.code;
      if (code === 'EMAIL_ALREADY_REGISTERED') {
        setEmailFieldError(t('register.emailAlreadyRegistered'));
      } else if (code === 'SMTP_UNAVAILABLE') {
        setCodeError(t('register.emailServiceUnavailable'));
      } else if (code === 'EMAIL_COOLDOWN') {
        setCodeError(msg);
      } else {
        toast('error', msg);
      }
    } finally {
      setCodeSending(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!runValidation()) return;

    const codeErr = validateEmailCode(emailCode, t);
    if (codeErr) {
      setCodeError(codeErr);
      return;
    }

    if (challenge && !challengeAnswer.trim()) {
      setChallengeError(t('register.challengeAnswerRequired'));
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; message: string }>('/api/register', {
        username: username.trim(),
        email: email.trim(),
        password,
        email_code: emailCode,
        ...(challenge && { challenge_id: challenge.challenge_id, challenge_answer: challengeAnswer.trim() }),
      });

      if (res.success) {
        toast('success', t('register.success'));

        try {
          await login(username.trim(), password);

          if (redirectUri && clientId) {
            const oauthParams = new URLSearchParams({
              client_id: clientId,
              redirect_uri: redirectUri,
              ...(stateParam && { state: stateParam }),
              ...(scope && { scope }),
              ...(codeChallenge && { code_challenge: codeChallenge }),
              ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
              ...(uiLocales && { ui_locales: uiLocales }),
            });
            window.location.href = `/api/authorize?${oauthParams.toString()}`;
          } else {
            navigate('/dashboard', { replace: true });
          }
        } catch {
          navigate('/login', { replace: true });
        }
      }
    } catch (err: unknown) {
      const errObj = err as { code?: string } | null;
      const code = errObj?.code;
      const msg = localizeRegistrationError(err, t, t('register.submitFailed'));

      if (code === 'EMAIL_CODE_INVALID' || code === 'EMAIL_CODE_MISMATCH' || code === 'EMAIL_CODE_MAX_FAILURES') {
        setCodeError(msg);
      } else if (code?.startsWith('CHALLENGE_')) {
        setChallengeError(msg);
      } else {
        toast('error', msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const emailValid = !validateEmail(email, t);
  const canSendCode = emailValid && !codeSending && countdown === 0;
  const canSubmit = emailValid && codeSent && /^\d{6}$/.test(emailCode) && !loading;

  return (
    <AuthShell
      title={t('auth.register')}
      description={clientId && clientName
        ? t('auth.continue', { client: clientName })
        : t('auth.directDescription')}
      footer={
        <div className="stack" style={{ alignItems: 'center', gap: 'var(--space-2)' }}>
          <Link to="/login" className="inline-link">
            {t('auth.haveAccount')} {t('auth.login')}
          </Link>
          {isOAuthFlow ? (
            <>
              <span className="text-muted">{t('register.or')}</span>
              <SocialProviderButtons authorizeQuery={socialRegisterParams.toString()} />
            </>
          ) : null}
        </div>
      }
    >
      <form id="register-form" onSubmit={handleSubmit} data-testid="register-form">
        <div className="stack">
          {clientId && clientName ? (
            <div className="status-badge status-badge--info">{t('register.oauthContinuing', { client: clientName })}</div>
          ) : null}
          {errorParam || messageParam ? <div className="auth-form__alert" role="alert">{messageParam || errorParam}</div> : null}
          {challengeLoading ? <div className="text-muted">{t('register.loadingChallenge')}</div> : null}
          {challengeError && !challenge ? <div className="auth-form__alert" role="alert">{challengeError}</div> : null}
          <TextField
            id="username"
            label={t('register.username')}
            name="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (touched.username) setFieldErrors((p) => ({ ...p, username: validateUsername(e.target.value, t) }));
            }}
            onBlur={() => {
              setTouched((p) => ({ ...p, username: true }));
              setFieldErrors((p) => ({ ...p, username: validateUsername(username, t) }));
            }}
            error={touched.username ? fieldErrors.username : undefined}
            placeholder={t('register.usernamePlaceholder')}
            autoComplete="username"
            autoFocus
          />
          <div>
            <TextField
              id="email"
              label={t('register.email')}
              type="email"
              name="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailFieldError('');
                if (touched.email) setFieldErrors((p) => ({ ...p, email: validateEmail(e.target.value, t) }));
                // Reset code state when email changes.
                if (codeSent && e.target.value.trim().toLowerCase() !== email.trim().toLowerCase()) {
                  setCodeSent(false);
                  setEmailCode('');
                  setCodeError('');
                }
              }}
              onBlur={() => {
                setTouched((p) => ({ ...p, email: true }));
                setFieldErrors((p) => ({ ...p, email: validateEmail(email, t) }));
              }}
              error={touched.email ? fieldErrors.email || emailFieldError : emailFieldError || undefined}
              placeholder={t('register.emailPlaceholder')}
              autoComplete="email"
            />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleSendCode}
                disabled={!canSendCode}
                loading={codeSending}
                data-testid="register-send-code"
              >
                {countdown > 0 ? t('register.resendAfter', { seconds: countdown }) : codeSent ? t('register.resendCode') : t('register.sendCode')}
              </Button>
              {codeSent && (
                <span className="text-muted" style={{ fontSize: 12 }} data-testid="register-code-sent-hint">
                  {t('register.emailCodeSent')}
                </span>
              )}
            </div>
          </div>

          {codeSent && (
            <TextField
              id="emailCode"
              label={t('register.emailCode')}
              name="emailCode"
              value={emailCode}
              onChange={(e) => {
                // Keep only digits, max 6
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                setEmailCode(digits);
                if (codeError) setCodeError('');
              }}
              onBlur={() => {
                if (emailCode) {
                  const err = validateEmailCode(emailCode, t);
                  if (err) setCodeError(err);
                }
              }}
              error={codeError || undefined}
              placeholder={t('register.emailCodePlaceholder')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              data-testid="register-email-code"
            />
          )}

          <div className="stack stack--sm">
            <TextField
              id="password"
              label={t('register.password')}
              type="password"
              name="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (touched.password) setFieldErrors((p) => ({ ...p, password: validatePassword(e.target.value, t) }));
              }}
              onBlur={() => {
                setTouched((p) => ({ ...p, password: true }));
                setFieldErrors((p) => ({ ...p, password: validatePassword(password, t) }));
              }}
              error={touched.password ? fieldErrors.password : undefined}
              hint={touched.password && fieldErrors.password ? undefined : t('register.passwordHint')}
              placeholder={t('register.passwordPlaceholder')}
              autoComplete="new-password"
            />
            {password ? (
              <div className="password-strength" aria-live="polite">
                <div className="password-strength__track">
                  <div
                    className={`password-strength__bar password-strength__bar--${strength}`}
                    style={{ width: `${(strength / 4) * 100}%` }}
                  />
                </div>
                <span className="password-strength__label">{t('register.strengthLabel')}{strengthLabel}</span>
              </div>
            ) : null}
          </div>

          {challenge ? (
            <TextField
              label={t('register.challengeLabel', { question: challenge.question })}
              name="challenge"
              value={challengeAnswer}
              onChange={(e) => {
                setChallengeAnswer(e.target.value);
                setChallengeError('');
              }}
              error={challengeError}
              placeholder={t('register.answerPlaceholder')}
            />
          ) : null}

          <Button type="submit" fullWidth size="lg" loading={loading} disabled={!canSubmit} data-testid="register-submit">
            {t('register.submit')}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
