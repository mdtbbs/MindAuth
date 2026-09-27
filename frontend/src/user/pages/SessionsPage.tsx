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
import { useI18n } from '@/i18n/I18nProvider';

interface SessionsResponse { success: boolean; sessions: Session[] }
type PendingRevoke = { session?: Session; allOthers?: true } | null;

export function SessionsPage() {
  const { t } = useI18n();
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
        if (failed) toast('warning', t('session.partialFailure', { success: succeeded, failed }));
        else toast('success', t('session.otherSignedOut'));
        setPendingRevoke(null);
        await sessions.reload();
      } else if (pendingRevoke.session) {
        const target = pendingRevoke.session;
        await api.del(`/api/sessions/${encodeURIComponent(String(target.id))}`);
        setPendingRevoke(null);
        if (target.is_current) {
          toast('success', t('session.currentSignedOut'));
          await logout();
          window.location.assign('/login');
          return;
        }
        toast('success', t('session.signedOut'));
        await sessions.reload();
      }
    } catch {
      toast('error', t('session.revokeFailed'));
      await sessions.reload();
    } finally {
      setRevoking(false);
    }
  }

  return (
    <AccountShell title={t('session.title')} description={t('session.description')}>
      {user ? (
        <div className="account-page-sections">
          <AccountSection title={t('session.current')} description={t('session.currentDescription')}>
            <AccountLoadState loading={sessions.loading} error={sessions.error} retry={sessions.reload}>
              {currentSessions.length ? (
                <div className="account-list">
                  {currentSessions.map((session) => (
                    <SessionItem key={session.id} session={session} onRevoke={() => setPendingRevoke({ session })} />
                  ))}
                </div>
              ) : <AccountEmptyState>{t('session.noCurrent')}</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>

          <AccountSection
            title={t('session.others')}
            description={t('session.othersDescription')}
            action={otherSessions.length ? <Button type="button" variant="secondary" size="sm" onClick={() => setPendingRevoke({ allOthers: true })}>{t('session.revokeAll')}</Button> : undefined}
          >
            <AccountLoadState loading={sessions.loading} error={sessions.error} retry={sessions.reload}>
              {otherSessions.length ? (
                <div className="account-list">
                  {otherSessions.map((session) => (
                    <SessionItem key={session.id} session={session} onRevoke={() => setPendingRevoke({ session })} />
                  ))}
                </div>
              ) : <AccountEmptyState>{t('session.noOthers')}</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>
        </div>
      ) : null}

      <Dialog
        open={Boolean(pendingRevoke)}
        onClose={() => setPendingRevoke(null)}
        title={pendingRevoke?.allOthers ? t('session.confirmAll') : t('session.confirmDevice')}
        footer={<><Button type="button" variant="ghost" onClick={() => setPendingRevoke(null)}>{t('session.cancel')}</Button><Button type="button" variant="danger" loading={revoking} onClick={() => void confirmRevoke()}>{t('session.confirm')}</Button></>}
      >
        {pendingRevoke?.allOthers ? (
          <p>{t('session.bodyAll', { count: otherSessions.length })}</p>
        ) : pendingRevoke?.session?.is_current ? (
          <p>{t('session.bodyCurrent')}</p>
        ) : (
          <p>{t('session.bodyOther')}</p>
        )}
      </Dialog>
    </AccountShell>
  );
}

function SessionItem({ session, onRevoke }: { session: Session; onRevoke: () => void }) {
  const { t } = useI18n();
  const deviceName = session.device_info || (session.session_type === 'native' ? t('session.native') : t('session.browser'));
  return (
    <div className="account-list__item account-session-item">
      <div>
        <strong>{deviceName}</strong>
        <p>{session.ip_address || t('session.ipMissing')} · {t('session.recentActivity')} {formatAccountDate(session.last_active_at, true)}</p>
        <p>{t('session.loginTime')} {formatAccountDate(session.created_at, true)}</p>
      </div>
      <div className="account-button-row">
        {session.is_current ? <StatusLabel>{t('session.currentLabel')}</StatusLabel> : session.session_type === 'native' ? <span className="account-secondary-value">{t('session.native')}</span> : null}
        <Button type="button" variant={session.is_current ? 'danger' : 'secondary'} size="sm" onClick={onRevoke}>
          {session.is_current ? t('session.signOutCurrent') : t('session.signOut')}
        </Button>
      </div>
    </div>
  );
}
