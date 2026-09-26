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

interface AuthorizationsResponse { success: boolean; authorizations: Authorization[] }

export function AuthorizationsPage() {
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
      toast('success', `已撤销 ${selected.client_name} 的授权`);
      setSelected(null);
      await authorizations.reload();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '撤销授权失败');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <AccountShell title="授权应用" description="查看通过 MindAuth 接入账户的应用，以及它们获得的权限。">
      {user ? (
        <AccountSection id="authorizations-container" title="当前授权" description="撤销授权会同时使该应用的相关令牌失效。">
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
                        <p>{item.client_type === 'public' ? 'Public Client' : 'Confidential Client'} · {item.party_type === 'third_party' ? '第三方应用' : '第一方应用'}</p>
                        </div>
                        <Button type="button" variant="danger" size="sm" onClick={() => setSelected(item)}>撤销授权</Button>
                      </div>
                      <div className="authorization-item__details">
                        <div><span>授权时间</span><strong>{formatAccountDate(item.created_at, true)}</strong></div>
                        <div><span>最近使用</span><strong>{item.last_used_at ? formatAccountDate(item.last_used_at, true) : '暂无记录'}</strong></div>
                      </div>
                      <div className="authorization-item__scopes">
                        <span>权限范围</span>
                        {scopes.length ? <ul>{scopes.map((scope) => <li key={scope}>{scope}</li>)}</ul> : <p>未提供权限范围</p>}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <AccountEmptyState>没有已授权的应用。</AccountEmptyState>}
          </AccountLoadState>
        </AccountSection>
      ) : null}
      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="撤销应用授权"
        footer={<><Button type="button" variant="ghost" onClick={() => setSelected(null)}>取消</Button><Button type="button" variant="danger" loading={revoking} onClick={() => void revokeAuthorization()}>确认撤销</Button></>}
      >
        <p>撤销 <strong>{selected?.client_name || selected?.name || selected?.client_id}</strong> 的授权后，该应用将无法继续访问此账户，并且相关令牌会失效。</p>
      </Dialog>
    </AccountShell>
  );
}
