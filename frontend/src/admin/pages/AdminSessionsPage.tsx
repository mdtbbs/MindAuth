import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/client';
import { useResource } from '@/api/useResource';
import { useDebouncedValue } from '@/shared/useDebouncedValue';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import type { AdminUserListItem, AdminUserDetail } from '@/api/types';

interface Session { id: number | string; session_type: string; ip_address: string; user_agent?: string | null; device_info: string; expires_at?: string | null; created_at: string; last_active_at: string }
interface Grant { id: number; client_id: string; client_name: string; scope: string; created_at: string; last_used_at: string | null }
interface UserData { user: AdminUserDetail; sessions: Session[]; authorizations: Grant[] }

export function AdminSessionsPage() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdminUserListItem | null>(null);
  const [tab, setTab] = useState<'sessions' | 'authorizations'>('sessions');
  const [busy, setBusy] = useState(false);
  const query = useDebouncedValue(search, 250);
  const canRevokeSessions = hasPermission('sessions.revoke');
  const canReadGrants = hasPermission('authorizations.read');
  const canRevokeGrants = hasPermission('authorizations.revoke');

  const usersResult = useResource(signal => api.get<{ users: AdminUserListItem[] }>(`/api/admin/users?search=${encodeURIComponent(query)}&page=1&limit=10`, { signal }), [query]);
  const detail = useResource(signal => selected ? api.get<UserData>(`/api/admin/users/${selected.id}`, { signal }) : Promise.resolve(null), [selected?.id]);

  async function revoke(url: string, message: string) {
    setBusy(true);
    try { await api.del(url); await detail.reload(); toast('success', message); }
    catch (err) { toast('error', err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }

  return <div className="admin-page"><div className="admin-page-heading"><div><h1 className="admin-page-title">会话与授权</h1><p className="admin-page-lead">按用户查看活跃设备会话和 OAuth 授权。</p></div></div>
    <Card><label className="admin-search admin-user-search"><span className="sr-only">搜索用户</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索用户名、邮箱或用户 ID" /></label>
      {usersResult.loading && query && <p className="admin-search-hint">搜索中…</p>}
      {usersResult.error && <div className="admin-inline-state admin-inline-state--error"><p>{usersResult.error.message}</p><Button size="sm" variant="secondary" onClick={() => usersResult.reload()}>重试</Button></div>}
      {query && !usersResult.loading && usersResult.data?.users?.length ? <div className="admin-user-picker">{usersResult.data.users.map(user => <button type="button" key={user.id} className="admin-user-picker__item" onClick={() => { setSelected(user); setTab('sessions'); setSearch(''); }}><strong>{user.username}</strong><span>{user.email}</span><small>ID {user.id}</small></button>)}</div> : null}
      {selected && <div className="admin-selected-user"><span>当前用户：<strong>{selected.username}</strong> · {selected.email}</span><Link to={`/users/${selected.id}`}>用户详情</Link><button type="button" onClick={() => setSelected(null)}>清除</button></div>}
    </Card>
    {!selected ? <div className="admin-inline-state">搜索并选择一个用户以查看会话和授权。</div> : detail.loading ? <div className="admin-inline-state">正在加载用户会话…</div> : detail.error ? <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{detail.error.message}</p><Button size="sm" variant="secondary" onClick={() => detail.reload()}>重试</Button></div> : detail.data ? <>
      <div className="admin-tabs" role="tablist" aria-label="会话和授权">{<button type="button" role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>登录会话 ({detail.data.sessions.length})</button>}{canReadGrants && <button type="button" role="tab" aria-selected={tab === 'authorizations'} onClick={() => setTab('authorizations')}>OAuth 授权 ({detail.data.authorizations.length})</button>}</div>
      {tab === 'sessions' && <Card><div className="admin-section-heading"><h2>活动会话</h2>{canRevokeSessions && <Button size="sm" variant="secondary" disabled={!detail.data.sessions.length || busy} onClick={() => void revoke(`/api/admin/users/${selected.id}/sessions`, '全部会话已注销')}>注销全部</Button>}</div>{detail.data.sessions.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>设备</th><th>类型</th><th>IP</th><th>User-Agent</th><th>创建时间</th><th>最近活动</th><th>到期时间</th>{canRevokeSessions && <th>操作</th>}</tr></thead><tbody>{detail.data.sessions.map(session => <tr key={session.id}><td>{session.device_info || '未知设备'}</td><td>{session.session_type}</td><td><code>{session.ip_address || '—'}</code></td><td className="admin-user-agent">{session.user_agent || '—'}</td><td>{new Date(session.created_at).toLocaleString('zh-CN')}</td><td>{new Date(session.last_active_at).toLocaleString('zh-CN')}</td><td>{session.expires_at ? new Date(session.expires_at).toLocaleString('zh-CN') : '—'}</td>{canRevokeSessions && <td><button type="button" className="admin-text-action is-danger" disabled={busy} onClick={() => void revoke(`/api/admin/users/${selected.id}/sessions/${encodeURIComponent(session.id)}`, '会话已注销')}>注销</button></td>}</tr>)}</tbody></table></div> : <div className="admin-inline-state">没有活动会话</div>}</Card>}
      {tab === 'authorizations' && canReadGrants && <Card><div className="admin-section-heading"><h2>OAuth 授权</h2>{canRevokeGrants && <Button size="sm" variant="secondary" disabled={!detail.data.authorizations.length || busy} onClick={() => void revoke(`/api/admin/users/${selected.id}/authorizations`, '全部授权已撤销')}>撤销全部</Button>}</div>{detail.data.authorizations.length ? <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>用户</th><th>OAuth 应用</th><th>Scope</th><th>授权时间</th><th>最近使用</th>{canRevokeGrants && <th>操作</th>}</tr></thead><tbody>{detail.data.authorizations.map(grant => <tr key={grant.id}><td>{selected.username}</td><td>{grant.client_name || grant.client_id}</td><td>{grant.scope}</td><td>{new Date(grant.created_at).toLocaleString('zh-CN')}</td><td>{grant.last_used_at ? new Date(grant.last_used_at).toLocaleString('zh-CN') : '—'}</td>{canRevokeGrants && <td><button type="button" className="admin-text-action is-danger" disabled={busy} onClick={() => void revoke(`/api/admin/authorizations/${grant.id}`, 'OAuth 授权已撤销')}>撤销</button></td>}</tr>)}</tbody></table></div> : <div className="admin-inline-state">没有 OAuth 授权</div>}</Card>}
    </> : null}
  </div>;
}
