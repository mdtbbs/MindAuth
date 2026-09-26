import { useState, useEffect, useMemo, type FormEvent } from 'react';
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
  const deviceUserCode = params.get('device_user_code') || '';
  const errorParam = params.get('error') || '';
  const messageParam = params.get('message') || '';

  const isOAuthFlow = Boolean(redirectUri && clientId);

  const authorizeParams = useMemo(() => new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      ...(state && { state }),
      ...(scope && { scope }),
      ...(codeChallenge && { code_challenge: codeChallenge }),
      ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
    }), [clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod]);

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
  const [loginMethod, setLoginMethod] = useState<'password' | 'qq'>('password');

  useEffect(() => {
    if (user && !authLoading) {
      if (deviceUserCode) {
        navigate(`/device?user_code=${encodeURIComponent(deviceUserCode)}`, { replace: true });
      } else if (isOAuthFlow) {
        window.location.href = `/api/authorize?${authorizeParams.toString()}`;
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [user, authLoading, isOAuthFlow, authorizeParams, deviceUserCode, navigate]);

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

      if (deviceUserCode) {
        navigate(`/device?user_code=${encodeURIComponent(deviceUserCode)}`, { replace: true });
      } else if (isOAuthFlow) {
        window.location.href = `/api/authorize?${authorizeParams.toString()}`;
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

  const title = isOAuthFlow && clientName ? `登录 ${clientName}` : '登录';
  const description = isOAuthFlow
    ? `继续后将返回 ${clientName || '目标应用'} 完成授权。`
    : '使用 MDTBBS 账号访问论坛与相关服务。';

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
          <div className="auth-method-tabs" role="tablist" aria-label="选择登录方式">
            <button
              id="password-login-tab"
              type="button"
              role="tab"
              aria-selected={loginMethod === 'password'}
              aria-controls="login-method-panel"
              className="auth-method-tab"
              onClick={() => setLoginMethod('password')}
            >
              账号密码
            </button>
            <button
              id="qq-login-tab"
              type="button"
              role="tab"
              aria-selected={loginMethod === 'qq'}
              aria-controls="login-method-panel"
              className="auth-method-tab"
              onClick={() => setLoginMethod('qq')}
            >
              QQ 登录
            </button>
          </div>

          <div id="login-method-panel" role="tabpanel" aria-labelledby={`${loginMethod}-login-tab`}>
            {isOAuthFlow && clientName ? (
              <div className="status-badge status-badge--info auth-login__context">正在连接应用：{clientName}</div>
            ) : null}
            {formError || errorParam || messageParam ? (
              <div className="auth-form__alert" role="alert">
                <div className="status-badge status-badge--danger">登录失败</div>
                <p className="section-description auth-form__alert-text">{formError || messageParam || errorParam}</p>
              </div>
            ) : null}

            {loginMethod === 'password' ? (
              <div className="stack auth-method-panel">
                <TextField
                  id="username"
                  label="用户名或邮箱"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名或邮箱"
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
              </div>
            ) : (
              <div className="auth-method-panel auth-method-panel--qq">
                <p>使用已绑定的 QQ 账号登录 MDTBBS。</p>
                <a className="btn btn--primary btn--lg btn--full" href={qqLoginHref} data-testid="qq-login">
                  使用 QQ 登录
                </a>
              </div>
            )}
          </div>
        </div>
      </form>
    </AuthShell>
  );
}
