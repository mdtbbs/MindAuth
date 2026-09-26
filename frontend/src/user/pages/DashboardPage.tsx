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
  const authorizationItems = authorizations.data?.authorizations ?? [];
  const notificationItems = notifications.data?.notifications ?? [];
  const latestLogin = loginLogs.data?.logs[0]?.created_at;
  const securityIssues = user ? Number(!user.email_verified) + Number(!user.phone_verified) : 0;

  return (
    <AccountShell title="账户" description="查看身份状态、安全设置、登录设备和第三方授权。">
      {user ? (
        <div className="account-dashboard-v2" data-testid="account-dashboard">
          <section className="account-overview-hero" aria-label="账户身份">
            <div className="account-overview-hero__avatar" aria-hidden="true">
              {user.avatar_url ? <img src={user.avatar_url} alt="" /> : initial(user.username)}
            </div>
            <div className="account-overview-hero__identity">
              <div className="account-overview-hero__name-row">
                <h2>{user.username}</h2>
                <StatusLabel needsAction={!user.email_verified}>{user.email_verified ? '邮箱已验证' : '邮箱待验证'}</StatusLabel>
                <StatusLabel needsAction={!user.phone_verified}>{user.phone_verified ? '手机号已绑定' : '未绑定手机号'}</StatusLabel>
              </div>
              <p>{user.email}</p>
              <span>MindAuth 统一账户</span>
            </div>
            <div className="account-overview-hero__actions">
              <Link className="btn btn--secondary" to="/profile">个人资料</Link>
              <Link className="btn btn--secondary" to="/security">登录与安全</Link>
            </div>
          </section>

          <section className="account-overview-strip" aria-label="账户状态">
            <Link to="/security" className="account-overview-stat">
              <span>安全状态</span>
              <strong className={securityIssues ? 'is-attention' : ''}>{securityIssues ? `${securityIssues} 项待处理` : '正常'}</strong>
              <small>邮箱与手机号验证</small>
            </Link>
            <Link to="/sessions" className="account-overview-stat">
              <span>登录设备</span>
              <strong>{sessions.loading ? '…' : sessionItems.length}</strong>
              <small>当前活跃会话</small>
            </Link>
            <Link to="/authorizations" className="account-overview-stat">
              <span>应用授权</span>
              <strong>{authorizations.loading ? '…' : authorizationItems.length}</strong>
              <small>可随时撤销</small>
            </Link>
            <Link to="/activity" className="account-overview-stat">
              <span>最近登录</span>
              <strong className="account-overview-stat__date">{loginLogs.loading ? '读取中' : latestLogin ? formatAccountDate(latestLogin, true) : '暂无记录'}</strong>
              <small>查看完整登录记录</small>
            </Link>
          </section>

          <div className="account-dashboard-columns">
            <div className="account-dashboard-column">
              <AccountSection title="账户安全" description="这里只显示需要你处理的事情。">
                <div className={`security-overview${securityIssues ? ' security-overview--attention' : ''}`} role="status">
                  <strong>{securityIssues ? `还有 ${securityIssues} 项没有完成` : '当前没有需要处理的安全项目'}</strong>
                  {securityIssues ? (
                    <ul>
                      {!user.email_verified ? (
                        <li>
                          邮箱尚未验证
                          <Button type="button" variant="secondary" size="sm" onClick={sendVerificationEmail}>发送验证邮件</Button>
                        </li>
                      ) : null}
                      {!user.phone_verified ? (
                        <li>手机号尚未绑定，<Link to="/security">前往登录与安全</Link> 完成。</li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
                <Link className="account-text-link account-section__inline-link" to="/security">管理安全设置 <span aria-hidden="true">→</span></Link>
              </AccountSection>

              <AccountSection
                title="最近设备"
                description="近期访问过 MindAuth 的浏览器与客户端。"
                action={<Link className="account-text-link" to="/sessions">全部设备</Link>}
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
            </div>

            <div className="account-dashboard-column">
              <AccountSection
                title="授权应用"
                description="第三方应用获得的账户权限。"
                action={<Link className="account-text-link" to="/authorizations">管理授权</Link>}
              >
                <AccountLoadState loading={authorizations.loading} error={authorizations.error} retry={authorizations.reload}>
                  {authorizationItems.length ? (
                    <div className="account-list">
                      {authorizationItems.slice(0, 3).map((authorization) => (
                        <div className="account-list__item" key={authorization.id}>
                          <div>
                            <strong>{authorization.client_name}</strong>
                            <p>{authorization.scope || '未提供权限说明'}</p>
                          </div>
                          <span className="account-list__meta">{formatAccountDate(authorization.last_used_at, true)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <AccountEmptyState>没有已授权的应用。</AccountEmptyState>}
                </AccountLoadState>
                <div className="account-dashboard-inline-actions">
                  <Link className="account-text-link" to="/developer">开发者应用</Link>
                  <Link className="account-text-link" to="/apps">社区应用</Link>
                </div>
              </AccountSection>

              <AccountSection
                title="通知"
                description="最近的账户和安全消息。"
                action={<Link className="account-text-link" to="/notifications">通知中心</Link>}
              >
                <AccountLoadState loading={notifications.loading} error={notifications.error} retry={notifications.reload}>
                  {notificationItems.length ? (
                    <div className="account-list">
                      {notificationItems.slice(0, 3).map((notification) => (
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
          </div>
        </div>
      ) : null}
    </AccountShell>
  );
}
