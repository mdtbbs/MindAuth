import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

export function OAuthAuthorizePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || params.get('redirect') || '';
  const state = params.get('state') || '';
  const scope = params.get('scope') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const codeChallengeMethod = params.get('code_challenge_method') || '';
  const clientName = params.get('client_name') || '';
  const errorParam = params.get('error') || '';
  const messageParam = params.get('message') || '';

  const [error, setError] = useState(messageParam || errorParam ? messageParam || errorParam : '');

  useEffect(() => {
    if (user && !authLoading && clientId && redirectUri) {
      const oauthParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        ...(state && { state }),
        ...(scope && { scope }),
        ...(codeChallenge && { code_challenge: codeChallenge }),
        ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
      });
      window.location.href = `/api/authorize?${oauthParams.toString()}`;
    }
  }, [user, authLoading, clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod]);

  useEffect(() => {
    if (!authLoading && !user) {
      const loginParams = new URLSearchParams({
        ...(clientId && { client_id: clientId }),
        ...(redirectUri && { redirect_uri: redirectUri }),
        ...(state && { state }),
        ...(scope && { scope }),
        ...(codeChallenge && { code_challenge: codeChallenge }),
        ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
        ...(clientName && { client_name: clientName }),
      });
      navigate(`/login?${loginParams.toString()}`, { replace: true });
    }
  }, [user, authLoading, clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, clientName, navigate]);

  useEffect(() => {
    if (!clientId || !redirectUri) {
      setError('缺少必需的 OAuth 参数 (client_id, redirect_uri)');
    }
  }, [clientId, redirectUri]);

  return (
    <AuthShell
      title="应用授权"
      description={clientName ? `正在准备连接 ${clientName}。` : '正在准备应用授权请求。'}
      footer={
        <>
          <Link to="/login" className="inline-link">
            返回登录
          </Link>
          <span className="text-muted">/</span>
          <Link to="/register" className="inline-link">
            创建账户
          </Link>
        </>
      }
    >
      {error ? (
        <div className="stack">
          <div className="status-badge status-badge--danger">授权参数错误</div>
          <p className="section-description">{error}</p>
          <Button variant="primary" fullWidth onClick={() => navigate('/login')}>
            返回登录
          </Button>
        </div>
      ) : (
        <div className="stack">
          <div className="status-badge status-badge--info">
            {clientName ? `正在连接应用：${clientName}` : '正在处理授权请求'}
          </div>
          <p className="section-description">
            {authLoading
              ? '正在确认账户状态，请稍候。'
              : '授权请求会在登录确认后自动继续，无需重复输入参数。'}
          </p>
          <Button variant="secondary" fullWidth onClick={() => navigate('/login')}>
            取消并返回登录
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
