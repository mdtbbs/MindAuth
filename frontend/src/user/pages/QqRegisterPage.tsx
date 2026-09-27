import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { AuthShell } from '@/user/components/AuthShell';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { useToast } from '@/shared/ToastProvider';
import { useAuth } from '@/auth/AuthProvider';
import type { QqRegistrationResponse } from '@/api/types';
import { useI18n } from '@/i18n/I18nProvider';
import { localizeRegistrationError } from '@/i18n/authErrors';

interface ChallengeQuestion {
  challenge_id: string | number;
  question: string;
}

const PROVIDERS = new Set(['qq', 'github', 'discord']);

/** Completes email-verified registration after an external provider sign-in. */
export function QqRegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { loadCurrentUser } = useAuth();
  const { t } = useI18n();
  const requestedProvider = params.get('provider') || 'qq';
  const provider = PROVIDERS.has(requestedProvider) ? requestedProvider : 'qq';
  const state = params.get('state') || '';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [challenge, setChallenge] = useState<ChallengeQuestion | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [challengeError, setChallengeError] = useState(false);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setChallengeError(false);
    api.get<{ success: boolean; challenge_id?: string | number | null; question?: string | null }>('/api/challenge/random')
      .then((response) => {
        if (active && response.success && response.challenge_id && response.question) {
          setChallenge({ challenge_id: response.challenge_id, question: response.question });
        }
      })
      .catch(() => { if (active) setChallengeError(true); });
    return () => { active = false; };
  }, [challengeAttempt]);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function sendCode() {
    if (!email.trim()) {
      toast('error', t('social.emailRequired'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast('error', t('social.emailInvalid'));
      return;
    }
    if (countdown > 0) return;
    setCodeSending(true);
    try {
      await api.post('/api/register/send-code', { email: email.trim() });
      setCountdown(60);
      toast('success', t('social.codeSent'));
    } catch (err: unknown) {
      toast('error', localizeRegistrationError(err, t, t('social.codeSendFailed')));
    } finally {
      setCodeSending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state) {
      toast('error', t('social.invalidDescription'));
      navigate('/login', { replace: true });
      return;
    }
    if (!username.trim() || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || !/^\d{6}$/.test(emailCode) || password.length < 8 || !(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) {
      toast('error', t('social.fieldsRequired'));
      return;
    }
    if (challenge && !challengeAnswer.trim()) {
      toast('error', t('register.challengeAnswerRequired'));
      return;
    }
    if (challengeError) {
      toast('error', t('register.challengeLoadFailed'));
      return;
    }
    setLoading(true);
    try {
      const path = provider === 'qq' ? '/api/auth/qq/complete' : '/api/auth/social/complete';
      const response = await api.post<QqRegistrationResponse>(path, {
        state,
        username: username.trim(),
        email: email.trim(),
        email_code: emailCode,
        password,
        ...(challenge && { challenge_id: challenge.challenge_id, challenge_answer: challengeAnswer }),
      });
      await loadCurrentUser();
      toast('success', t('social.registered'));
      window.location.href = response.redirect || '/dashboard';
    } catch (err: unknown) {
      toast('error', localizeRegistrationError(err, t, t('social.submitFailed')));
    } finally {
      setLoading(false);
    }
  }

  const providerName = t(`social.${provider}`);
  if (!state) {
    return (
      <AuthShell title={t('social.invalidTitle')} description={t('social.invalidDescription')} footer={<Link className="inline-link" to="/login">{t('security.cancel')}</Link>}>
        <p>{t('social.restart')}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('social.registrationTitle')}
      description={t('social.registrationDescription', { provider: providerName })}
      footer={<Link className="inline-link" to="/login">{t('security.cancel')}</Link>}
    >
      <form onSubmit={submit} className="stack">
        <TextField label={t('social.username')} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />
        <TextField label={t('social.email')} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        <div className="cluster">
          <TextField label={t('social.emailCode')} value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
          <Button type="button" variant="secondary" size="sm" loading={codeSending} disabled={codeSending || countdown > 0} onClick={sendCode}>
            {countdown > 0 ? t('social.resendAfter', { seconds: countdown }) : t('social.sendCode')}
          </Button>
        </div>
        {challengeError ? <div role="alert"><p className="field__error">{t('register.challengeLoadFailed')}</p><Button type="button" variant="secondary" size="sm" onClick={() => setChallengeAttempt((value) => value + 1)}>{t('shared.retry')}</Button></div> : null}
        {challenge ? <TextField label={t('social.challengeLabel', { question: challenge.question })} value={challengeAnswer} onChange={(event) => setChallengeAnswer(event.target.value)} autoComplete="off" /> : null}
        <TextField label={t('social.password')} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" hint={t('register.passwordHint')} />
        <Button type="submit" fullWidth size="lg" loading={loading}>{loading ? t('social.processing') : t('social.complete')}</Button>
      </form>
    </AuthShell>
  );
}
