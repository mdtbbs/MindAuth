import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import api from '@/api/client';
import type { Notification } from '@/api/types';
import { useResource } from '@/api/useResource';
import { useToast } from '@/shared/ToastProvider';
import { Button } from '@/shared/Button';
import { AccountEmptyState, AccountLoadState, AccountSection, formatAccountDate, StatusLabel } from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';

interface NotificationPagination { page: number; limit: number; total: number; totalPages: number }
interface NotificationsResponse { success: boolean; notifications: Notification[]; pagination: NotificationPagination }

export function NotificationsPage() {
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
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '标记已读失败');
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setBusyId(-1);
    try {
      await api.patch('/api/notifications/read-all');
      toast('success', '所有通知已标记为已读');
      await notifications.reload();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '标记失败');
    } finally {
      setBusyId(null);
    }
  }

  async function removeNotification(item: Notification) {
    setBusyId(item.id);
    try {
      await api.del(`/api/notifications/${item.id}`);
      toast('success', '通知已删除');
      if (items.length === 1 && page > 1) setPage((current) => current - 1);
      else await notifications.reload();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '删除通知失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AccountShell title="通知" description="查看 MindAuth 的账户、安全和服务消息。">
      {user ? (
        <AccountSection
          title="通知中心"
          description={pageInfo ? `共 ${pageInfo.total} 条通知` : '最新的账户消息会显示在这里。'}
          action={hasNotifications ? <Button type="button" variant="secondary" size="sm" loading={busyId === -1} onClick={() => void markAllRead()}>全部标记已读</Button> : undefined}
        >
          <AccountLoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload}>
            {items.length ? (
              <div className="account-list">
                {items.map((item) => (
                  <article key={item.id} className={`notification-item${item.is_read ? '' : ' notification-item--unread'}`}>
                    <div className="notification-item__body">
                      <div className="notification-item__title-line">
                        <h3>{item.title}</h3>
                        {!item.is_read ? <StatusLabel needsAction>未读</StatusLabel> : null}
                      </div>
                      {item.content ? <p>{item.content}</p> : null}
                      <span className="account-list__meta">{formatAccountDate(item.created_at, true)}</span>
                    </div>
                    <div className="account-button-row">
                      {!item.is_read ? <Button type="button" variant="ghost" size="sm" disabled={busyId === item.id} onClick={() => void markRead(item.id)}>标记已读</Button> : null}
                      <Button type="button" variant="ghost" size="sm" disabled={busyId === item.id} onClick={() => void removeNotification(item)}>删除</Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <AccountEmptyState>暂无需要处理的通知。</AccountEmptyState>}
          </AccountLoadState>
          {pageInfo && pageInfo.totalPages > 1 ? (
            <nav className="account-pagination" aria-label="通知分页">
              <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</Button>
              <span>第 {pageInfo.page} / {pageInfo.totalPages} 页</span>
              <Button type="button" variant="secondary" size="sm" disabled={page >= pageInfo.totalPages} onClick={() => setPage((current) => current + 1)}>下一页</Button>
            </nav>
          ) : null}
        </AccountSection>
      ) : null}
    </AccountShell>
  );
}
