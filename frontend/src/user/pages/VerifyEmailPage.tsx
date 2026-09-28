import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';

type Status = 'loading' | 'success' | 'error' | 'no-token';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { loadCurrentUser } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const { t } = useI18n();

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }

    api
      .post<{ success: boolean; message: string }>('/api/email-verification/verify', { token })
      .then(async (res) => {
        if (!res.success) throw new Error('verify-failed');
        setStatus('success');
        await loadCurrentUser();
      })
      .catch(() => {
        setStatus('error');
      });
  }, [token, loadCurrentUser]);

  const statusClass =
    status === 'success'
      ? 'status-badge status-badge--success'
      : status === 'loading'
        ? 'status-badge status-badge--info'
        : 'status-badge status-badge--danger';

  const statusText = status === 'loading' ? t('verify.loading')
    : status === 'success' ? t('verify.success')
      : status === 'no-token' ? t('verify.noToken') : t('verify.failed');

  const description =
    status === 'loading' ? t('verify.loadingDescription')
      : status === 'no-token' ? t('verify.noTokenDescription')
        : status === 'success' ? t('verify.success') : t('verify.failed');

  return (
    <AuthShell
      title={t('verify.title')}
      description={t('verify.description')}
      footer={
        <>
          <Link to="/dashboard" className="inline-link">
            {t('verify.dashboard')}
          </Link>
          <span className="text-muted">/</span>
          <Link to="/login" className="inline-link">
            {t('verify.login')}
          </Link>
        </>
      }
    >
      <div className="stack">
        <div className={statusClass}>{statusText}</div>
        <p className="section-description">{description}</p>
        <Link to={status === 'success' ? '/dashboard' : '/login'}>
          <Button variant="primary" fullWidth>
            {status === 'success' ? t('verify.dashboard') : t('verify.login')}
          </Button>
        </Link>
      </div>
    </AuthShell>
  );
}
