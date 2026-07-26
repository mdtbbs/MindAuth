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
  const redirectUri = params.get('redirect_uri') || '';
  const state = params.get('state') || '';
  const scope = params.get('scope') || '';
  const clientName = params.get('client_name') || '';
  const decodedClientName = clientName ? decodeURIComponent(clientName) : '';

  const [error, setError] = useState('');

  useEffect(() => {
    if (user && !authLoading && clientId && redirectUri) {
      const oauthParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        ...(state && { state }),
        ...(scope && { scope }),
      });
      window.location.href = `/api/authorize?${oauthParams.toString()}`;
    }
  }, [user, authLoading, clientId, redirectUri, state, scope]);

  useEffect(() => {
    if (!authLoading && !user) {
      const loginParams = new URLSearchParams({
        ...(clientId && { client_id: clientId }),
        ...(redirectUri && { redirect_uri: redirectUri }),
        ...(state && { state }),
        ...(scope && { scope }),
        ...(clientName && { client_name: clientName }),
      });
      navigate(`/login?${loginParams.toString()}`, { replace: true });
    }
  }, [user, authLoading, clientId, redirectUri, state, scope, clientName, navigate]);

  useEffect(() => {
    if (!clientId || !redirectUri) {
      setError('缺少必需的 OAuth 参数 (client_id, redirect_uri)');
    }
  }, [clientId, redirectUri]);

  return (
    <AuthShell
      title="应用授权"
      description={decodedClientName ? `正在准备连接 ${decodedClientName}。` : '正在准备应用授权请求。'}
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
            {decodedClientName ? `正在连接应用：${decodedClientName}` : '正在处理授权请求'}
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
