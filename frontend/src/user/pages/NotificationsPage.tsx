import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import api from '@/api/client';
import type { Notification } from '@/api/types';
import { useResource } from '@/api/useResource';
import { useToast } from '@/shared/ToastProvider';
import { Button } from '@/shared/Button';
import { AccountEmptyState, AccountLoadState, AccountSection, formatAccountDate, StatusLabel } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';
import { useI18n } from '@/i18n/I18nProvider';

interface NotificationPagination { page: number; limit: number; total: number; totalPages: number }
interface NotificationsResponse { success: boolean; notifications: Notification[]; pagination: NotificationPagination }

export function NotificationsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<number | null>(null);
  const notifications = useResource(
    (signal) => api.get<NotificationsResponse>(`/api/notifications?page=${page}&limit=20`, { signal }),
    [page],
    { enabled: Boolean(user) },
  );
  const items = notifications.data?.notifications ?? [];
  const pageInfo = notifications.data?.pagination;
  const hasNotifications = (pageInfo?.total ?? items.length) > 0;

  async function markRead(id: number) {
    setBusyId(id);
    try {
      await api.patch(`/api/notifications/${id}/read`);
      await notifications.reload();
    } catch {
      toast('error', t('notification.readAllFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setBusyId(-1);
    try {
      await api.patch('/api/notifications/read-all');
      toast('success', t('notification.readAllSuccess'));
      await notifications.reload();
    } catch {
      toast('error', t('notification.readAllFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function removeNotification(item: Notification) {
    setBusyId(item.id);
    try {
      await api.del(`/api/notifications/${item.id}`);
      toast('success', t('notification.delete'));
      if (items.length === 1 && page > 1) setPage((current) => current - 1);
      else await notifications.reload();
    } catch {
      toast('error', t('notification.deleteFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AccountShell title={t('notification.title')} description={t('notification.description')}>
      {user ? (
        <AccountSection
          title={t('notification.center')}
          description={pageInfo ? t('notification.count', { count: pageInfo.total }) : t('notification.latest')}
          action={hasNotifications ? <Button type="button" variant="secondary" size="sm" loading={busyId === -1} onClick={() => void markAllRead()}>{t('notification.markAll')}</Button> : undefined}
        >
          <AccountLoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload}>
            {items.length ? (
              <div className="account-list">
                {items.map((item) => (
                  <article key={item.id} className={`notification-item${item.is_read ? '' : ' notification-item--unread'}`}>
                    <div className="notification-item__body">
                      <div className="notification-item__title-line">
                        <h3>{item.title}</h3>
                        {!item.is_read ? <StatusLabel needsAction>{t('notification.unread')}</StatusLabel> : null}
                      </div>
                      {item.content ? <p>{item.content}</p> : null}
                      <span className="account-list__meta">{formatAccountDate(item.created_at, true)}</span>
                    </div>
                    <div className="account-button-row">
                      {!item.is_read ? <Button type="button" variant="ghost" size="sm" disabled={busyId === item.id} onClick={() => void markRead(item.id)}>{t('notification.markRead')}</Button> : null}
                      <Button type="button" variant="ghost" size="sm" disabled={busyId === item.id} onClick={() => void removeNotification(item)}>{t('notification.delete')}</Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <AccountEmptyState>{t('notification.empty')}</AccountEmptyState>}
          </AccountLoadState>
          {pageInfo && pageInfo.totalPages > 1 ? (
            <nav className="account-pagination" aria-label={t('notification.pageLabel')}>
              <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>{t('notification.previous')}</Button>
              <span>{t('notification.page', { page: pageInfo.page, total: pageInfo.totalPages })}</span>
              <Button type="button" variant="secondary" size="sm" disabled={page >= pageInfo.totalPages} onClick={() => setPage((current) => current + 1)}>{t('notification.next')}</Button>
            </nav>
          ) : null}
        </AccountSection>
      ) : null}
    </AccountShell>
  );
}
