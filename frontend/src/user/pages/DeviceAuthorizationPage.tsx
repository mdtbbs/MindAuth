import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/user/components/AuthShell';
import { Button } from '@/shared/Button';

type DeviceInfo = {
  success: boolean;
  user_code: string;
  client: { name: string; client_id: string; client_type: string; party_type: string };
  scopes: { name: string; description: string; sensitive?: boolean }[];
};

export function DeviceAuthorizationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [userCode, setUserCode] = useState((params.get('user_code') || '').toUpperCase());
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading && !user && userCode) {
      navigate(`/login?device_user_code=${encodeURIComponent(userCode)}`, { replace: true });
    }
  }, [authLoading, user, userCode, navigate]);

  async function checkCode() {
    const normalized = userCode.trim().toUpperCase();
    if (!normalized) { setError('请输入设备上显示的用户码。'); return; }
    setLoading(true); setError(''); setMessage(''); setDevice(null);
    try {
      const result = await api.get<DeviceInfo>(`/api/device/info?user_code=${encodeURIComponent(normalized)}`);
      setDevice(result); setUserCode(normalized);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '无法读取设备授权请求。');
    } finally { setLoading(false); }
  }

  async function decide(action: 'approve' | 'deny') {
    if (!device) return;
    setBusy(true); setError('');
    try {
      const result = await api.post<{ success: boolean; message: string }>('/api/device/approve', { user_code: device.user_code, action });
      setMessage(result.message || (action === 'approve' ? '授权成功。请返回设备继续。' : '已拒绝此授权请求。'));
      setDevice(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '提交设备授权失败。');
    } finally { setBusy(false); }
  }

  return (
    <AuthShell title="设备授权" description="确认这台设备和它请求的账户权限。" footer={<Link to="/login" className="inline-link">切换 MDTBBS 账号</Link>}>
      <div className="stack">
        {message ? <p className="status-badge status-badge--success" role="status">{message}</p> : null}
        {error ? <p className="status-badge status-badge--danger" role="alert">{error}</p> : null}
        {!device ? <>
          <label className="field"><span className="field__label">设备用户码</span><input className="field__input device-code-input" value={userCode} onChange={event => setUserCode(event.target.value.toUpperCase())} placeholder="例如 LL-ABCD-EFGH" autoComplete="one-time-code" /></label>
          {!authLoading && !user && userCode ? <p className="section-description">登录后会返回此授权请求。</p> : null}
          <Button type="button" disabled={loading || authLoading || !user} onClick={() => void checkCode()}>{loading ? '正在验证…' : '查看授权请求'}</Button>
        </> : <>
          <section className="device-authorization-card">
            <span className="public-app-label">{device.client.party_type === 'first_party' ? 'MDTBBS 官方应用' : '第三方应用'}</span>
            <h2>{device.client.name}</h2>
            <p>此应用请求登录 MDTBBS 并访问以下权限：</p>
            <ul className="public-scope-list">{device.scopes.map(scope => <li key={scope.name}><div><strong>{scope.name}</strong>{scope.sensitive ? <span className="public-scope-sensitive">敏感权限</span> : null}<p>{scope.description}</p></div></li>)}</ul>
          </section>
          <div className="cluster cluster--end"><Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('deny')}>拒绝</Button><Button type="button" disabled={busy} onClick={() => void decide('approve')}>{busy ? '提交中…' : '允许'}</Button></div>
        </>}
      </div>
    </AuthShell>
  );
}
