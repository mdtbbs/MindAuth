import { useState, type FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '@/api/client';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

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
      setError('密码至少需要 8 个字符');
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

  const missingTokenContent = (
    <div className="stack">
      <div className="status-badge status-badge--danger">缺少重置令牌</div>
      <p className="section-description">请重新打开邮件中的完整链接，或重新申请密码重置。</p>
      <Link to="/reset-request">
        <Button variant="primary" fullWidth>
          重新申请重置
        </Button>
      </Link>
    </div>
  );

  return (
    <AuthShell
      title="设置新密码"
      description="为您的 MindAuth 账户设置一个新的登录密码。"
      eyebrow="密码重置"
      heroTitle="重设密码，同时保留原有账户与授权数据。"
      heroDescription="完成重置后，您可以继续使用原账户查看账户中心、通知、安全设置和 OAuth 授权记录。"
      footer={
        <Link to="/login" className="inline-link">
          返回登录
        </Link>
      }
    >
      {!token ? (
        missingTokenContent
      ) : success ? (
        <div className="stack">
          <div className="status-badge status-badge--success">密码已重置成功</div>
          <p className="section-description">新密码已生效，您现在可以返回登录页继续访问账户中心。</p>
          <Link to="/login">
            <Button variant="primary" fullWidth>
              前往登录
            </Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="stack">
            <TextField
              label="新密码"
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 个字符"
              autoComplete="new-password"
              autoFocus
            />
            <TextField
              label="确认新密码"
              type="password"
              name="confirmPassword"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={error || (confirm && confirm !== password ? '两次输入的密码不一致' : undefined)}
              placeholder="再次输入新密码"
              autoComplete="new-password"
            />
            <Button type="submit" fullWidth size="lg" loading={loading}>
              重置密码
            </Button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
