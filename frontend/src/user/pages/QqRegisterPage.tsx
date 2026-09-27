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

/**
 * QQ 注册页面
 *
 * 用户未绑定 QQ 时会跳转此页面，需要填写：
 * - 用户名
 * - 邮箱
 * - 邮箱验证码
 * - 密码
 *
 * 注册成功后会自动创建 session 并跳转到 dashboard 或恢复 OAuth 流程。
 */
export function QqRegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { loadCurrentUser } = useAuth();
  const { t } = useI18n();

  const state = params.get('state') || '';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function sendCode() {
    if (!email) {
      toast('error', t('qq.emailRequired'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast('error', t('qq.emailInvalid'));
      return;
    }
    if (countdown > 0) return;
    setCodeSending(true);
    try {
      await api.post('/api/register/send-code', { email: email.trim() });
      setCountdown(60);
      toast('success', t('qq.codeSent'));
    } catch (err: unknown) {
      toast('error', localizeRegistrationError(err, t, t('qq.codeSendFailed')));
    } finally {
      setCodeSending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state) {
      toast('error', t('qq.invalidState'));
      navigate('/login', { replace: true });
      return;
    }
    if (!username.trim() || !email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim()) || !/^\d{6}$/.test(emailCode) || password.length < 8) {
      toast('error', t('qq.fieldsRequired'));
      return;
    }
    setLoading(true);
    try {
      const response = await api.post<QqRegistrationResponse>('/api/auth/qq/complete', {
        state,
        username: username.trim(),
        email: email.trim(),
        email_code: emailCode,
        password,
      });

      // 刷新当前用户
      await loadCurrentUser();

      toast('success', t('qq.registered'));

      // 跳转到后端返回的 URL，或默认 dashboard
      const redirectUrl = response.redirect || '/dashboard';
      window.location.href = redirectUrl;
    } catch (err: unknown) {
      toast('error', localizeRegistrationError(err, t, t('qq.submitFailed')));
    } finally {
      setLoading(false);
    }
  }

  // state 缺失时显示错误
  if (!state) {
    return (
      <AuthShell
        title={t('qq.invalidTitle')}
        description={t('qq.invalidDescription')}
        footer={<Link className="inline-link" to="/login">{t('qq.backToLogin')}</Link>}
      >
        <p>{t('qq.restartFlow')}</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('qq.registerTitle')}
      description={t('qq.registerDescription')}
      footer={<Link className="inline-link" to="/login">{t('qq.backToLogin')}</Link>}
    >
      <form onSubmit={submit} className="stack">
        <TextField
          label={t('qq.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />
        <TextField
          label={t('qq.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <div className="cluster">
          <TextField
            label={t('qq.emailCode')}
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
          />
          <Button type="button" variant="secondary" size="sm" loading={codeSending} disabled={codeSending || countdown > 0} onClick={sendCode}>
            {countdown > 0 ? t('qq.resendAfter', { seconds: countdown }) : t('qq.sendCode')}
          </Button>
        </div>
        <TextField
          label={t('qq.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" fullWidth size="lg" loading={loading}>
          {loading ? t('qq.processing') : t('qq.complete')}
        </Button>
      </form>
    </AuthShell>
  );
}
