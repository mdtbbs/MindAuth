import { useResource } from '@/api/useResource';
import api from '@/api/client';
import { Link } from 'react-router-dom';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';

interface Overview {
  metrics: { total_users: number; today_registrations: number; active_sessions: number; today_logins: number; today_login_failures: number; today_risk_interceptions: number };
  needs_attention: { pending_applications: number; unverified_new_users: number; locked_accounts: number; banned_users: number; email_policy_hits_24h: number; high_failure_ips: number; active_ip_rules: number };
  high_failure_ips: { ip_address: string; failure_count: number; last_failed_at: string }[];
  recent_locks: { user_id: number; username: string | null; ip_address: string; created_at: string }[];
  recent_email_hits: { id: number; email_domain: string; purpose: string; ip_address: string; created_at: string; pattern: string | null }[];
  recent_security_actions: { id: number; admin_id: number; action: string; target_type: string; target_id: number | null; details: unknown; ip_address: string; created_at: string }[];
  recent_activity: { event_type: string; subject: string; created_at: string; detail: string }[];
}

const formatNumber = (value: number) => Number(value || 0).toLocaleString('zh-CN');

export function AdminDashboardPage() {
  const { data, loading, error, reload } = useResource(signal => api.get<{ overview: Overview }>('/api/admin/overview', { signal }), []);
  const overview = data?.overview;

  if (loading) return <div className="admin-inline-state">正在加载运营数据…</div>;
  if (error || !overview) return <section className="admin-state" role="alert"><h1>总览暂时不可用</h1><p>{error?.message || '无法获取统计数据'}</p><Button size="sm" variant="secondary" onClick={() => reload()}>重试</Button></section>;

  const metrics = [
    ['用户总数', overview.metrics.total_users, '/users'], ['今日注册', overview.metrics.today_registrations, '/users'],
    ['活跃会话', overview.metrics.active_sessions, '/sessions'], ['今日登录', overview.metrics.today_logins, '/login-logs'],
    ['今日登录失败', overview.metrics.today_login_failures, '/risk'], ['今日风控拦截', overview.metrics.today_risk_interceptions, '/risk'],
  ] as const;
  const attention = [
    { label: '待审核应用', value: overview.needs_attention.pending_applications, to: '/applications', note: '等待管理员处理' },
    { label: '未验证的新账户', value: overview.needs_attention.unverified_new_users, to: '/users?email_verified=false', note: '近 7 天注册' },
    { label: '当前锁定账户', value: overview.needs_attention.locked_accounts, to: '/risk', note: '自动锁定状态' },
    { label: '近 24 小时邮箱拦截', value: overview.needs_attention.email_policy_hits_24h, to: '/email-policy', note: '规则命中' },
    { label: '高频失败 IP', value: overview.needs_attention.high_failure_ips, to: '/risk', note: '近 24 小时' },
    { label: '有效 IP 规则', value: overview.needs_attention.active_ip_rules, to: '/ip-rules', note: '当前规则数' },
  ];

  return <div className="admin-page">
    <div className="admin-page-heading"><div><h1 className="admin-page-title">总览</h1><p className="admin-page-lead">账号服务的近期运行情况与待处理事项。</p></div><span className="admin-updated-at">更新于 {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <section className="admin-metrics" aria-label="关键指标">{metrics.map(([label, value, to]) => <Link className="admin-metric" to={to} key={label}><span>{label}</span><strong>{formatNumber(value)}</strong></Link>)}</section>
    <div className="admin-dashboard-grid">
      <Card><div className="admin-section-heading"><div><h2>需要处理</h2><p>近期需要管理员留意的队列与状态</p></div></div><div className="admin-attention-list">{attention.map(item => <Link key={item.label} to={item.to} className="admin-attention-row"><span><strong>{item.label}</strong><small>{item.note}</small></span><b>{formatNumber(item.value)}</b><span aria-hidden="true">›</span></Link>)}</div></Card>
      <Card><div className="admin-section-heading"><div><h2>最近活动</h2><p>过去 24 小时，按发生时间排序</p></div></div>{overview.recent_activity.length ? <ol className="admin-activity-list">{overview.recent_activity.map((activity, index) => <li key={`${activity.event_type}-${activity.created_at}-${index}`}><span className="admin-activity-marker" /><div><strong>{activity.event_type}</strong><p>{activity.subject} <span>· {activity.detail}</span></p></div><time>{new Date(activity.created_at).toLocaleString('zh-CN')}</time></li>)}</ol> : <div className="admin-inline-state">过去 24 小时暂无活动</div>}</Card>
    </div>
    <div className="admin-dashboard-grid admin-dashboard-grid--secondary">
      <Card><div className="admin-section-heading"><div><h2>高频登录失败 IP</h2><p>过去 24 小时</p></div><Link to="/risk">查看风控中心</Link></div>{overview.high_failure_ips.length ? <div className="admin-compact-list">{overview.high_failure_ips.slice(0, 5).map(item => <div key={item.ip_address}><code>{item.ip_address}</code><strong>{formatNumber(item.failure_count)} 次</strong><time>{new Date(item.last_failed_at).toLocaleString('zh-CN')}</time></div>)}</div> : <div className="admin-inline-state">暂无异常频次</div>}</Card>
      <Card><div className="admin-section-heading"><div><h2>最近安全处置</h2><p>管理员动作与邮箱策略拦截</p></div><Link to="/admin-logs">管理日志</Link></div>{overview.recent_security_actions.length || overview.recent_email_hits.length ? <div className="admin-compact-list">{[...overview.recent_security_actions.map(item => ({ label: item.action, detail: `${item.target_type || ''} ${item.target_id || ''} · 管理员 ${item.admin_id}`, at: item.created_at })), ...overview.recent_email_hits.map(item => ({ label: '邮箱策略拦截', detail: `${item.email_domain} · ${item.purpose}`, at: item.created_at }))].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6).map((item, index) => <div key={`${item.label}-${item.at}-${index}`}><strong>{item.label}</strong><span>{item.detail}</span><time>{new Date(item.at).toLocaleString('zh-CN')}</time></div>)}</div> : <div className="admin-inline-state">暂无安全处置记录</div>}</Card>
    </div>
    <p className="admin-data-note">“今日风控拦截”按邮箱策略拒绝和账号自动锁定统计；IP 规则页显示当前有效规则，IP 匹配次数尚未采集。</p>
  </div>;
}
