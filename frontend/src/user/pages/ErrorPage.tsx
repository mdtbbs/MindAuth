import { Link } from 'react-router-dom';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import { useI18n } from '@/i18n/I18nProvider';

interface ErrorPageProps {
  status?: number;
  title?: string;
  message?: string;
}

export function ErrorPage({ status = 404, title, message }: ErrorPageProps) {
  const { t } = useI18n();
  const defaultTitle = status === 404 ? t('error.notFoundTitle') : t('error.pageTitle');
  const defaultMessage =
    status === 404
      ? t('error.notFoundMessage')
      : t('error.genericMessage');

  return (
    <AuthShell
      title={title ?? defaultTitle}
      description={t('error.description')}
      footer={
        <>
          <Link to="/login" className="inline-link">
            {t('error.login')}
          </Link>
          <span className="text-muted">/</span>
          <Link to="/dashboard" className="inline-link">
            {t('error.dashboard')}
          </Link>
        </>
      }
    >
      <div className="stack">
        <div className={status === 404 ? 'status-badge status-badge--warning' : 'status-badge status-badge--danger'}>
          HTTP {status}
        </div>
        <p className="section-description">{message ?? defaultMessage}</p>
        <div className="cluster">
          <Link to="/login">
            <Button variant="primary">{t('error.login')}</Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="secondary">{t('error.dashboard')}</Button>
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
