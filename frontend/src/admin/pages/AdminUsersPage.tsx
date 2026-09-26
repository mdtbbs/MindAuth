import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useResource } from '@/api/useResource';
import { useDebouncedValue } from '@/shared/useDebouncedValue';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
import type { AdminUserListItem, PaginationData } from '@/api/types';

type Action = 'ban' | 'mute' | 'unban' | 'unlock' | 'delete' | 'reset';

function isLocked(user: AdminUserListItem) {
  return Number(user.lock_level) > 0 && (!user.locked_until || new Date(user.locked_until).getTime() > Date.now());
}

export function AdminUsersPage() {
  const [searchParams] = useSearchParams();
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [emailVerified, setEmailVerified] = useState(searchParams.get('email_verified') || '');
  const [banStatus, setBanStatus] = useState(searchParams.get('ban_status') || '');
  const [locked, setLocked] = useState(searchParams.get('locked') || '');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('24h');
  const [customHours, setCustomHours] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useDebouncedValue(search, 300);

  useEffect(() => { setPage(1); }, [q, role, emailVerified, banStatus, locked, createdFrom, createdTo]);

  const { data, loading, error, reload } = useResource(signal => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (q.trim()) params.set('search', q.trim());
    if (role) params.set('role', role);
    if (emailVerified) params.set('email_verified', emailVerified);
    if (banStatus) params.set('ban_status', banStatus);
    if (locked) params.set('locked', locked);
    if (createdFrom) params.set('created_from', createdFrom);
    if (createdTo) params.set('created_to', createdTo);
    return api.get<{ users: AdminUserListItem[]; pagination: PaginationData }>(`/api/admin/users?${params}`, { signal });
  }, [page, q, role, emailVerified, banStatus, locked, createdFrom, createdTo]);

  const users = data?.users || [];
  const pagination = data?.pagination;

  async function runAction() {
    if (!selectedUser || !action) return;
    if ((action === 'ban' || action === 'mute') && !reason.trim()) { toast('error', '请填写处置原因'); return; }
    if ((action === 'ban' || action === 'mute') && duration === 'custom' && (!Number.isInteger(Number(customHours)) || Number(customHours) < 1 || Number(customHours) > 8760)) { toast('error', '自定义时长须为 1 至 8760 小时'); return; }
    setBusy(true);
    try {
      const url = `/api/admin/users/${selectedUser.id}`;
      if (action === 'ban' || action === 'mute') {
        const selectedDuration = duration === 'custom' ? `${Number(customHours)}h` : duration;
        await api.post(`${url}/${action}`, { reason: reason.trim(), duration: selectedDuration });
      } else if (action === 'unban') await api.del(`${url}/ban`);
      else if (action === 'unlock') await api.post(`${url}/unlock`);
      else if (action === 'delete') await api.del(url);
      else await api.post(`${url}/reset-password`);
      toast('success', action === 'ban' ? '用户已封禁' : action === 'mute' ? '用户已禁言' : action === 'unban' ? '用户已解封' : action === 'unlock' ? '账号已解锁' : action === 'delete' ? '用户已删除' : '密码重置请求已提交');
      setAction(null); setSelectedUser(null); setReason(''); await reload();
    } catch (err) { toast('error', err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }

  async function immediateAction(user: AdminUserListItem, actionName: Action) {
    setSelectedUser(user); setAction(actionName); setReason('');
  }

  function status(user: AdminUserListItem) {
    if (user.ban_status === 'banned') return <span className="admin-badge is-danger">已封禁</span>;
    if (user.ban_status === 'muted') return <span className="admin-badge is-warning">已禁言</span>;
    if (isLocked(user)) return <span className="admin-badge is-warning">已锁定</span>;
    return <span className="admin-badge is-success">正常</span>;
  }

  function rowMenu(user: AdminUserListItem) {
    return <details className="admin-row-menu"><summary aria-label={`用户 ${user.username} 的操作`}>•••</summary><div className="admin-row-menu__items">
      <Link to={`/users/${user.id}`}>查看详情</Link>
      {hasPermission('users.ban') && user.ban_status === 'none' && <button type="button" onClick={() => void immediateAction(user, 'ban')}>封禁</button>}
      {hasPermission('users.ban') && user.ban_status !== 'none' && <button type="button" onClick={() => void immediateAction(user, 'unban')}>解封</button>}
      {hasPermission('users.ban') && user.ban_status === 'none' && <button type="button" onClick={() => void immediateAction(user, 'mute')}>禁言</button>}
      {hasPermission('users.unlock') && isLocked(user) && <button type="button" onClick={() => void immediateAction(user, 'unlock')}>解除锁定</button>}
      {hasPermission('users.reset_password') && <button type="button" onClick={() => void immediateAction(user, 'reset')}>重置密码</button>}
      {hasPermission('users.delete') && <button type="button" className="is-danger" onClick={() => void immediateAction(user, 'delete')}>删除用户</button>}
    </div></details>;
  }

  return <div className="admin-page">
    <div className="admin-page-heading"><div><h1 className="admin-page-title">用户</h1><p className="admin-page-lead">查找账户并处理安全和访问问题。</p></div></div>
    <Card>
      <form className="admin-user-filters" onSubmit={e => e.preventDefault()}>
        <label className="admin-search admin-user-search"><span className="sr-only">搜索用户名、邮箱或用户 ID</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索用户名 / 邮箱 / 用户 ID / IP" /></label>
        <label><span className="sr-only">用户角色</span><select value={role} onChange={e => setRole(e.target.value)}><option value="">全部角色</option><option value="user">普通用户</option><option value="moderator">版主</option><option value="admin">管理员</option><option value="user_admin">用户管理员</option><option value="security_admin">安全管理员</option><option value="config_admin">配置管理员</option><option value="readonly_admin">只读管理员</option></select></label>
        <label><span className="sr-only">邮箱验证</span><select value={emailVerified} onChange={e => setEmailVerified(e.target.value)}><option value="">邮箱状态</option><option value="true">已验证</option><option value="false">未验证</option></select></label>
        <label><span className="sr-only">封禁状态</span><select value={banStatus} onChange={e => setBanStatus(e.target.value)}><option value="">封禁状态</option><option value="none">未处置</option><option value="muted">禁言</option><option value="banned">封禁</option></select></label>
        <label><span className="sr-only">锁定状态</span><select value={locked} onChange={e => setLocked(e.target.value)}><option value="">锁定状态</option><option value="true">已锁定</option><option value="false">未锁定</option></select></label>
        <label className="admin-date-filter"><span>注册自</span><input type="date" value={createdFrom} onChange={e => setCreatedFrom(e.target.value)} /></label>
        <label className="admin-date-filter"><span>至</span><input type="date" value={createdTo} onChange={e => setCreatedTo(e.target.value)} /></label>
      </form>
    </Card>
    <Card>
      {loading ? <div className="admin-inline-state">正在加载用户…</div> : error ? <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{error.message || '获取用户列表失败'}</p><Button size="sm" variant="secondary" onClick={() => reload()}>重试</Button></div> : users.length === 0 ? <div className="admin-inline-state">没有匹配的用户</div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>ID</th><th>用户</th><th>邮箱</th><th>角色</th><th>状态</th><th>注册时间</th><th>最近活动</th><th>操作</th></tr></thead><tbody>{users.map(user => <tr key={user.id}>
        <td><code>{user.id}</code></td><td><Link className="admin-user-link" to={`/users/${user.id}`}>{user.username}</Link><small className="admin-cell-sub">{user.last_ip || '无登录 IP'}</small></td><td><span>{user.email}</span><small className="admin-cell-sub">{user.email_verified ? '邮箱已验证' : '邮箱未验证'}</small></td><td>{user.role === 'admin' ? 'super_admin' : user.role}</td><td>{status(user)}</td><td>{new Date(user.created_at).toLocaleDateString('zh-CN')}</td><td>{user.last_login_at ? new Date(user.last_login_at).toLocaleString('zh-CN') : '—'}</td><td>{rowMenu(user)}</td>
      </tr>)}</tbody></table></div>}
      {pagination && pagination.totalPages > 1 && <div className="admin-pagination"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</Button><span>第 {page} / {pagination.totalPages} 页，共 {pagination.total} 人</span><Button size="sm" variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button></div>}
    </Card>

    <Dialog open={Boolean(action)} onClose={() => setAction(null)} title={action === 'ban' ? '封禁用户' : action === 'mute' ? '禁言用户' : action === 'unban' ? '解除处置' : action === 'unlock' ? '解除锁定' : action === 'reset' ? '重置密码' : '删除用户'} footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setAction(null)}>取消</Button><Button variant={action === 'delete' || action === 'ban' || action === 'mute' ? 'danger' : 'primary'} onClick={runAction} loading={busy}>确认</Button></div>}>
      <div className="admin-form-stack"><p>账户：<strong>{selectedUser?.username}</strong>（ID {selectedUser?.id}）</p>
        {(action === 'ban' || action === 'mute') && <><label className="field"><span className="field__label">原因（必填）</span><textarea rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><label className="field"><span className="field__label">时长</span><select value={duration} onChange={e => setDuration(e.target.value)}><option value="1h">1 小时</option><option value="24h">24 小时</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="permanent">永久</option><option value="custom">自定义</option></select></label>{duration === 'custom' && <label className="field"><span className="field__label">小时数</span><input type="number" min="1" max="8760" value={customHours} onChange={e => setCustomHours(e.target.value)} /></label>}</>}
        {action === 'reset' && <p>系统会生成临时密码并发送到用户邮箱。临时密码不会在后台显示。</p>}
        {action === 'delete' && <div className="admin-danger-note"><strong>此操作无法恢复。</strong><p>将删除账户、OAuth 授权、令牌、登录记录、自定义资料和会话，并撤销相关设备登录。</p></div>}
        {action === 'unlock' && <p>确认清除该账户当前的自动锁定状态？</p>}
        {action === 'unban' && <p>确认解除该账户的封禁或禁言状态？</p>}
      </div>
    </Dialog>
  </div>;
}
