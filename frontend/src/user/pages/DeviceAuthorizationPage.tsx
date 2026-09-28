import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AuthShell } from '@/user/components/AuthShell';
import { Button } from '@/shared/Button';
import { useI18n } from '@/i18n/I18nProvider';

type DeviceInfo = {
  success: boolean;
  user_code: string;
  client: { name: string; client_id: string; client_type: string; party_type: string };
  scopes: { name: string; description: string; sensitive?: boolean }[];
};

export function DeviceAuthorizationPage() {
  const { t } = useI18n();
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
    if (!normalized) { setError(t('device.codeRequired')); return; }
    setLoading(true); setError(''); setMessage(''); setDevice(null);
    try {
      const result = await api.get<DeviceInfo>(`/api/device/info?user_code=${encodeURIComponent(normalized)}`);
      setDevice(result); setUserCode(normalized);
    } catch {
      setError(t('device.codeFailed'));
    } finally { setLoading(false); }
  }

  async function decide(action: 'approve' | 'deny') {
    if (!device) return;
    setBusy(true); setError('');
    try {
      await api.post<{ success: boolean; message: string }>('/api/device/approve', { user_code: device.user_code, action });
      setMessage(action === 'approve' ? t('device.approveSuccess') : t('device.denied'));
      setDevice(null);
    } catch {
      setError(t('device.submitFailed'));
    } finally { setBusy(false); }
  }

  return (
    <AuthShell title={t('device.title')} description={t('device.description')} footer={<Link to="/login" className="inline-link">{t('device.switchAccount')}</Link>}>
      <div className="stack">
        {message ? <p className="status-badge status-badge--success" role="status">{message}</p> : null}
        {error ? <p className="status-badge status-badge--danger" role="alert">{error}</p> : null}
        {!device ? <>
          <label className="field"><span className="field__label">{t('device.userCode')}</span><input className="field__input device-code-input" aria-label={t('device.userCode')} value={userCode} onChange={event => setUserCode(event.target.value.toUpperCase())} placeholder={t('device.userCodePlaceholder')} autoComplete="one-time-code" /></label>
          {!authLoading && !user && userCode ? <p className="section-description">{t('device.returnAfterLogin')}</p> : null}
          <Button type="button" disabled={loading || authLoading || !user} onClick={() => void checkCode()}>{loading ? t('device.checking') : t('device.review')}</Button>
        </> : <>
          <section className="device-authorization-card">
            <span className="public-app-label">{device.client.party_type === 'first_party' ? t('device.firstParty') : t('device.thirdParty')}</span>
            <h2>{device.client.name}</h2>
            <p>{t('device.requests')}</p>
            <ul className="public-scope-list">{device.scopes.map(scope => <li key={scope.name}><div><strong>{scope.name}</strong>{scope.sensitive ? <span className="public-scope-sensitive">{t('device.sensitive')}</span> : null}<p>{scope.description}</p></div></li>)}</ul>
          </section>
          <div className="cluster cluster--end"><Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('deny')}>{t('device.deny')}</Button><Button type="button" disabled={busy} onClick={() => void decide('approve')}>{busy ? t('device.submitting') : t('device.allow')}</Button></div>
        </>}
      </div>
    </AuthShell>
  );
}
