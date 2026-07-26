import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle, CardDescription } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { ResponsiveTable } from '@/shared/ResponsiveTable';
import { AccountShell } from '@/user/components/AccountShell';
import type {
  Session,
  Notification,
  LoginLog,
  Authorization,
  UnreadCount,
} from '@/api/types';

const DASHBOARD_NAV = [
  { key: 'overview', label: '概览', href: '/dashboard' },
  { key: 'settings', label: '账户设置', href: '/account-settings' },
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN');
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

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

  const [smsPhone, setSmsPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

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
        api.get<{ success: boolean; authorizations: Authorization[] }>('/api/authorizations'),
        api.get<UnreadCount>('/api/notifications/unread-count'),
      ]);

      if (sessRes.status === 'fulfilled') setSessions(sessRes.value.sessions || []);
      if (notifsRes.status === 'fulfilled') setNotifications(notifsRes.value.notifications || []);
      if (logsRes.status === 'fulfilled') setLoginLogs(logsRes.value.logs || []);
      if (unreadRes.status === 'fulfilled') setUnreadCount(unreadRes.value.count || 0);
      if (authsRes.status === 'fulfilled') setAuthorizations(authsRes.value.authorizations || []);
    } catch {}
  }, []);

  useEffect(() => {
    if (user) {
      setPhoneStatus({ phone: user.phone_masked, verified: user.phone_verified });
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
      setSmsPhone('');
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
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
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
      <div className="page--auth auth-shell__main">
        <div className="empty-state">加载中...</div>
      </div>
    );
  }

  const securityScore = [user.email_verified, phoneStatus.verified, sessions.length > 0].filter(Boolean).length;

  return (
    <AccountShell
      user={user}
      title="账户概览"
      description="集中查看您的账户信息、登录状态、通知、会话与授权应用。"
      navItems={DASHBOARD_NAV}
      activeNavKey="overview"
      headerActions={
        <>
          <Button variant="secondary" size="sm" onClick={() => navigate('/account-settings')}>
            账户设置
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="logout-btn">
            退出登录
          </Button>
        </>
      }
      heroActions={
        <>
          {!user.email_verified ? (
            <Button variant="primary" onClick={handleSendVerificationEmail}>
              发送验证邮件
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => navigate('/account-settings')}>
            管理账户设置
          </Button>
        </>
      }
    >
      <div className="account-overview-grid">
        <div className="stat-card">
          <div className="stat-card__label">未读通知</div>
          <div className="stat-card__value">{unreadCount}</div>
          <div className="stat-card__hint">关注系统提醒与安全消息</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">活跃会话</div>
          <div className="stat-card__value">{sessions.length}</div>
          <div className="stat-card__hint">当前设备与近期访问会话</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">授权应用</div>
          <div className="stat-card__value">{authorizations.length}</div>
          <div className="stat-card__hint">已通过 MindAuth 授权的应用</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">安全状态</div>
          <div className="stat-card__value">{securityScore}/3</div>
          <div className="stat-card__hint">邮箱、手机号与会话状态概览</div>
        </div>
      </div>

      <div className="account-card-grid">
        <Card>
          <CardTitle>我的账户</CardTitle>
          <CardDescription>查看基础资料与当前认证状态。</CardDescription>
          <div className="account-summary-grid" style={{ marginTop: 'var(--space-5)' }}>
            <div className="summary-card">
              <div className="summary-card__label">用户名</div>
              <div id="username-display" data-testid="username-display" className="summary-card__value">
                {user.username}
              </div>
              <div className="summary-card__meta">角色：{user.role === 'admin' ? '管理员' : '用户'}</div>
            </div>
            <div className="summary-card">
              <div className="summary-card__label">邮箱状态</div>
              <div className="summary-card__value">{user.email_verified ? '已验证' : '待验证'}</div>
              <div id="verified-badge" data-testid="verified-badge" className="summary-card__meta text-truncate">
                {user.email}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card__label">注册时间</div>
              <div className="summary-card__value">{formatDate(user.created_at)}</div>
              <div className="summary-card__meta">最近登录见下方记录</div>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>手机号绑定</CardTitle>
          <CardDescription>用于提升账户安全性与恢复能力。</CardDescription>
          <div className="info-list" style={{ marginTop: 'var(--space-5)' }}>
            {phoneStatus.phone ? (
              <div className="info-row">
                <div className="info-row__main">
                  <span className={`info-row__icon ${phoneStatus.verified ? 'info-row__icon--success' : 'info-row__icon--warning'}`}>📱</span>
                  <div className="info-row__content">
                    <div className="info-row__label">已绑定手机号</div>
                    <div className="info-row__value">{phoneStatus.phone}</div>
                    <div className="info-row__meta">{phoneStatus.verified ? '当前手机号已验证。' : '当前手机号尚未验证。'}</div>
                  </div>
                </div>
                <div className="info-row__actions">
                  <span className={`status-badge ${phoneStatus.verified ? 'status-badge--success' : 'status-badge--warning'}`}>
                    {phoneStatus.verified ? '已验证' : '待验证'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="stack stack--sm">
                <TextField
                  label="手机号"
                  type="tel"
                  placeholder="请输入手机号"
                  value={smsPhone}
                  onChange={(e) => setSmsPhone(e.target.value)}
                />
                <div className="cluster">
                  <Button onClick={handleSendSms} loading={smsLoading} disabled={smsSent}>
                    {smsSent ? '验证码已发送' : '发送验证码'}
                  </Button>
                </div>
                {smsSent ? (
                  <div className="cluster" style={{ alignItems: 'end' }}>
                    <div style={{ flex: 1, minWidth: '12rem' }}>
                      <TextField
                        label="验证码"
                        type="text"
                        placeholder="输入验证码"
                        value={smsCode}
                        onChange={(e) => setSmsCode(e.target.value)}
                      />
                    </div>
                    <Button variant="secondary" onClick={handleVerifySms} loading={smsLoading}>
                      验证
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="account-card-grid">
        <Card>
          <div className="card__header">
            <div>
              <CardTitle>通知中心</CardTitle>
              <CardDescription>查看平台消息并处理未读通知。</CardDescription>
            </div>
            {unreadCount > 0 ? (
              <Button size="sm" variant="ghost" onClick={handleMarkAllRead}>
                全部已读
              </Button>
            ) : null}
          </div>
          {notifications.length === 0 ? (
            <div className="empty-state">暂无通知</div>
          ) : (
            <div className="notice-list">
              {notifications.slice(0, 6).map((n) => (
                <div key={n.id} className={`notice-item ${n.is_read ? '' : 'notice-item--unread'}`.trim()}>
                  <div className="notice-item__header">
                    <span className="notice-item__title">{n.title}</span>
                    <span className="notice-item__date">{formatDate(n.created_at)}</span>
                  </div>
                  <p className="notice-item__content">{n.content}</p>
                  {!n.is_read ? (
                    <div className="notice-item__footer">
                      <Button size="sm" variant="ghost" onClick={() => handleMarkNotificationRead(n.id)}>
                        标记已读
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>登录记录</CardTitle>
          <CardDescription>按时间查看近期账户访问活动。</CardDescription>
          <div style={{ marginTop: 'var(--space-5)' }}>
            {loginLogs.length === 0 ? (
              <div className="empty-state">暂无登录记录</div>
            ) : (
              <div className="info-list" id="login-logs-container" data-testid="login-logs-container">
                {loginLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="info-row log-item">
                    <div className="info-row__main">
                      <span className={`info-row__icon ${log.login_type === 'oauth' ? 'info-row__icon--info' : 'info-row__icon--primary'}`}>
                        {log.login_type === 'oauth' ? '🔐' : '🖥️'}
                      </span>
                      <div className="info-row__content">
                        <div className="info-row__label">{log.login_type === 'oauth' ? 'OAuth 登录' : 'Web 登录'}</div>
                        <div className="info-row__value">{log.ip}</div>
                        <div className="info-row__meta">{log.device || '未知设备'} · {formatDateTime(log.created_at)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>活跃会话</CardTitle>
        <CardDescription>查看当前设备与最近活跃会话。</CardDescription>
        <div style={{ marginTop: 'var(--space-5)' }}>
          <ResponsiveTable
            columns={[
              { header: 'IP', accessor: 'ip', render: (s) => s.ip_address },
              { header: '设备', accessor: 'device', render: (s) => s.device_info || '未知' },
              { header: '最近活跃', accessor: 'last_active', render: (s) => formatDateTime(s.last_active_at) },
              {
                header: '状态',
                accessor: 'status',
                render: (s) => (
                  <span className={`status-badge ${s.is_current ? 'status-badge--success' : 'status-badge--info'}`}>
                    {s.is_current ? '当前会话' : '活跃'}
                  </span>
                ),
              },
            ]}
            data={sessions}
            keyExtractor={(s) => s.id}
            emptyMessage="暂无活跃会话"
          />
        </div>
      </Card>

      <Card>
        <CardTitle>授权应用</CardTitle>
        <CardDescription>查看已经通过 MindAuth 建立授权关系的应用。</CardDescription>
        <div id="authorizations-container" data-testid="authorizations-container" style={{ marginTop: 'var(--space-5)' }}>
          {authorizations.length === 0 ? (
            <div className="empty-state">暂无授权应用</div>
          ) : (
            <ResponsiveTable
              columns={[
                { header: '应用', accessor: 'name', render: (a) => a.client_name },
                { header: '权限', accessor: 'scope', render: (a) => a.scope },
                { header: '授权时间', accessor: 'created', render: (a) => formatDate(a.created_at) },
                {
                  header: '最近使用',
                  accessor: 'last_used',
                  render: (a) => (a.last_used_at ? formatDate(a.last_used_at) : '—'),
                },
              ]}
              data={authorizations}
              keyExtractor={(a) => a.id}
              emptyMessage="暂无授权应用"
            />
          )}
        </div>
      </Card>
    </AccountShell>
  );
}
