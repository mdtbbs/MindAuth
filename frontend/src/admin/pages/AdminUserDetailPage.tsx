import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '@/api/client';
import { useResource } from '@/api/useResource';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
import type { AdminUserDetail } from '@/api/types';

interface DetailData {
  user: AdminUserDetail;
  sessions: { id: number | string; session_type: string; ip_address: string; device_info: string; created_at: string; last_active_at: string; expires_at?: string | null }[];
  authorizations: { id: number; client_id: string; client_name: string; scope: string; last_used_at: string | null; created_at: string }[];
  login_logs: { id: number; ip: string; device: string; login_type: string; created_at: string }[];
  notifications: { id: number; type: string; title: string; content: string; is_read: boolean; created_at: string }[];
  audit_logs: { id: number; admin_id: number; action: string; details: unknown; ip_address: string; created_at: string }[];
}
type Tab = 'overview' | 'security' | 'sessions' | 'authorizations' | 'login' | 'notifications' | 'audit';

export function AdminUserDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<'ban' | 'mute' | 'delete' | 'password' | 'email' | 'role' | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('24h');
  const [customHours, setCustomHours] = useState('');
  const [email, setEmail] = useState('');
  const [overridePolicy, setOverridePolicy] = useState(false);
  const [role, setRole] = useState('user');
  const { data, loading, error, reload } = useResource(signal => api.get<DetailData>(`/api/admin/users/${id}`, { signal }), [id]);
  const user = data?.user;

  const allTabs: { id: Tab; label: string; permission: string }[] = [
    { id: 'overview', label: '概览', permission: 'users.read' }, { id: 'security', label: '安全', permission: 'users.read' },
    { id: 'sessions', label: '会话', permission: 'sessions.read' }, { id: 'authorizations', label: 'OAuth 授权', permission: 'authorizations.read' },
    { id: 'login', label: '登录记录', permission: 'login_logs.read' }, { id: 'notifications', label: '通知', permission: 'users.read' },
    { id: 'audit', label: '审计', permission: 'audit_logs.read' },
  ];
  const tabs = allTabs.filter(item => hasPermission(item.permission));

  async function mutate(url: string, method: 'post' | 'put' | 'del', body?: unknown, message = '操作已完成') {
    setBusy(true);
    try {
      if (method === 'post') await api.post(url, body);
      else if (method === 'put') await api.put(url, body);
      else await api.del(url);
      toast('success', message); setDialog(null); setReason(''); await reload();
    } catch (err) { toast('error', err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }

  async function submitDialog() {
    if (!user || !dialog) return;
    const base = `/api/admin/users/${user.id}`;
    if (dialog === 'ban' || dialog === 'mute') {
      if (!reason.trim()) { toast('error', '请填写处置原因'); return; }
      if (duration === 'custom' && (!Number.isInteger(Number(customHours)) || Number(customHours) < 1 || Number(customHours) > 8760)) { toast('error', '自定义时长须为 1 至 8760 小时'); return; }
      const finalDuration = duration === 'custom' ? `${Number(customHours)}h` : duration;
      await mutate(`${base}/${dialog}`, 'post', { reason: reason.trim(), duration: finalDuration }, dialog === 'ban' ? '用户已封禁' : '用户已禁言');
    } else if (dialog === 'delete') {
      await mutate(base, 'del', undefined, '用户已删除'); navigate('/users');
    } else if (dialog === 'password') await mutate(`${base}/reset-password`, 'post', undefined, '密码重置请求已提交');
    else if (dialog === 'email') await mutate(`${base}/email`, 'put', { email, override_policy: overridePolicy }, '验证邮件已发送；用户完成验证后邮箱才会更新');
    else if (dialog === 'role') await mutate(base, 'put', { role }, '用户角色已更新');
  }

  if (loading) return <div className="admin-inline-state">正在加载用户资料…</div>;
  if (error || !user) return <section className="admin-state" role="alert"><h1>无法加载用户</h1><p>{error?.message || '用户不存在'}</p><div className="cluster"><Button size="sm" variant="secondary" onClick={() => reload()}>重试</Button><Link className="btn btn--ghost" to="/users">返回用户列表</Link></div></section>;

  const accountState = user.ban_status === 'banned' ? '已封禁' : user.ban_status === 'muted' ? '已禁言' : user.lock_level > 0 ? '已锁定' : '正常';
  const isAdminAccount = ['admin', 'super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin'].includes(user.role);

  return <div className="admin-page">
    <Link className="admin-back-link" to="/users">← 用户列表</Link>
    <div className="admin-page-heading"><div><h1 className="admin-page-title">{user.username}</h1><p className="admin-page-lead">ID {user.id} · {user.email} · {user.role === 'admin' ? 'super_admin' : user.role} · 注册于 {new Date(user.created_at).toLocaleString('zh-CN')}</p></div><span className={`admin-badge ${accountState === '正常' ? 'is-success' : 'is-danger'}`}>{accountState}</span></div>
    <div className="admin-tabs" role="tablist" aria-label="用户详情分区">{tabs.map(item => <button type="button" role="tab" key={item.id} aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>

    {tab === 'overview' && <div className="admin-detail-grid"><Card><h2>账户资料</h2><dl className="admin-detail-list"><div><dt>用户名</dt><dd>{user.username}</dd></div><div><dt>邮箱</dt><dd>{user.email} {user.email_verified ? <span className="admin-badge is-success">已验证</span> : <span className="admin-badge is-warning">未验证</span>}</dd></div><div><dt>手机号</dt><dd>{user.phone || '未绑定'} {user.phone_verified ? '（已验证）' : ''}</dd></div><div><dt>角色</dt><dd>{user.role === 'admin' ? 'super_admin' : user.role}</dd></div><div><dt>注册时间</dt><dd>{new Date(user.created_at).toLocaleString('zh-CN')}</dd></div><div><dt>账号状态</dt><dd>{accountState}</dd></div><div><dt>封禁原因</dt><dd>{user.ban_reason || '—'}</dd></div><div><dt>封禁到期</dt><dd>{user.ban_expires_at ? new Date(user.ban_expires_at).toLocaleString('zh-CN') : user.ban_status === 'banned' ? '永久' : '—'}</dd></div><div><dt>锁定到期</dt><dd>{user.locked_until ? new Date(user.locked_until).toLocaleString('zh-CN') : '—'}</dd></div></dl></Card>
      <Card><h2>最近活动</h2>{data.login_logs[0] ? <dl className="admin-detail-list"><div><dt>最近登录</dt><dd>{new Date(data.login_logs[0].created_at).toLocaleString('zh-CN')}</dd></div><div><dt>IP</dt><dd><code>{data.login_logs[0].ip}</code></dd></div><div><dt>设备</dt><dd>{data.login_logs[0].device || '—'}</dd></div></dl> : <p>暂无登录记录</p>}</Card></div>}

    {tab === 'security' && <Card><h2>安全操作</h2><div className="admin-action-grid">
      {hasPermission('sessions.revoke') && <Button variant="secondary" disabled={!data.sessions.length || busy} onClick={() => void mutate(`/api/admin/users/${user.id}/sessions`, 'del', undefined, '全部会话已注销')}>强制登出全部设备</Button>}
      {hasPermission('authorizations.revoke') && <Button variant="secondary" disabled={!data.authorizations.length || busy} onClick={() => void mutate(`/api/admin/users/${user.id}/authorizations`, 'del', undefined, '全部 OAuth 授权已撤销')}>撤销全部 OAuth 授权</Button>}
      {hasPermission('users.unlock') && user.lock_level > 0 && <Button variant="secondary" onClick={() => void mutate(`/api/admin/users/${user.id}/unlock`, 'post', undefined, '账号已解锁')}>解除锁定</Button>}
      {hasPermission('users.write') && !user.email_verified && <Button variant="secondary" onClick={() => void mutate(`/api/admin/users/${user.id}/email-verification/send`, 'post', undefined, '验证邮件已发送')}>重发邮箱验证</Button>}
      {hasPermission('users.write') && <><Button variant="secondary" onClick={() => void mutate(`/api/admin/users/${user.id}`, 'put', { email_verified: !user.email_verified }, user.email_verified ? '邮箱已标记为未验证' : '邮箱已标记为已验证')}>{user.email_verified ? '标记邮箱未验证' : '标记邮箱已验证'}</Button><Button variant="secondary" onClick={() => { setEmail(user.email); setOverridePolicy(false); setDialog('email'); }}>修改邮箱</Button></>}
      {hasPermission('users.reset_password') && <Button variant="secondary" onClick={() => setDialog('password')}>重置密码</Button>}
      {(hasPermission('users.write') || hasPermission('admins.write')) && <Button variant="secondary" onClick={() => { setRole(user.role === 'admin' ? 'super_admin' : user.role); setDialog('role'); }}>修改角色</Button>}
      {hasPermission('users.ban') && user.ban_status === 'none' && <><Button variant="danger" onClick={() => { setReason(''); setDialog('ban'); }}>封禁用户</Button><Button variant="secondary" onClick={() => { setReason(''); setDialog('mute'); }}>禁言用户</Button></>}
      {hasPermission('users.ban') && user.ban_status !== 'none' && <Button variant="secondary" onClick={() => void mutate(`/api/admin/users/${user.id}/ban`, 'del', undefined, '用户已解封')}>解除封禁 / 禁言</Button>}
      {hasPermission('users.delete') && <Button variant="danger" onClick={() => setDialog('delete')}>删除用户</Button>}
    </div></Card>}

    {tab === 'sessions' && <Card><div className="admin-section-heading"><h2>登录会话</h2>{hasPermission('sessions.revoke') && <Button size="sm" variant="secondary" disabled={!data.sessions.length || busy} onClick={() => void mutate(`/api/admin/users/${user.id}/sessions`, 'del', undefined, '全部会话已注销')}>注销全部会话</Button>}</div>{data.sessions.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>设备</th><th>类型</th><th>IP</th><th>创建时间</th><th>最近活动</th><th>到期时间</th>{hasPermission('sessions.revoke') && <th>操作</th>}</tr></thead><tbody>{data.sessions.map(session => <tr key={session.id}><td>{session.device_info || '未知设备'}</td><td>{session.session_type}</td><td><code>{session.ip_address || '—'}</code></td><td>{new Date(session.created_at).toLocaleString('zh-CN')}</td><td>{new Date(session.last_active_at).toLocaleString('zh-CN')}</td><td>{session.expires_at ? new Date(session.expires_at).toLocaleString('zh-CN') : '—'}</td>{hasPermission('sessions.revoke') && <td><button className="admin-text-action is-danger" onClick={() => void mutate(`/api/admin/users/${user.id}/sessions/${encodeURIComponent(session.id)}`, 'del', undefined, '会话已注销')}>注销</button></td>}</tr>)}</tbody></table></div> : <div className="admin-inline-state">没有活动会话</div>}</Card>}

    {tab === 'authorizations' && <Card><div className="admin-section-heading"><h2>OAuth 授权</h2>{hasPermission('authorizations.revoke') && <Button size="sm" variant="secondary" disabled={!data.authorizations.length || busy} onClick={() => void mutate(`/api/admin/users/${user.id}/authorizations`, 'del', undefined, '全部 OAuth 授权已撤销')}>撤销全部授权</Button>}</div>{data.authorizations.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>应用</th><th>Client ID</th><th>Scope</th><th>授权时间</th><th>最近使用</th>{hasPermission('authorizations.revoke') && <th>操作</th>}</tr></thead><tbody>{data.authorizations.map(item => <tr key={item.id}><td>{item.client_name || '未知应用'}</td><td><code>{item.client_id}</code></td><td>{item.scope}</td><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td>{item.last_used_at ? new Date(item.last_used_at).toLocaleString('zh-CN') : '—'}</td>{hasPermission('authorizations.revoke') && <td><button className="admin-text-action is-danger" onClick={() => void mutate(`/api/admin/authorizations/${item.id}`, 'del', undefined, 'OAuth 授权已撤销')}>撤销</button></td>}</tr>)}</tbody></table></div> : <div className="admin-inline-state">没有 OAuth 授权</div>}</Card>}

    {tab === 'login' && <Card>{data.login_logs.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>时间</th><th>类型</th><th>IP</th><th>设备</th></tr></thead><tbody>{data.login_logs.map(item => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td>{item.login_type}</td><td><code>{item.ip}</code></td><td>{item.device || '—'}</td></tr>)}</tbody></table></div> : <div className="admin-inline-state">暂无登录记录</div>}</Card>}
    {tab === 'notifications' && <Card>{data.notifications.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>时间</th><th>类型</th><th>标题</th><th>内容</th><th>状态</th></tr></thead><tbody>{data.notifications.map(item => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td>{item.type}</td><td>{item.title}</td><td>{item.content}</td><td>{item.is_read ? '已读' : '未读'}</td></tr>)}</tbody></table></div> : <div className="admin-inline-state">暂无通知</div>}</Card>}
    {tab === 'audit' && <Card>{data.audit_logs.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>IP</th><th>详情</th></tr></thead><tbody>{data.audit_logs.map(item => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td>{item.admin_id}</td><td>{item.action}</td><td><code>{item.ip_address}</code></td><td><details><summary>查看</summary><pre className="admin-json-detail">{JSON.stringify(item.details, null, 2)}</pre></details></td></tr>)}</tbody></table></div> : <div className="admin-inline-state">暂无管理审计</div>}</Card>}

    <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} title={dialog === 'ban' ? '封禁用户' : dialog === 'mute' ? '禁言用户' : dialog === 'delete' ? '删除用户' : dialog === 'email' ? '修改邮箱' : dialog === 'role' ? '修改角色' : '重置密码'} footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setDialog(null)}>取消</Button><Button variant={dialog === 'delete' || dialog === 'ban' || dialog === 'mute' ? 'danger' : 'primary'} loading={busy} onClick={() => void submitDialog()}>确认</Button></div>}>
      <div className="admin-form-stack"><p>账户：<strong>{user.username}</strong>（ID {user.id}）</p>
        {(dialog === 'ban' || dialog === 'mute') && <><label className="field"><span className="field__label">原因（必填）</span><textarea rows={3} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label><label className="field"><span className="field__label">时长</span><select value={duration} onChange={e => setDuration(e.target.value)}><option value="1h">1 小时</option><option value="24h">24 小时</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="permanent">永久</option><option value="custom">自定义</option></select></label>{duration === 'custom' && <label className="field"><span className="field__label">小时数</span><input type="number" min="1" max="8760" value={customHours} onChange={e => setCustomHours(e.target.value)} /></label>}</>}
        {dialog === 'delete' && <div className="admin-danger-note"><strong>此操作不可恢复。</strong><p>会删除账户、授权、令牌、登录记录、会话、通知、社交绑定和用户资料字段值。管理员审计记录会按系统保留策略留存。</p></div>}
        {dialog === 'password' && <p>系统会生成临时密码并发送到用户邮箱；后台不会显示临时密码。</p>}
        {dialog === 'email' && <><label className="field"><span className="field__label">新邮箱</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>{hasPermission('admins.write') && <label className="admin-check"><input type="checkbox" checked={overridePolicy} onChange={e => setOverridePolicy(e.target.checked)} />超级管理员明确覆盖邮箱策略</label>}<p className="admin-form-note">新邮箱完成验证后才会替换当前邮箱。</p></>}
        {dialog === 'role' && <><label className="field"><span className="field__label">角色</span><select value={role} onChange={e => setRole(e.target.value)}>{(isAdminAccount || hasPermission('admins.write') ? ['user', 'moderator', 'super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin'] : ['user', 'moderator']).map(value => <option key={value} value={value}>{value}</option>)}</select></label><p className="admin-form-note">管理员角色仅允许超级管理员授予或修改；系统会保护最后一个 super_admin。</p></>}
      </div>
    </Dialog>
  </div>;
}
