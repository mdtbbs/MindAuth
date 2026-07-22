import { useState, type FormEvent } from 'react';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';

interface AdminLoginPageProps {
  onLoginSuccess: () => void;
}

export function AdminLoginPage({ onLoginSuccess }: AdminLoginPageProps) {
  const { login, error: authError, clearError } = useAdminAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<'login' | 'create'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
      toast('success', '管理员登录成功');
      onLoginSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      setError(msg);
      toast('error', msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!secret.trim() || !username.trim() || !email.trim() || !password) {
      setError('所有字段必填');
      return;
    }

    setLoading(true);
    try {
      const { api } = await import('@/api/client');
      await api.post('/api/admin/create', {
        secret: secret.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
      });
      toast('success', '管理员账号创建成功，请登录');
      setMode('login');
      setPassword('');
      setEmail('');
      setSecret('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建失败';
      setError(msg);
      toast('error', msg);
    } finally {
      setLoading(false);
    }
  }

  const displayError = error || authError || '';

  return (
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>
          {mode === 'login' ? '管理员登录' : '创建管理员账号'}
        </CardTitle>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={{ marginTop: 'var(--space-4)' }}>
            <div className="stack">
              <TextField
                label="用户名"
                value={username}
                onChange={(e) => { setUsername(e.target.value); clearError(); }}
                error={displayError}
                placeholder="管理员用户名"
                autoComplete="username"
                autoFocus
              />
              <TextField
                label="密码"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearError(); }}
                placeholder="管理员密码"
                autoComplete="current-password"
              />
              <Button type="submit" fullWidth loading={loading}>
                登录
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreate} style={{ marginTop: 'var(--space-4)' }}>
            <div className="stack">
              <TextField
                label="创建密钥 (ADMIN_SECRET)"
                value={secret}
                onChange={(e) => { setSecret(e.target.value); clearError(); }}
                error={displayError}
                placeholder="服务器配置的 ADMIN_SECRET"
                type="password"
                autoFocus
              />
              <TextField
                label="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="新管理员用户名"
              />
              <TextField
                label="邮箱"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="管理员邮箱"
              />
              <TextField
                label="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码 (8+字符, 含大小写和数字)"
              />
              <Button type="submit" fullWidth loading={loading}>
                创建管理员
              </Button>
            </div>
          </form>
        )}

        <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode(mode === 'login' ? 'create' : 'login');
              setError('');
              clearError();
            }}
          >
            {mode === 'login' ? '创建管理员账号' : '返回登录'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
