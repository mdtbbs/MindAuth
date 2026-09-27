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
import { useI18n } from '@/i18n/I18nProvider';

interface SessionsResponse { success: boolean; sessions: Session[] }
interface NotificationsResponse { success: boolean; notifications: Notification[] }
interface AuthorizationsResponse { success: boolean; authorizations: Authorization[] }
interface LoginLogsResponse { success: boolean; logs: LoginLog[] }

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'M';
}

export function DashboardPage() {
  const { t } = useI18n();
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
      toast('success', t('dashboard.emailSent'));
    } catch {
      toast('error', t('dashboard.emailSendFailed'));
    }
  }

  const sessionItems = sessions.data?.sessions ?? [];
  const authorizationItems = authorizations.data?.authorizations ?? [];
  const notificationItems = notifications.data?.notifications ?? [];
  const latestLogin = loginLogs.data?.logs[0]?.created_at;
  const securityIssues = user ? Number(!user.email_verified) : 0;

  return (
    <AccountShell title={t('dashboard.title')} description={t('dashboard.description')}>
      {user ? (
        <div className="account-dashboard-v2" data-testid="account-dashboard">
          <section className="account-overview-hero" aria-label={t('dashboard.identity')}>
            <div className="account-overview-hero__avatar" aria-hidden="true">
              {user.avatar_url ? <img src={user.avatar_url} alt="" /> : initial(user.username)}
            </div>
            <div className="account-overview-hero__identity">
              <div className="account-overview-hero__name-row">
                <h2>{user.username}</h2>
                <StatusLabel needsAction={!user.email_verified}>{user.email_verified ? t('dashboard.emailVerified') : t('dashboard.emailPending')}</StatusLabel>
                <StatusLabel>{user.phone_verified ? t('dashboard.phoneBound') : t('dashboard.phoneOptional')}</StatusLabel>
              </div>
              <p>{user.email}</p>
              <span>MindAuth</span>
            </div>
            <div className="account-overview-hero__actions">
              <Link className="btn btn--secondary" to="/profile">{t('dashboard.profile')}</Link>
              <Link className="btn btn--secondary" to="/security">{t('dashboard.security')}</Link>
            </div>
          </section>

          <section className="account-overview-strip" aria-label={t('dashboard.status')}>
            <Link to="/security" className="account-overview-stat">
              <span>{t('dashboard.securityStatus')}</span>
              <strong className={securityIssues ? 'is-attention' : ''}>{securityIssues ? t('dashboard.pending', { count: securityIssues }) : t('dashboard.normal')}</strong>
              <small>{t('dashboard.emailAndPhone')}</small>
            </Link>
            <Link to="/sessions" className="account-overview-stat">
              <span>{t('dashboard.sessions')}</span>
              <strong>{sessions.loading ? '…' : sessionItems.length}</strong>
              <small>{t('dashboard.activeSessions')}</small>
            </Link>
            <Link to="/authorizations" className="account-overview-stat">
              <span>{t('dashboard.authorizations')}</span>
              <strong>{authorizations.loading ? '…' : authorizationItems.length}</strong>
              <small>{t('dashboard.revokeAnytime')}</small>
            </Link>
            <Link to="/activity" className="account-overview-stat">
              <span>{t('dashboard.latestLogin')}</span>
              <strong className="account-overview-stat__date">{loginLogs.loading ? t('dashboard.loading') : latestLogin ? formatAccountDate(latestLogin, true) : t('dashboard.noRecords')}</strong>
              <small>{t('dashboard.fullHistory')}</small>
            </Link>
          </section>

          <div className="account-dashboard-columns">
            <div className="account-dashboard-column">
              <AccountSection title={t('dashboard.securitySection')} description={t('dashboard.securityDescription')}>
                <div className={`security-overview${securityIssues ? ' security-overview--attention' : ''}`} role="status">
                  <strong>{securityIssues ? t('dashboard.todos', { count: securityIssues }) : t('dashboard.noTodos')}</strong>
                  {securityIssues ? (
                    <ul>
                      {!user.email_verified ? (
                        <li>
                          {t('dashboard.emailUnverified')}
                          <Button type="button" variant="secondary" size="sm" onClick={sendVerificationEmail}>{t('dashboard.sendVerification')}</Button>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
                <Link className="account-text-link account-section__inline-link" to="/security">{t('dashboard.manageSecurity')} <span aria-hidden="true">→</span></Link>
              </AccountSection>

              <AccountSection
                title={t('dashboard.recentDevices')}
                description={t('dashboard.recentDevicesDescription')}
                action={<Link className="account-text-link" to="/sessions">{t('dashboard.allDevices')}</Link>}
              >
                <AccountLoadState loading={sessions.loading} error={sessions.error} retry={sessions.reload}>
                  {sessionItems.length ? (
                    <div className="account-list">
                      {sessionItems.slice(0, 3).map((session) => (
                        <div className="account-list__item" key={session.id}>
                          <div>
                            <strong>{session.device_info || (session.session_type === 'native' ? t('session.native') : t('session.browser'))}</strong>
                            <p>{session.ip_address || t('session.ipMissing')} · {t('session.recentActivity')} {formatAccountDate(session.last_active_at, true)}</p>
                          </div>
                          {session.is_current ? <StatusLabel>{t('dashboard.currentDevice')}</StatusLabel> : null}
                        </div>
                      ))}
                    </div>
                  ) : <AccountEmptyState>{t('dashboard.noDevices')}</AccountEmptyState>}
                </AccountLoadState>
              </AccountSection>
            </div>

            <div className="account-dashboard-column">
              <AccountSection
                title={t('dashboard.authorizations')}
                description={t('dashboard.appsDescription')}
                action={<Link className="account-text-link" to="/authorizations">{t('dashboard.manageAuthorizations')}</Link>}
              >
                <AccountLoadState loading={authorizations.loading} error={authorizations.error} retry={authorizations.reload}>
                  {authorizationItems.length ? (
                    <div className="account-list">
                      {authorizationItems.slice(0, 3).map((authorization) => (
                        <div className="account-list__item" key={authorization.id}>
                          <div>
                            <strong>{authorization.client_name}</strong>
                            <p>{authorization.scope || t('dashboard.noScope')}</p>
                          </div>
                          <span className="account-list__meta">{formatAccountDate(authorization.last_used_at, true)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <AccountEmptyState>{t('dashboard.noAuthorizations')}</AccountEmptyState>}
                </AccountLoadState>
                <div className="account-dashboard-inline-actions">
                  <Link className="account-text-link" to="/developer">{t('dashboard.developerApps')}</Link>
                  <Link className="account-text-link" to="/apps">{t('dashboard.communityApps')}</Link>
                </div>
              </AccountSection>

              <AccountSection
                title={t('dashboard.notifications')}
                description={t('dashboard.notificationsDescription')}
                action={<Link className="account-text-link" to="/notifications">{t('dashboard.notificationCenter')}</Link>}
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
                  ) : <AccountEmptyState>{t('dashboard.noNotifications')}</AccountEmptyState>}
                </AccountLoadState>
              </AccountSection>
            </div>
          </div>
        </div>
      ) : null}
    </AccountShell>
  );
}
