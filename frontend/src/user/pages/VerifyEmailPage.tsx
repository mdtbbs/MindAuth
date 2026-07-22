import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '@/api/client';
import { Card, CardTitle } from '@/shared/Card';
import { Button } from '@/shared/Button';

type Status = 'loading' | 'success' | 'error' | 'no-token';

/**
 * Email verification page.
 * Visited via link in verification email: /verify-email?token=xxx
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }

    api
      .post<{ success: boolean; message: string }>('/api/email-verification/verify', { token })
      .then((res) => {
        setStatus('success');
        setMessage(res.message || '邮箱验证成功！');
      })
      .catch((err: { message?: string }) => {
        setStatus('error');
        setMessage(err.message || '验证失败');
      });
  }, [token]);

  return (
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>
          {status === 'loading' ? '验证中...' : status === 'success' ? '邮箱验证成功' : '邮箱验证'}
        </CardTitle>

        {status === 'loading' && (
          <p style={{ color: 'var(--color-text-secondary)', marginBlock: 'var(--space-4)' }}>
            正在验证邮箱...
          </p>
        )}

        {status === 'no-token' && (
          <p style={{ color: 'var(--color-error)', marginBlock: 'var(--space-4)' }}>
            缺少验证令牌。请检查您的邮件中的验证链接。
          </p>
        )}

        {status === 'success' && (
          <p style={{ color: 'var(--color-success)', marginBlock: 'var(--space-4)' }}>
            {message}
          </p>
        )}

        {status === 'error' && (
          <p style={{ color: 'var(--color-error)', marginBlock: 'var(--space-4)' }}>
            {message}
          </p>
        )}

        <div style={{ marginTop: 'var(--space-6)' }}>
          <Link to="/dashboard">
            <Button variant="primary">前往 Dashboard</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
