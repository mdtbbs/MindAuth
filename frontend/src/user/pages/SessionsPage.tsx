import { useState } from 'react';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import type { Session } from '@/api/types';
import { useResource } from '@/api/useResource';
import { useToast } from '@/shared/ToastProvider';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
import {
  AccountEmptyState,
  AccountLoadState,
  AccountSection,
  formatAccountDate,
  StatusLabel,
} from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';

interface SessionsResponse { success: boolean; sessions: Session[] }
type PendingRevoke = { session?: Session; allOthers?: true } | null;

export function SessionsPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [pendingRevoke, setPendingRevoke] = useState<PendingRevoke>(null);
  const [revoking, setRevoking] = useState(false);
  const sessions = useResource(
    (signal) => api.get<SessionsResponse>('/api/sessions', { signal }),
    [],
    { enabled: Boolean(user) },
  );
  const allSessions = sessions.data?.sessions ?? [];
  const currentSessions = allSessions.filter((session) => session.is_current);
  const otherSessions = allSessions.filter((session) => !session.is_current);

  async function confirmRevoke() {
    if (!pendingRevoke) return;
    setRevoking(true);
    try {
      if (pendingRevoke.allOthers) {
        const results = await Promise.allSettled(otherSessions.map((session) =>
          api.del(`/api/sessions/${encodeURIComponent(String(session.id))}`),
        ));
        const succeeded = results.filter((result) => result.status === 'fulfilled').length;
        const failed = results.length - succeeded;
        if (failed) toast('warning', `已退出 ${succeeded} 台设备，${failed} 台设备退出失败`);
        else toast('success', '其他设备已全部退出');
        setPendingRevoke(null);
        await sessions.reload();
      } else if (pendingRevoke.session) {
        const target = pendingRevoke.session;
        await api.del(`/api/sessions/${encodeURIComponent(String(target.id))}`);
        setPendingRevoke(null);
        if (target.is_current) {
          toast('success', '当前设备已退出');
          await logout();
          window.location.assign('/login');
          return;
        }
        toast('success', '设备已退出');
        await sessions.reload();
      }
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '退出设备失败');
      await sessions.reload();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <AccountShell title="登录设备" description="查看近期使用过此账户的浏览器和客户端，并结束不再使用的会话。">
      {user ? (
        <div className="account-page-sections">
          <AccountSection title="当前设备" description="当前设备会话仅在你明确选择退出时结束。">
            <AccountLoadState loading={sessions.loading} error={sessions.error} retry={sessions.reload}>
              {currentSessions.length ? (
                <div className="account-list">
                  {currentSessions.map((session) => (
                    <SessionItem key={session.id} session={session} onRevoke={() => setPendingRevoke({ session })} />
                  ))}
                </div>
              ) : <AccountEmptyState>当前浏览器没有可识别的活动会话。</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>

          <AccountSection
            title="其他设备"
            description="退出陌生或不再使用的设备，会立即撤销对应会话。"
            action={otherSessions.length ? <Button type="button" variant="secondary" size="sm" onClick={() => setPendingRevoke({ allOthers: true })}>退出其他所有设备</Button> : undefined}
          >
            <AccountLoadState loading={sessions.loading} error={sessions.error} retry={sessions.reload}>
              {otherSessions.length ? (
                <div className="account-list">
                  {otherSessions.map((session) => (
                    <SessionItem key={session.id} session={session} onRevoke={() => setPendingRevoke({ session })} />
                  ))}
                </div>
              ) : <AccountEmptyState>没有其他登录设备。</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>
        </div>
      ) : null}

      <Dialog
        open={Boolean(pendingRevoke)}
        onClose={() => setPendingRevoke(null)}
        title={pendingRevoke?.allOthers ? '退出其他所有设备' : '确认退出设备'}
        footer={<><Button type="button" variant="ghost" onClick={() => setPendingRevoke(null)}>取消</Button><Button type="button" variant="danger" loading={revoking} onClick={() => void confirmRevoke()}>确认退出</Button></>}
      >
        {pendingRevoke?.allOthers ? (
          <p>将退出 {otherSessions.length} 台其他设备。当前设备会保持登录。</p>
        ) : pendingRevoke?.session?.is_current ? (
          <p>这会退出当前设备并结束本次 MindAuth 登录。</p>
        ) : (
          <p>退出后，该设备需要重新登录才能继续使用 MindAuth。</p>
        )}
      </Dialog>
    </AccountShell>
  );
}

function SessionItem({ session, onRevoke }: { session: Session; onRevoke: () => void }) {
  return (
    <div className="account-list__item account-session-item">
      <div>
        <strong>{session.device_info || (session.session_type === 'native' ? '客户端' : 'Web 浏览器')}</strong>
        <p>{session.ip_address || 'IP 未提供'} · 最近活动 {formatAccountDate(session.last_active_at, true)}</p>
        <p>登录时间 {formatAccountDate(session.created_at, true)}</p>
      </div>
      <div className="account-button-row">
        {session.is_current ? <StatusLabel>当前设备</StatusLabel> : session.session_type === 'native' ? <span className="account-secondary-value">客户端</span> : null}
        <Button type="button" variant={session.is_current ? 'danger' : 'secondary'} size="sm" onClick={onRevoke}>
          {session.is_current ? '退出当前设备' : '退出此设备'}
        </Button>
      </div>
    </div>
  );
}
