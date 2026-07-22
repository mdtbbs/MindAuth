import { useState, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '@/api/client';
import { Card, CardTitle } from '@/shared/Card';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';

/**
 * Password reset page with token from email link.
 * Visited via: /reset-password?token=xxx
 */
export function ResetPasswordPage() {
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
      setError('密码至少需要8个字符');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post('/api/password/reset', { token, password });
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '重置失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="page--auth">
        <Card padding="lg">
          <CardTitle>重置密码</CardTitle>
          <p style={{ color: 'var(--color-error)', marginBlock: 'var(--space-4)' }}>
            缺少重置令牌。请检查您的邮件中的重置链接。
          </p>
          <Link to="/reset-request">
            <Button variant="primary">重新请求</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>设置新密码</CardTitle>

        {success ? (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p style={{ color: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>
              密码已重置成功！
            </p>
            <Link to="/login">
              <Button variant="primary">前往登录</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 'var(--space-4)' }}>
            <div className="stack">
              <TextField
                label="新密码"
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少8个字符"
                autoComplete="new-password"
              />
              <TextField
                label="确认新密码"
                type="password"
                name="confirmPassword"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={error}
                placeholder="再次输入新密码"
                autoComplete="new-password"
              />
              <Button type="submit" fullWidth loading={loading}>
                重置密码
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
