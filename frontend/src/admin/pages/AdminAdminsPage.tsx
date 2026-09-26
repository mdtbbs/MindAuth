import { useCallback, useEffect, useState } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';

interface AdminAccount { id: number; username: string; email: string; role: string; permissions: string[]; ban_status: string; lock_level: number; created_at: string; last_login_at: string | null }
const ROLES = ['super_admin', 'user_admin', 'security_admin', 'config_admin', 'readonly_admin'];

export function AdminAdminsPage() {
  const { admin, hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<AdminAccount | null>(null);
  const [role, setRole] = useState('user_admin');
  const [busy, setBusy] = useState(false);
  const canWrite = hasPermission('admins.write');

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try { const result = await api.get<{ admins: AdminAccount[] }>('/api/admin/users/admins', { signal }); setAdmins(result.admins || []); }
    catch (err) { if (err instanceof DOMException && err.name === 'AbortError') return; setError(err instanceof Error ? err.message : '获取管理员失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  function openRole(account: AdminAccount) { setTarget(account); setRole(account.role); }
  async function saveRole() {
    if (!target) return;
    setBusy(true);
    try { await api.put(`/api/admin/users/${target.id}`, { role }); setTarget(null); await load(); toast('success', role === 'user' ? '管理员权限已撤销' : '管理员角色已更新'); }
    catch (err) { toast('error', err instanceof Error ? err.message : '更新管理员失败'); }
    finally { setBusy(false); }
  }

  return <div className="admin-page"><div className="admin-page-heading"><div><h1 className="admin-page-title">管理员</h1><p className="admin-page-lead">管理员账号由用户账号授予角色；变更会立即影响权限并清理失效的管理会话。</p></div></div>
    <Card>{loading ? <div className="admin-inline-state">正在加载管理员…</div> : error ? <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{error}</p><Button size="sm" variant="secondary" onClick={() => load()}>重试</Button></div> : admins.length === 0 ? <div className="admin-inline-state">还没有管理员账号</div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>管理员</th><th>邮箱</th><th>角色</th><th>权限</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>{admins.map(account => <tr key={account.id}><td><strong>{account.username}</strong><small className="admin-cell-sub">ID {account.id}</small></td><td>{account.email}</td><td><span className="admin-badge is-info">{account.role}</span></td><td><div className="admin-permission-list">{account.permissions.includes('*') ? <code>全部权限</code> : account.permissions.map(permission => <code key={permission}>{permission}</code>)}</div></td><td>{account.ban_status === 'banned' ? <span className="admin-badge is-danger">已封禁</span> : account.lock_level > 0 ? <span className="admin-badge is-warning">已锁定</span> : <span className="admin-badge is-success">正常</span>}</td><td>{account.last_login_at ? new Date(account.last_login_at).toLocaleString('zh-CN') : '—'}</td><td>{canWrite ? <button type="button" className="admin-text-action" disabled={account.id === admin?.id} onClick={() => openRole(account)}>{account.id === admin?.id ? '当前账号' : '修改角色'}</button> : '—'}</td></tr>)}</tbody></table></div>}</Card>
    <Dialog open={!!target} onClose={() => setTarget(null)} title={role === 'user' ? '撤销管理员权限' : '设置管理员角色'} footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setTarget(null)}>取消</Button><Button variant={role === 'user' ? 'danger' : 'primary'} loading={busy} onClick={saveRole}>确认</Button></div>}>
      {target && <div className="admin-form-stack"><p>账号：<strong>{target.username}</strong>（{target.email}）</p><label className="field"><span className="field__label">角色</span><select value={role} onChange={e => setRole(e.target.value)}><option value="user">撤销管理员权限</option>{ROLES.map(value => <option value={value} key={value}>{value}</option>)}</select></label>{role === 'super_admin' && target.role !== 'super_admin' && <div className="admin-danger-note">超级管理员拥有所有后台权限。确认只授予可信账号。</div>}</div>}
    </Dialog>
  </div>;
}
