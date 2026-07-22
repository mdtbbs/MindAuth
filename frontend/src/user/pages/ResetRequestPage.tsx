import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/client';
import { Card, CardTitle } from '@/shared/Card';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';

/**
 * Password reset request page.
 * User enters their email to receive a reset link.
 */
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
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>重置密码</CardTitle>

        {sent ? (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p style={{ color: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>
              重置链接已发送到您的邮箱，请查收。
            </p>
            <Link to="/login">
              <Button variant="primary">返回登录</Button>
            </Link>
          </div>
        ) : (
          <form id="reset-request-form" onSubmit={handleSubmit} style={{ marginTop: 'var(--space-4)' }}>
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
              />
              <Button type="submit" fullWidth loading={loading}>
                发送重置链接
              </Button>
            </div>
          </form>
        )}

        <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>
            返回登录
          </Link>
        </div>
      </Card>
    </div>
  );
}
