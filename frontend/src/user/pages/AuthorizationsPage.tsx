import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import api from '@/api/client';
import type { Authorization } from '@/api/types';
import { useResource } from '@/api/useResource';
import { useToast } from '@/shared/ToastProvider';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
import {
  AccountEmptyState,
  AccountLoadState,
  AccountSection,
  formatAccountDate,
} from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';
import { useI18n } from '@/i18n/I18nProvider';

interface AuthorizationsResponse { success: boolean; authorizations: Authorization[] }

export function AuthorizationsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Authorization | null>(null);
  const [revoking, setRevoking] = useState(false);
  const authorizations = useResource(
    (signal) => api.get<AuthorizationsResponse>('/api/authorizations', { signal }),
    [],
    { enabled: Boolean(user) },
  );
  const items = authorizations.data?.authorizations ?? [];

  async function revokeAuthorization() {
    if (!selected) return;
    setRevoking(true);
    try {
      await api.del(`/api/authorizations/${encodeURIComponent(selected.client_id)}`);
      toast('success', t('authorization.revoked', { client: selected.client_name || selected.name || selected.client_id }));
      setSelected(null);
      await authorizations.reload();
    } catch {
      toast('error', t('authorization.failed'));
    } finally {
      setRevoking(false);
    }
  }

  return (
    <AccountShell title={t('authorization.title')} description={t('authorization.description')}>
      {user ? (
        <AccountSection id="authorizations-container" title={t('authorization.current')} description={t('authorization.currentDescription')}>
          <AccountLoadState loading={authorizations.loading} error={authorizations.error} retry={authorizations.reload}>
            {items.length ? (
              <div className="account-list">
                {items.map((item) => {
                  const scopes = item.scope.split(/\s+/).filter(Boolean);
                  return (
                    <article className="authorization-item" key={item.id}>
                      <div className="authorization-item__header">
                        <div>
                        <h3>{item.client_name || item.name || item.client_id}</h3>
                        <p className="authorization-item__client">Client ID：<code>{item.client_id}</code></p>
                        <p>{item.client_type === 'public' ? t('authorization.public') : t('authorization.confidential')} · {item.party_type === 'third_party' ? t('authorization.thirdParty') : t('authorization.firstParty')}</p>
                        </div>
                        <Button type="button" variant="danger" size="sm" onClick={() => setSelected(item)}>{t('authorization.revoke')}</Button>
                      </div>
                      <div className="authorization-item__details">
                        <div><span>{t('authorization.created')}</span><strong>{formatAccountDate(item.created_at, true)}</strong></div>
                        <div><span>{t('authorization.lastUsed')}</span><strong>{item.last_used_at ? formatAccountDate(item.last_used_at, true) : t('authorization.noRecentUse')}</strong></div>
                      </div>
                      <div className="authorization-item__scopes">
                        <span>{t('authorization.scope')}</span>
                        {scopes.length ? <ul>{scopes.map((scope) => <li key={scope}>{scope}</li>)}</ul> : <p>{t('authorization.noScope')}</p>}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <AccountEmptyState>{t('authorization.empty')}</AccountEmptyState>}
          </AccountLoadState>
        </AccountSection>
      ) : null}
      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={t('authorization.revokeTitle')}
        footer={<><Button type="button" variant="ghost" onClick={() => setSelected(null)}>{t('authorization.cancel')}</Button><Button type="button" variant="danger" loading={revoking} onClick={() => void revokeAuthorization()}>{t('authorization.confirm')}</Button></>}
      >
        <p>{t('authorization.revokeBody', { client: selected?.client_name || selected?.name || selected?.client_id || '' })}</p>
      </Dialog>
    </AccountShell>
  );
}
