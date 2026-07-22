import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { ResponsiveTable } from '@/shared/ResponsiveTable';
import type {
  Session,
  Notification,
  LoginLog,
  Authorization,
  UnreadCount,
} from '@/api/types';

/**
 * Dashboard page showing user profile, email status, notifications,
 * sessions, login logs, and authorized apps.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, logout, loadCurrentUser } = useAuth();
  const { toast } = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [phoneStatus, setPhoneStatus] = useState<{ phone: string | null; verified: boolean }>({
    phone: null,
    verified: false,
  });

  // SMS binding state
  const [smsPhone, setSmsPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      toast('warning', '请先登录');
      navigate('/login', { replace: true });
    }
  }, [user, authLoading, navigate, toast]);

  const loadDashboardData = useCallback(async () => {
    try {
      const [sessRes, notifsRes, logsRes, authsRes, unreadRes] = await Promise.allSettled([
        api.get<{ success: boolean; sessions: Session[] }>('/api/sessions'),
        api.get<{ success: boolean; notifications: Notification[] }>('/api/notifications'),
        api.get<{ success: boolean; logs: LoginLog[] }>('/api/login-logs'),
        api.get<{ success: boolean; authorizations: Authorization[] }>('/api/me'),
        api.get<UnreadCount>('/api/notifications/unread-count'),
      ]);

      if (sessRes.status === 'fulfilled') setSessions(sessRes.value.sessions || []);
      if (notifsRes.status === 'fulfilled') setNotifications(notifsRes.value.notifications || []);
      if (logsRes.status === 'fulfilled') setLoginLogs(logsRes.value.logs || []);
      if (unreadRes.status === 'fulfilled') setUnreadCount(unreadRes.value.count || 0);
      if (authsRes.status === 'fulfilled') {
        const data = authsRes.value as { success: boolean; authorizations?: Authorization[] };
        setAuthorizations(data.authorizations || []);
      }
    } catch {
      // Dashboard data load failure is non-fatal
    }
  }, []);

  useEffect(() => {
    if (user) {
      setPhoneStatus({ phone: user.phone, verified: user.phone_verified });
      loadDashboardData();
    }
  }, [user, loadDashboardData]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handleSendVerificationEmail() {
    try {
      await api.post('/api/email-verification/send');
      toast('success', '验证邮件已发送');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败';
      toast('error', msg);
    }
  }

  async function handleSendSms() {
    if (!smsPhone.trim()) {
      toast('error', '请输入手机号');
      return;
    }
    setSmsLoading(true);
    try {
      await api.post('/api/sms/send', { phone: smsPhone.trim() });
      setSmsSent(true);
      toast('success', '验证码已发送');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败';
      toast('error', msg);
    } finally {
      setSmsLoading(false);
    }
  }

  async function handleVerifySms() {
    if (!smsCode.trim()) {
      toast('error', '请输入验证码');
      return;
    }
    setSmsLoading(true);
    try {
      await api.post('/api/sms/verify', { code: smsCode.trim() });
      toast('success', '手机号绑定成功');
      await loadCurrentUser();
      setSmsSent(false);
      setSmsCode('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '验证失败';
      toast('error', msg);
    } finally {
      setSmsLoading(false);
    }
  }

  async function handleMarkNotificationRead(id: number) {
    try {
      await api.patch(`/api/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      toast('error', '操作失败');
    }
  }

  async function handleMarkAllRead() {
    try {
      await api.patch('/api/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      toast('success', '已标记全部已读');
    } catch {
      toast('error', '操作失败');
    }
  }

  if (authLoading || !user) {
    return (
      <div className="page--auth">
        <p style={{ color: 'var(--color-text-muted)' }}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-6)', paddingBottom: 'var(--space-6)' }}>
      <div className="cluster cluster--spread" style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>Dashboard</h1>
        <div className="cluster">
          <Button variant="secondary" size="sm" onClick={() => navigate('/account-settings')}>
            账户设置
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="logout-btn">
            退出登录
          </Button>
        </div>
      </div>

      <div className="stack stack--xl">
        {/* Profile Card */}
        <Card>
          <CardTitle>个人信息</CardTitle>
          <div className="stack stack--sm">
            <div className="cluster">
              <span style={{ color: 'var(--color-text-secondary)', minWidth: '80px' }}>用户名:</span>
              <span id="username-display" data-testid="username-display" style={{ fontWeight: 'var(--weight-semibold)' }}>
                {user.username}
              </span>
            </div>
            <div className="cluster">
              <span style={{ color: 'var(--color-text-secondary)', minWidth: '80px' }}>邮箱:</span>
              <span>{user.email}</span>
              <span id="verified-badge" data-testid="verified-badge">
                {user.email_verified ? (
                  <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)', marginLeft: 'var(--space-2)' }}>
                    已验证
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)', marginLeft: 'var(--space-2)' }}>
                    未验证
                  </span>
                )}
              </span>
              {!user.email_verified && (
                <Button size="sm" variant="ghost" onClick={handleSendVerificationEmail}>
                  发送验证邮件
                </Button>
              )}
            </div>
            <div className="cluster">
              <span style={{ color: 'var(--color-text-secondary)', minWidth: '80px' }}>角色:</span>
              <span>{user.role === 'admin' ? '管理员' : '用户'}</span>
            </div>
            <div className="cluster">
              <span style={{ color: 'var(--color-text-secondary)', minWidth: '80px' }}>注册时间:</span>
              <span>{new Date(user.created_at).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        </Card>

        {/* Phone / SMS Binding */}
        <Card>
          <CardTitle>手机号绑定</CardTitle>
          {phoneStatus.phone ? (
            <div className="cluster">
              <span>{phoneStatus.phone}</span>
              {phoneStatus.verified ? (
                <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>已验证</span>
              ) : (
                <span style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>未验证</span>
              )}
            </div>
          ) : (
            <div className="stack stack--sm">
              <div className="cluster" style={{ gap: 'var(--space-2)' }}>
                <input
                  type="tel"
                  className="field__input"
                  placeholder="请输入手机号"
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                  style={{ maxWidth: '200px' }}
                />
                <Button size="sm" onClick={handleSendSms} loading={smsLoading} disabled={smsSent}>
                  {smsSent ? '已发送' : '发送验证码'}
                </Button>
              </div>
              {smsSent && (
                <div className="cluster" style={{ gap: 'var(--space-2)' }}>
                  <input
                    type="text"
                    className="field__input"
                    placeholder="输入验证码"
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value)}
                    style={{ maxWidth: '150px' }}
                  />
                  <Button size="sm" variant="secondary" onClick={handleVerifySms} loading={smsLoading}>
                    验证
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Notifications */}
        <Card>
          <div className="card__header">
            <CardTitle>
              通知 {unreadCount > 0 && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', marginLeft: 'var(--space-2)' }}>
                  ({unreadCount})
                </span>
              )}
            </CardTitle>
            {unreadCount > 0 && (
              <Button size="sm" variant="ghost" onClick={handleMarkAllRead}>
                全部已读
              </Button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', padding: 'var(--space-4) 0' }}>暂无通知</p>
          ) : (
            <div className="stack stack--sm" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {notifications.slice(0, 20).map((n) => (
                <div
                  key={n.id}
                  style={{
                    padding: 'var(--space-3)',
                    borderBottom: '1px solid var(--color-border)',
                    background: n.is_read ? 'transparent' : 'var(--color-info-bg)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div className="cluster cluster--spread">
                    <span style={{ fontWeight: n.is_read ? 'var(--weight-normal)' : 'var(--weight-semibold)' }}>
                      {n.title}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {new Date(n.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>
                    {n.content}
                  </p>
                  {!n.is_read && (
                    <Button size="sm" variant="ghost" onClick={() => handleMarkNotificationRead(n.id)}>
                      标记已读
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Active Sessions */}
        <Card>
          <CardTitle>活跃会话</CardTitle>
          <ResponsiveTable
            columns={[
              { header: 'IP', accessor: 'ip', render: (s) => s.ip_address },
              { header: '设备', accessor: 'device', render: (s) => s.device_info || '未知' },
              { header: '最近活跃', accessor: 'last_active', render: (s) => new Date(s.last_active_at).toLocaleString('zh-CN') },
              {
                header: '状态',
                accessor: 'status',
                render: (s) =>
                  s.is_current ? (
                    <span style={{ color: 'var(--color-success)' }}>当前</span>
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)' }}>活跃</span>
                  ),
              },
            ]}
            data={sessions}
            keyExtractor={(s) => s.id}
            emptyMessage="暂无活跃会话"
          />
        </Card>

        {/* Login Logs */}
        <Card>
          <CardTitle>登录记录</CardTitle>
          <div id="login-logs-container" data-testid="login-logs-container">
            {loginLogs.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', padding: 'var(--space-4) 0' }}>暂无登录记录</p>
            ) : (
              <div className="stack stack--sm">
                {loginLogs.slice(0, 20).map((log) => (
                  <div key={log.id} className="log-item" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'var(--space-2) 0',
                    borderBottom: '1px solid var(--color-border)',
                    fontSize: 'var(--text-sm)',
                  }}>
                    <div>
                      <span style={{ marginRight: 'var(--space-3)' }}>{log.ip}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{log.device || '未知设备'}</span>
                    </div>
                    <div className="cluster" style={{ gap: 'var(--space-2)' }}>
                      <span style={{
                        fontSize: 'var(--text-xs)',
                        padding: 'var(--space-1) var(--space-2)',
                        background: log.login_type === 'oauth' ? 'var(--color-info-bg)' : 'var(--color-bg-sunken)',
                        borderRadius: 'var(--radius-sm)',
                      }}>
                        {log.login_type === 'oauth' ? 'OAuth' : 'Web'}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                        {new Date(log.created_at).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Authorized Apps */}
        <Card>
          <CardTitle>授权应用</CardTitle>
          <div id="authorizations-container" data-testid="authorizations-container">
            {authorizations.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', padding: 'var(--space-4) 0' }}>暂无授权应用</p>
            ) : (
              <ResponsiveTable
                columns={[
                  { header: '应用', accessor: 'name', render: (a) => a.client_name },
                  { header: '权限', accessor: 'scope', render: (a) => a.scope },
                  { header: '授权时间', accessor: 'created', render: (a) => new Date(a.created_at).toLocaleDateString('zh-CN') },
                  {
                    header: '最近使用',
                    accessor: 'last_used',
                    render: (a) => a.last_used_at ? new Date(a.last_used_at).toLocaleDateString('zh-CN') : '—',
                  },
                ]}
                data={authorizations}
                keyExtractor={(a) => a.id}
                emptyMessage="暂无授权应用"
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
