import { useResource } from '@/api/useResource';
import api from '@/api/client';
import { Link } from 'react-router-dom';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';

interface RiskData {
  needs_attention: { locked_accounts: number; banned_users: number; email_policy_hits_24h: number; high_failure_ips: number; active_ip_rules: number; login_failures_24h: number };
  high_failure_ips: { ip_address: string; failure_count: number; last_failed_at: string }[];
  recent_locks: { user_id: number; username: string | null; ip_address: string; created_at: string }[];
  recent_email_hits: { id: number; email_domain: string; purpose: string; ip_address: string; created_at: string; pattern: string | null }[];
  recent_security_actions: { id: number; admin_id: number; action: string; target_type: string; target_id: number | null; details: unknown; ip_address: string; created_at: string }[];
  recent_bans: { user_id: number; username: string | null; admin_id: number; details: unknown; created_at: string }[];
}

export function AdminRiskPage() {
  const { data, loading, error, reload } = useResource(signal => api.get<{ overview: RiskData }>('/api/admin/overview', { signal }), []);
  if (loading) return <div className="admin-inline-state">正在加载风控数据…</div>;
  if (error || !data) return <section className="admin-state" role="alert"><h1>风控数据暂时不可用</h1><p>{error?.message || '无法获取风控数据'}</p><Button size="sm" variant="secondary" onClick={() => reload()}>重试</Button></section>;
  const risk = data.overview;
  const metrics = [
    ['近 24 小时登录失败', risk.needs_attention.login_failures_24h],
    ['当前锁定账户', risk.needs_attention.locked_accounts], ['近 24 小时邮箱拦截', risk.needs_attention.email_policy_hits_24h],
    ['当前封禁账户', risk.needs_attention.banned_users], ['有效 IP 规则', risk.needs_attention.active_ip_rules],
  ] as const;
  return <div className="admin-page"><div className="admin-page-heading"><div><h1 className="admin-page-title">风控中心</h1><p className="admin-page-lead">展示可核实的登录失败、锁定、邮箱拦截和管理员处置数据。</p></div></div>
    <section className="admin-metrics admin-metrics--five">{metrics.map(([label, value]) => <div className="admin-metric" key={label}><span>{label}</span><strong>{Number(value).toLocaleString('zh-CN')}</strong></div>)}</section>
    <div className="admin-dashboard-grid">
      <Card><div className="admin-section-heading"><div><h2>高频失败 IP</h2><p>按失败次数排列 · 过去 24 小时</p></div><Link to="/login-logs">登录记录</Link></div>{risk.high_failure_ips.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>IP</th><th>失败次数</th><th>最近失败</th></tr></thead><tbody>{risk.high_failure_ips.map(row => <tr key={row.ip_address}><td><code>{row.ip_address || '未知 IP'}</code></td><td>{row.failure_count}</td><td>{new Date(row.last_failed_at).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div> : <div className="admin-inline-state">近 24 小时没有登录失败记录</div>}</Card>
      <Card><div className="admin-section-heading"><div><h2>最近锁定账户</h2><p>过去 24 小时自动锁定事件</p></div><Link to="/users?locked=true">查看用户</Link></div>{risk.recent_locks.length ? <div className="admin-compact-list">{risk.recent_locks.map((row, index) => <div key={`${row.user_id}-${row.created_at}-${index}`}><Link to={`/users/${row.user_id}`}>{row.username || `用户 ${row.user_id}`}</Link><code>{row.ip_address || '未知 IP'}</code><time>{new Date(row.created_at).toLocaleString('zh-CN')}</time></div>)}</div> : <div className="admin-inline-state">没有近期锁定事件</div>}</Card>
    </div>
    <div className="admin-dashboard-grid admin-dashboard-grid--secondary">
      <Card><div className="admin-section-heading"><div><h2>邮箱策略拦截</h2><p>仅展示域名和流程，不存完整邮箱地址</p></div><Link to="/email-policy">邮箱策略</Link></div>{risk.recent_email_hits.length ? <div className="admin-compact-list">{risk.recent_email_hits.map(row => <div key={row.id}><strong>{row.email_domain}</strong><span>{row.pattern ? `规则：${row.pattern}` : '白名单模式未命中'}</span><small>{row.purpose} · {row.ip_address || '未知 IP'}</small><time>{new Date(row.created_at).toLocaleString('zh-CN')}</time></div>)}</div> : <div className="admin-inline-state">近 24 小时没有邮箱拦截</div>}</Card>
      <Card><div className="admin-section-heading"><div><h2>管理员安全操作</h2><p>封禁、解锁、会话和授权处置</p></div><Link to="/admin-logs">完整管理日志</Link></div>{risk.recent_security_actions.length ? <div className="admin-compact-list">{risk.recent_security_actions.map(item => <div key={item.id}><strong>{item.action}</strong><span>{item.target_type} {item.target_id || ''} · 管理员 {item.admin_id}</span><time>{new Date(item.created_at).toLocaleString('zh-CN')}</time></div>)}</div> : <div className="admin-inline-state">暂无近期管理员安全操作</div>}</Card>
      <Card><div className="admin-section-heading"><div><h2>最近封禁用户</h2><p>管理员近 24 小时处置记录</p></div><Link to="/users?ban_status=banned">封禁用户</Link></div>{risk.recent_bans.length ? <div className="admin-compact-list">{risk.recent_bans.map((row, index) => <div key={`${row.user_id}-${row.created_at}-${index}`}><Link to={`/users/${row.user_id}`}>{row.username || `用户 ${row.user_id}`}</Link><span>管理员 {row.admin_id}</span><time>{new Date(row.created_at).toLocaleString('zh-CN')}</time></div>)}</div> : <div className="admin-inline-state">近 24 小时没有管理员封禁记录</div>}</Card>
    </div>
    <p className="admin-data-note">IP 封禁规则目前不记录命中事件，因此本页提供有效规则数，不显示未经采集的 IP 命中次数。</p>
  </div>;
}
