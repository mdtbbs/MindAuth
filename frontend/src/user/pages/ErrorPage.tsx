import { Link } from 'react-router-dom';
import { Card, CardTitle } from '@/shared/Card';
import { Button } from '@/shared/Button';

interface ErrorPageProps {
  status?: number;
  title?: string;
  message?: string;
}

/**
 * Generic error page shown for 404s and unexpected errors.
 */
export function ErrorPage({ status = 404, title, message }: ErrorPageProps) {
  const defaultTitle = status === 404 ? 'Page Not Found' : 'Error';
  const defaultMessage =
    status === 404
      ? 'The page you are looking for does not exist.'
      : 'Something went wrong. Please try again later.';

  return (
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>{title ?? defaultTitle}</CardTitle>
        <p style={{ color: 'var(--color-text-secondary)', marginBlock: 'var(--space-4)' }}>
          {message ?? defaultMessage}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
          <Link to="/login">
            <Button variant="primary">Go to Login</Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="secondary">Dashboard</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
