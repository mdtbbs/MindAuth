import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import api from '@/api/client';
import { useResource } from '@/api/useResource';
import type { Authorization, LoginLog, Notification, Session } from '@/api/types';
import { AccountShell } from '@/user/components/AccountShell';
import {
  AccountEmptyState,
  AccountLoadState,
  AccountSection,
  formatAccountDate,
  StatusLabel,
} from '@/user/components/AccountPageParts';
import { Button } from '@/shared/Button';
import { useToast } from '@/shared/ToastProvider';

interface SessionsResponse { success: boolean; sessions: Session[] }
interface NotificationsResponse { success: boolean; notifications: Notification[] }
interface AuthorizationsResponse { success: boolean; authorizations: Authorization[] }
interface LoginLogsResponse { success: boolean; logs: LoginLog[] }

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'M';
}

export function DashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const sessions = useResource(
    (signal) => api.get<SessionsResponse>('/api/sessions', { signal }),
    [],
    { enabled: Boolean(user) },
  );
  const notifications = useResource(
    (signal) => api.get<NotificationsResponse>('/api/notifications?page=1&limit=3', { signal }),
    [],
    { enabled: Boolean(user) },
  );
  const authorizations = useResource(
    (signal) => api.get<AuthorizationsResponse>('/api/authorizations', { signal }),
    [],
    { enabled: Boolean(user) },
  );
  const loginLogs = useResource(
    (signal) => api.get<LoginLogsResponse>('/api/login-logs', { signal }),
    [],
    { enabled: Boolean(user) },
  );

  async function sendVerificationEmail() {
    try {
      await api.post('/api/email-verification/send');
      toast('success', '验证邮件已发送');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '发送验证邮件失败');
    }
  }

  const sessionItems = sessions.data?.sessions ?? [];
  const latestLogin = loginLogs.data?.logs[0]?.created_at;
  const securityIssues = user ? Number(!user.email_verified) + Number(!user.phone_verified) : 0;

  return (
    <AccountShell title="账户概览" description="MDT 生态统一身份、安全、设备与授权管理。">
      {user ? (
        <div className="account-dashboard" data-testid="account-dashboard">
          <AccountSection title="身份摘要" description="用于 MDT 生态服务的统一账户。">
            <div className="identity-summary">
              <div className="identity-summary__avatar" aria-hidden="true">
                {user.avatar_url ? <img src={user.avatar_url} alt="" /> : initial(user.username)}
              </div>
              <div className="identity-summary__main">
                <h2>{user.username}</h2>
                <p>{user.email}</p>
                <div className="identity-summary__statuses">
                  <StatusLabel needsAction={!user.email_verified}>{user.email_verified ? '邮箱已验证' : '邮箱待验证'}</StatusLabel>
                  <StatusLabel needsAction={!user.phone_verified}>{user.phone_verified ? '手机号已绑定' : '未绑定手机号'}</StatusLabel>
                </div>
              </div>
              <Link className="account-text-link identity-summary__action" to="/profile">管理个人资料 <span aria-hidden="true">→</span></Link>
            </div>
          </AccountSection>

          <AccountSection title="账户安全" description="根据当前账户设置显示需要处理的事项。">
            <div className={`security-overview${securityIssues ? ' security-overview--attention' : ''}`} role="status">
              <strong>{securityIssues ? `需要完成 ${securityIssues} 项安全设置` : '未发现需要处理的安全问题'}</strong>
              {securityIssues ? (
                <ul>
                  {!user.email_verified ? (
                    <li>
                      邮箱尚未验证，可用于账号恢复
                      <Button type="button" variant="secondary" size="sm" onClick={sendVerificationEmail}>发送验证邮件</Button>
                    </li>
                  ) : null}
                  {!user.phone_verified ? (
                    <li>手机号尚未绑定，可在 <Link to="/security">登录与安全</Link> 中完成。</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
            <dl className="account-facts">
              <div><dt>邮箱</dt><dd>{user.email_verified ? '已验证' : '待验证'}</dd></div>
              <div><dt>手机号</dt><dd>{user.phone_verified ? (user.phone_masked || '已绑定') : '未绑定'}</dd></div>
              <div><dt>最近登录</dt><dd>
                <AccountLoadState loading={loginLogs.loading} error={loginLogs.error} retry={loginLogs.reload}>
                  {latestLogin ? formatAccountDate(latestLogin, true) : '暂无登录记录'}
                </AccountLoadState>
              </dd></div>
            </dl>
            <Link className="account-text-link account-section__inline-link" to="/security">查看登录与安全 <span aria-hidden="true">→</span></Link>
          </AccountSection>

          <AccountSection
            title="最近设备"
            description="近期访问过 MindAuth 的浏览器与客户端。"
            action={<Link className="account-text-link" to="/sessions">查看全部 <span aria-hidden="true">→</span></Link>}
          >
            <AccountLoadState loading={sessions.loading} error={sessions.error} retry={sessions.reload}>
              {sessionItems.length ? (
                <div className="account-list">
                  {sessionItems.slice(0, 3).map((session) => (
                    <div className="account-list__item" key={session.id}>
                      <div>
                        <strong>{session.device_info || (session.session_type === 'native' ? 'Native 客户端' : 'Web 浏览器')}</strong>
                        <p>{session.ip_address || 'IP 未提供'} · 最近活动 {formatAccountDate(session.last_active_at, true)}</p>
                      </div>
                      {session.is_current ? <StatusLabel>当前设备</StatusLabel> : null}
                    </div>
                  ))}
                </div>
              ) : <AccountEmptyState>没有活跃的登录设备。</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>

          <AccountSection
            title="已授权应用"
            description="可以查看应用获得的权限并随时撤销授权。"
            action={<Link className="account-text-link" to="/authorizations">查看全部 <span aria-hidden="true">→</span></Link>}
          >
            <AccountLoadState loading={authorizations.loading} error={authorizations.error} retry={authorizations.reload}>
              {authorizations.data?.authorizations.length ? (
                <div className="account-list">
                  {authorizations.data.authorizations.slice(0, 2).map((authorization) => (
                    <div className="account-list__item" key={authorization.id}>
                      <div>
                        <strong>{authorization.client_name}</strong>
                        <p>{authorization.client_id} · {authorization.scope || '未提供权限说明'}</p>
                      </div>
                      <span className="account-list__meta">最近使用 {formatAccountDate(authorization.last_used_at, true)}</span>
                    </div>
                  ))}
                </div>
              ) : <AccountEmptyState>没有已授权的应用。</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>

          <AccountSection
            title="重要通知"
            description="显示最近的账户与安全消息。"
            action={<Link className="account-text-link" to="/notifications">通知中心 <span aria-hidden="true">→</span></Link>}
          >
            <AccountLoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload}>
              {notifications.data?.notifications.length ? (
                <div className="account-list">
                  {notifications.data.notifications.slice(0, 3).map((notification) => (
                    <article className="account-list__item account-notice" key={notification.id}>
                      <div>
                        <strong>{notification.title}</strong>
                        {notification.content ? <p>{notification.content}</p> : null}
                      </div>
                      <span className="account-list__meta">{formatAccountDate(notification.created_at)}</span>
                    </article>
                  ))}
                </div>
              ) : <AccountEmptyState>暂无需要处理的通知。</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>
        </div>
      ) : null}
    </AccountShell>
  );
}
