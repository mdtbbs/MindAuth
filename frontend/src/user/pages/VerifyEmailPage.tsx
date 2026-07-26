import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '@/api/client';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

type Status = 'loading' | 'success' | 'error' | 'no-token';

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
        setMessage(res.message || '邮箱验证成功');
      })
      .catch((err: { message?: string }) => {
        setStatus('error');
        setMessage(err.message || '验证失败');
      });
  }, [token]);

  const statusClass =
    status === 'success'
      ? 'status-badge status-badge--success'
      : status === 'loading'
        ? 'status-badge status-badge--info'
        : 'status-badge status-badge--danger';

  const statusText =
    status === 'loading'
      ? '正在验证邮箱'
      : status === 'success'
        ? '邮箱验证成功'
        : status === 'no-token'
          ? '缺少验证令牌'
          : '邮箱验证失败';

  const description =
    status === 'success'
      ? message
      : status === 'loading'
        ? '请稍候，系统正在确认该验证链接的有效性。'
        : status === 'no-token'
          ? '请检查邮件中的验证链接是否完整。'
          : message;

  return (
    <AuthShell
      title="邮箱验证"
      description="验证状态会实时显示在当前页面。"
      eyebrow="账户验证"
      heroTitle="让您的账户联系信息保持可信。"
      heroDescription="完成邮箱验证后，账户恢复、通知送达和安全确认流程都会更加顺畅。"
      footer={
        <>
          <Link to="/dashboard" className="inline-link">
            前往 Dashboard
          </Link>
          <span className="text-muted">/</span>
          <Link to="/login" className="inline-link">
            返回登录
          </Link>
        </>
      }
    >
      <div className="stack">
        <div className={statusClass}>{statusText}</div>
        <p className="section-description">{description}</p>
        <Link to="/dashboard">
          <Button variant="primary" fullWidth>
            前往 Dashboard
          </Button>
        </Link>
      </div>
    </AuthShell>
  );
}
