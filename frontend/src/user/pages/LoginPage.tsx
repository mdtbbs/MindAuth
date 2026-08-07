import { useState, useEffect, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login, user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const redirectUri = params.get('redirect_uri') || params.get('redirect') || '';
  const clientId = params.get('client_id') || '';
  const clientName = params.get('client_name') || '';
  const state = params.get('state') || '';
  const scope = params.get('scope') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const codeChallengeMethod = params.get('code_challenge_method') || '';
  const errorParam = params.get('error') || '';
  const messageParam = params.get('message') || '';

  const isOAuthFlow = Boolean(redirectUri && clientId);

  function buildAuthorizeParams() {
    return new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      ...(state && { state }),
      ...(scope && { scope }),
      ...(codeChallenge && { code_challenge: codeChallenge }),
      ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
    });
  }

  function buildAuthFlowParams() {
    return new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      ...(clientName && { client_name: clientName }),
      ...(state && { state }),
      ...(scope && { scope }),
      ...(codeChallenge && { code_challenge: codeChallenge }),
      ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
    });
  }

  const authFlowQuery = isOAuthFlow ? buildAuthFlowParams().toString() : '';
  const registerHref = authFlowQuery ? `/register?${authFlowQuery}` : '/register';
  const qqLoginHref = `/api/auth/qq${authFlowQuery ? `?${authFlowQuery}` : ''}`;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && !authLoading) {
      if (isOAuthFlow) {
        window.location.href = `/api/authorize?${buildAuthorizeParams().toString()}`;
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, authLoading, isOAuthFlow, clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!username.trim() || !password) {
      setFormError('请输入用户名/邮箱和密码');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
      toast('success', '登录成功');

      if (isOAuthFlow) {
        window.location.href = `/api/authorize?${buildAuthorizeParams().toString()}`;
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      setFormError(msg);
      toast('error', msg);
    } finally {
      setLoading(false);
    }
  }

  const title = isOAuthFlow && clientName ? `登录 ${clientName}` : '登录 MindAuth';
  const description = isOAuthFlow
    ? `继续后将返回 ${clientName || '目标应用'} 完成授权。`
    : '使用您的 MindAuth 账户访问控制台、账户中心与授权应用。';

  return (
    <AuthShell
      title={title}
      description={description}
      footer={
        <>
          <Link to={registerHref} className="inline-link">
            没有账号？注册
          </Link>
          <span className="text-muted">/</span>
          <Link to="/reset-request" className="inline-link">
            忘记密码
          </Link>
        </>
      }
    >
      <form id="login-form" onSubmit={handleSubmit} data-testid="login-form">
        <div className="stack">
          {isOAuthFlow && clientName ? (
            <div className="status-badge status-badge--info">正在连接应用：{clientName}</div>
          ) : null}
          {formError || errorParam || messageParam ? (
            <div className="auth-form__alert" role="alert">
              <div className="status-badge status-badge--danger">登录失败</div>
              <p className="section-description auth-form__alert-text">{formError || messageParam || errorParam}</p>
            </div>
          ) : null}
          <TextField
            id="username"
            label="用户名或邮箱"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名或邮箱"
            hint="请输入您的 MindAuth 用户名或邮箱"
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
          <Button type="submit" fullWidth size="lg" loading={loading} data-testid="login-submit">
            登录
          </Button>
          <div className="auth-divider" aria-hidden="true"><span>或</span></div>
          <a className="btn btn--secondary btn--lg btn--full" href={qqLoginHref} data-testid="qq-login">
            <span aria-hidden="true" style={{ fontWeight: 700 }}>Q</span> 使用 QQ 登录
          </a>
        </div>
      </form>
    </AuthShell>
  );
}
