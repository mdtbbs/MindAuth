import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import api, { ApiError } from '@/api/client';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

type ScopeInfo = { name: string; description: string; sensitive?: boolean };
type ConsentInfo = {
  success: boolean;
  consent_required: boolean;
  client: {
    client_id: string; name: string; description: string | null; website_url: string | null;
    client_type: string; party_type: string; developer_name: string | null;
    developer_url: string | null; owner_user_id: number | null;
  };
  scopes: ScopeInfo[];
  new_scopes: ScopeInfo[];
  previous_scopes: string[];
};

const SCOPE_ICONS: Record<string, string> = {
  openid: '◉', profile: '👤', email: '✉️', 'forum.read': '💬', 'forum.write': '✍️',
  'resource.read': '🗂️', 'resource.download': '⬇️', 'resource.upload': '⬆️',
  'notification.read': '🔔', 'message.read': '📨', 'message.write': '✉️',
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
      setError('这个应用的登录配置有问题，请联系开发者。');
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
        if (!active) return;
        setError(reason instanceof ApiError && reason.status && reason.status < 500
          ? '这个应用的登录配置有问题，请联系开发者。'
          : '暂时无法验证这个授权请求，请稍后重试。');
      });
    return () => { active = false; };
  }, [authLoading, user, request.client_id, request.redirect_uri, query, navigate]);

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true); setError('');
    try {
      const response = await api.post<{ success: boolean; redirect_to: string }>('/api/authorize/consent', { ...request, decision });
      window.location.assign(response.redirect_to);
    } catch (reason: unknown) {
      setError(reason instanceof ApiError && reason.status && reason.status < 500
        ? '这个应用的登录配置有问题，请联系开发者。'
        : '提交授权决定失败，请稍后重试。');
      setBusy(false);
    }
  }

  const scopesToShow = consent?.new_scopes?.length ? consent.new_scopes : consent?.scopes || [];
  const redirectHost = (() => { try { return new URL(request.redirect_uri).host || new URL(request.redirect_uri).protocol.slice(0, -1); } catch { return '已登记的回调地址'; } })();
  const official = consent?.client.party_type === 'first_party';
  const developerProfileUrl = consent?.client.developer_url || null;
  const initials = Array.from(consent?.client.name?.trim() || 'A')[0].toUpperCase();

  return (
    <AuthShell title="确认应用授权" description="请确认应用的身份和它申请的权限。">
      {error ? <div className="status-badge status-badge--danger" role="alert">{error}</div> : null}
      {!consent ? <p className="section-description">正在验证授权请求…</p> : (
        <div className="stack oauth-consent">
          <header className="oauth-consent__app">
            <div className="public-app-avatar">{initials}</div>
            <div><h2>{consent.client.name}</h2><span className={`public-app-label ${official ? 'public-app-label--official' : ''}`}>{official ? 'MDTBBS 官方应用' : '第三方应用'}</span></div>
          </header>
          <p className="oauth-consent__developer">{consent.client.developer_name ? <>由 {developerProfileUrl ? <a href={developerProfileUrl} target="_blank" rel="noreferrer">{consent.client.developer_name}</a> : consent.client.developer_name} 开发</> : '由 MDTBBS 官方团队提供'}</p>
          <p>{consent.client.description || '此应用将通过 MDTBBS 账号安全登录并使用社区 API。'}</p>

          <section className="oauth-consent__permissions">
            <h2>{consent.previous_scopes.length ? '此应用新增请求以下权限' : '此应用请求以下权限'}</h2>
            <ul className="public-scope-list">
              {scopesToShow.map((scope) => (
                <li key={scope.name}>
                  <span className="oauth-scope-icon" aria-hidden="true">{SCOPE_ICONS[scope.name] || '•'}</span>
                  <div><strong>{scope.name}</strong>{scope.sensitive ? <span className="public-scope-sensitive">敏感权限</span> : null}<p>{scope.description}</p><small>{scope.name}</small></div>
                </li>
              ))}
            </ul>
            {consent.previous_scopes.length ? <p className="section-description">你之前已经允许过部分权限；确认后会将本次请求的权限加入此应用授权。</p> : null}
          </section>

          <details className="oauth-consent__details">
            <summary>应用详情</summary>
            <dl><div><dt>Client ID</dt><dd><code>{consent.client.client_id}</code></dd></div><div><dt>Redirect Host</dt><dd>{redirectHost}</dd></div>
              {consent.client.website_url ? <div><dt>应用主页</dt><dd><a href={consent.client.website_url} target="_blank" rel="noreferrer">{consent.client.website_url}</a></dd></div> : null}
              {consent.client.developer_name ? <div><dt>开发者</dt><dd>{consent.client.developer_name}</dd></div> : null}
            </dl>
          </details>
          <p className="section-description">你可以随时在 MindAuth 的已授权应用中撤销访问。论坛的账号状态、内容审核和站点规则仍然适用。</p>
          <div className="oauth-consent__actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('deny')}>取消</Button>
            <Button type="button" disabled={busy} onClick={() => void decide('approve')}>{busy ? '提交中…' : '允许'}</Button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
