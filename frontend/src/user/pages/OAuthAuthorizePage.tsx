import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Card, CardTitle } from '@/shared/Card';
import { Button } from '@/shared/Button';

/**
 * OAuth authorization/consent page.
 *
 * Currently, MindAuth auto-authorizes after login (no consent step).
 * This page is a placeholder for future consent flows and handles
 * error states when OAuth params are invalid.
 *
 * If the user is logged in, they are automatically redirected to the
 * authorize endpoint which generates the code and redirects back.
 */
export function OAuthAuthorizePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const state = params.get('state') || '';
  const scope = params.get('scope') || '';

  const [error, setError] = useState('');

  // If logged in, auto-authorize by hitting the authorize endpoint
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

  // If not logged in, redirect to login
  useEffect(() => {
    if (!authLoading && !user) {
      const loginParams = new URLSearchParams({
        ...(clientId && { client_id: clientId }),
        ...(redirectUri && { redirect_uri: redirectUri }),
        ...(state && { state }),
        ...(scope && { scope }),
      });
      navigate(`/login?${loginParams.toString()}`, { replace: true });
    }
  }, [user, authLoading, clientId, redirectUri, state, scope, navigate]);

  // Validate required params
  useEffect(() => {
    if (!clientId || !redirectUri) {
      setError('缺少必需的 OAuth 参数 (client_id, redirect_uri)');
    }
  }, [clientId, redirectUri]);

  if (error) {
    return (
      <div className="page--auth">
        <Card padding="lg">
          <CardTitle>授权错误</CardTitle>
          <p style={{ color: 'var(--color-error)', marginBlock: 'var(--space-4)' }}>
            {error}
          </p>
          <Button variant="primary" onClick={() => navigate('/login')}>
            返回登录
          </Button>
        </Card>
      </div>
    );
  }

  // Loading while auto-redirect happens
  return (
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>授权中...</CardTitle>
        <p style={{ color: 'var(--color-text-secondary)', marginBlock: 'var(--space-4)' }}>
          正在处理授权请求...
        </p>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" onClick={() => navigate('/login')}>
            取消
          </Button>
        </div>
      </Card>
    </div>
  );
}
