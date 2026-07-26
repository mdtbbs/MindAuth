import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/client';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

export function ResetRequestPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError('请输入邮箱地址');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post('/api/password/reset-request', { email: email.trim() });
      setSent(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="找回密码"
      description="输入您注册时使用的邮箱，我们会发送重置链接。"
      eyebrow="账户恢复"
      heroTitle="快速恢复账户访问权限。"
      heroDescription="重置流程不会改变现有账户数据，仅用于重新设置登录密码。请优先使用您已验证的邮箱地址。"
      footer={
        <Link to="/login" className="inline-link">
          返回登录
        </Link>
      }
    >
      {sent ? (
        <div className="stack">
          <div className="status-badge status-badge--success">重置邮件已发送</div>
          <p className="section-description">
            如果邮箱地址有效，您将很快收到重置链接。完成后可返回登录页继续访问。
          </p>
          <Link to="/login">
            <Button variant="primary" fullWidth>
              返回登录
            </Button>
          </Link>
        </div>
      ) : (
        <form id="reset-request-form" onSubmit={handleSubmit}>
          <div className="stack">
            <TextField
              label="邮箱"
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error}
              placeholder="请输入注册邮箱"
              autoComplete="email"
              autoFocus
            />
            <Button type="submit" fullWidth size="lg" loading={loading}>
              发送重置链接
            </Button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
