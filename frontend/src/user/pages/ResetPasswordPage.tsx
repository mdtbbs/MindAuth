import { useState, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '@/api/client';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!password || password.length < 8) {
      setError(t('resetPassword.required'));
      return;
    }
    if (password !== confirm) {
      setError(t('resetPassword.mismatch'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post('/api/password/reset', { token, new_password: password });
      setSuccess(true);
    } catch {
      setError(t('resetPassword.failed'));
    } finally {
      setLoading(false);
    }
  }

  const missingTokenContent = (
    <div className="stack">
      <div className="status-badge status-badge--danger">{t('resetPassword.missingToken')}</div>
      <p className="section-description">{t('resetPassword.missingTokenDescription')}</p>
      <Link to="/reset-request">
        <Button variant="primary" fullWidth>
          {t('resetPassword.requestAgain')}
        </Button>
      </Link>
    </div>
  );

  return (
    <AuthShell
      title={t('resetPassword.title')}
      description={t('resetPassword.description')}
      footer={
        <Link to="/login" className="inline-link">
          {t('verify.login')}
        </Link>
      }
    >
      {!token ? (
        missingTokenContent
      ) : success ? (
        <div className="stack">
          <div className="status-badge status-badge--success">{t('resetPassword.success')}</div>
          <p className="section-description">{t('resetPassword.successDescription')}</p>
          <Link to="/login">
            <Button variant="primary" fullWidth>
              {t('verify.login')}
            </Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="stack">
            <TextField
              label={t('resetPassword.password')}
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('resetPassword.passwordPlaceholder')}
              autoComplete="new-password"
              autoFocus
            />
            <TextField
              label={t('resetPassword.confirm')}
              type="password"
              name="confirmPassword"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={error || (confirm && confirm !== password ? t('resetPassword.mismatch') : undefined)}
              placeholder={t('resetPassword.confirmPlaceholder')}
              autoComplete="new-password"
            />
            <Button type="submit" fullWidth size="lg" loading={loading}>
              {t('resetPassword.submit')}
            </Button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
