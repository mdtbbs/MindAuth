import { useState, useEffect, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';

/**
 * Login page with OAuth redirect preservation.
 *
 * When accessed with OAuth query params (redirect_uri, client_id, etc.),
 * the page shows the client name and redirects back to /api/authorize
 * after successful login.
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login, user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const redirectUri = params.get('redirect_uri') || '';
  const clientId = params.get('client_id') || '';
  const clientName = params.get('client_name') || '';
  const state = params.get('state') || '';
  const scope = params.get('scope') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const codeChallengeMethod = params.get('code_challenge_method') || '';

  const isOAuthFlow = Boolean(redirectUri && clientId);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect to dashboard if already logged in (and not in OAuth flow)
  useEffect(() => {
    if (user && !authLoading) {
      if (isOAuthFlow) {
        // Redirect to OAuth authorize endpoint
        const oauthParams = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          ...(state && { state }),
          ...(scope && { scope }),
          ...(codeChallenge && { code_challenge: codeChallenge }),
          ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
        });
        window.location.href = `/api/authorize?${oauthParams.toString()}`;
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, authLoading, isOAuthFlow, clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
      toast('success', '登录成功');

      if (isOAuthFlow) {
        // After login, navigate to authorize endpoint
        const oauthParams = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          ...(state && { state }),
          ...(scope && { scope }),
          ...(codeChallenge && { code_challenge: codeChallenge }),
          ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
        });
        window.location.href = `/api/authorize?${oauthParams.toString()}`;
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      setError(msg);
      toast('error', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>
          {isOAuthFlow && clientName
            ? `登录到 ${decodeURIComponent(clientName)}`
            : '登录 MindAuth'}
        </CardTitle>

        <form
          id="login-form"
          onSubmit={handleSubmit}
          style={{ marginTop: 'var(--space-4)' }}
          data-testid="login-form"
        >
          <div className="stack">
            <TextField
              id="username"
              label="用户名"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={error}
              placeholder="请输入用户名"
              autoComplete="username"
              autoFocus
            />
            <TextField
              id="password"
              label="密码"
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
            <Button type="submit" fullWidth loading={loading} data-testid="login-submit">
              登录
            </Button>
          </div>
        </form>

        <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
          <Link to="/register" style={{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>
            没有账号？注册
          </Link>
          <span style={{ margin: '0 var(--space-2)', color: 'var(--color-text-muted)' }}>|</span>
          <Link to="/reset-request" style={{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>
            忘记密码？
          </Link>
        </div>
      </Card>
    </div>
  );
}
