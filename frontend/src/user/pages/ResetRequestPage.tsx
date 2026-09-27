import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/client';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';

export function ResetRequestPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('resetRequest.required'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post('/api/password/reset-request', { email: email.trim() });
      setSent(true);
    } catch {
      setError(t('resetRequest.failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={t('resetRequest.title')}
      description={t('resetRequest.description')}
      footer={
        <Link to="/login" className="inline-link">
          {t('verify.login')}
        </Link>
      }
    >
      {sent ? (
        <div className="stack">
          <div className="status-badge status-badge--success">{t('resetRequest.sent')}</div>
          <p className="section-description">
            {t('resetRequest.sentDescription')}
          </p>
          <Link to="/login">
            <Button variant="primary" fullWidth>
              {t('verify.login')}
            </Button>
          </Link>
        </div>
      ) : (
        <form id="reset-request-form" onSubmit={handleSubmit}>
          <div className="stack">
            <TextField
              label={t('resetRequest.email')}
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
              placeholder={t('resetRequest.emailPlaceholder')}
              autoComplete="email"
              autoFocus
            />
            <Button type="submit" fullWidth size="lg" loading={loading}>
              {t('resetRequest.submit')}
            </Button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
