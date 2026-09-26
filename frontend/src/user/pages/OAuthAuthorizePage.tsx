import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import api from '@/api/client';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

type ScopeInfo = { name: string; description: string };
type ConsentInfo = {
  success: boolean;
  consent_required: boolean;
  client: { client_id: string; name: string; description: string | null; website_url: string | null; client_type: string; party_type: string };
  scopes: ScopeInfo[];
  previous_scopes: string[];
};

export function OAuthAuthorizePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const request = useMemo(() => ({
    client_id: params.get('client_id') || '',
    redirect_uri: params.get('redirect_uri') || params.get('redirect') || '',
    state: params.get('state') || '',
    scope: params.get('scope') || '',
    response_type: params.get('response_type') || 'code',
    code_challenge: params.get('code_challenge') || '',
    code_challenge_method: params.get('code_challenge_method') || '',
  }), [params]);
  const query = useMemo(() => {
    const value = new URLSearchParams();
    Object.entries(request).forEach(([key, item]) => { if (item) value.set(key, item); });
    return value;
  }, [request]);

  const [consent, setConsent] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!request.client_id || !request.redirect_uri) {
      setError('授权请求缺少 client_id 或 redirect_uri。');
      return;
    }
    if (!user) {
      navigate(`/login?${query.toString()}`, { replace: true });
      return;
    }
    let active = true;
    api.get<ConsentInfo>(`/api/authorize/consent-info?${query.toString()}`)
      .then((data) => {
        if (!active) return;
        setConsent(data);
        if (!data.consent_required) window.location.assign(`/api/authorize?${query.toString()}`);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法读取授权请求。');
      });
    return () => { active = false; };
  }, [authLoading, user, request.client_id, request.redirect_uri, query, navigate]);

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true);
    setError('');
    try {
      const response = await api.post<{ success: boolean; redirect_to: string }>('/api/authorize/consent', {
        ...request,
        decision,
      });
      window.location.assign(response.redirect_to);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '提交授权决定失败。');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="应用授权"
      description={consent?.client ? `${consent.client.name} 请求访问你的 MDTBBS 账户。` : '确认应用请求的账户权限。'}
      footer={<Link to="/authorizations" className="inline-link">管理已授权应用</Link>}
    >
      {error ? <div className="status-badge status-badge--danger" role="alert">{error}</div> : null}
      {!consent ? (
        <p className="section-description">正在验证应用和权限请求…</p>
      ) : (
        <div className="stack">
          <section className="developer-panel" aria-label="应用信息">
            <strong>{consent.client.name}</strong>
            <p>Client ID：<code>{consent.client.client_id}</code></p>
            <p>{consent.client.description || '此应用将通过 MDTBBS Public Client API 访问服务。'}</p>
            {consent.client.website_url ? <a href={consent.client.website_url} target="_blank" rel="noreferrer">应用主页</a> : null}
          </section>
          <div>
            <h2 className="section-title">请求的权限</h2>
            <ul className="account-list">
              {consent.scopes.map((scope) => (
                <li className="authorization-item" key={scope.name}>
                  <strong>{scope.name}</strong>
                  <p>{scope.description}</p>
                </li>
              ))}
            </ul>
            <p className="section-description">授权后可在“授权应用”页面随时撤销。论坛的封禁、手机号验证、内容审核和站点规则仍然适用。</p>
          </div>
          <div className="cluster cluster--end">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('deny')}>拒绝</Button>
            <Button type="button" disabled={busy} onClick={() => void decide('approve')}>{busy ? '提交中…' : '同意并继续'}</Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
