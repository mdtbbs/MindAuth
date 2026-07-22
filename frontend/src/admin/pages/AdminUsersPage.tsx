import { useState, useEffect } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { ResponsiveTable } from '@/shared/ResponsiveTable';
import { Dialog } from '@/shared/Dialog';
import type { AdminUserListItem, PaginationData } from '@/api/types';

export function AdminUsersPage() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Dialog state
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [actionDialog, setActionDialog] = useState<'ban' | 'mute' | 'unlock' | 'delete' | 'reset' | null>(null);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('permanent');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, [currentPage, search, roleFilter]);

  async function loadUsers() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (roleFilter) params.append('role', roleFilter);
      params.append('page', currentPage.toString());
      params.append('limit', '20');

      const res = await api.get<{ success: boolean; users: AdminUserListItem[]; pagination?: PaginationData }>(
        `/api/admin/users?${params.toString()}`
      );
      setUsers(res.users);
      if (res.pagination) setPagination(res.pagination);
    } catch {
      toast('error', '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setCurrentPage(1);
    loadUsers();
  }

  async function handleAction() {
    if (!selectedUser || !actionDialog) return;

    setActionLoading(true);
    try {
      const userId = selectedUser.id;

      if (actionDialog === 'ban') {
        await api.post(`/api/admin/users/${userId}/ban`, { reason, duration });
        toast('success', '用户已封禁');
      } else if (actionDialog === 'mute') {
        await api.post(`/api/admin/users/${userId}/mute`, { reason, duration });
        toast('success', '用户已禁言');
      } else if (actionDialog === 'unlock') {
        await api.post(`/api/admin/users/${userId}/unlock`);
        toast('success', '账号已解锁');
      } else if (actionDialog === 'delete') {
        await api.del(`/api/admin/users/${userId}`);
        toast('success', '用户已删除');
      } else if (actionDialog === 'reset') {
        await api.post(`/api/admin/users/${userId}/reset-password`);
        toast('success', '密码已重置');
      }

      setActionDialog(null);
      setSelectedUser(null);
      setReason('');
      loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败';
      toast('error', msg);
    } finally {
      setActionLoading(false);
    }
  }

  function getRoleBadge(role: string) {
    const colors: Record<string, string> = {
      admin: 'var(--color-error)',
      super_admin: 'var(--color-error)',
      user_admin: 'var(--color-warning)',
      security_admin: 'var(--color-warning)',
      config_admin: 'var(--color-info)',
      readonly_admin: 'var(--color-text-muted)',
    };
    return (
      <span style={{
        fontSize: 'var(--text-xs)',
        padding: 'var(--space-1) var(--space-2)',
        background: colors[role] || 'var(--color-bg-sunken)',
        color: role.includes('admin') ? 'white' : 'var(--color-text)',
        borderRadius: 'var(--radius-sm)',
      }}>
        {role}
      </span>
    );
  }

  function getStatusBadge(user: AdminUserListItem) {
    if (user.ban_status === 'banned') {
      return <span style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>已封禁</span>;
    }
    if (user.ban_status === 'muted') {
      return <span style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>已禁言</span>;
    }
    if (user.lock_level > 0) {
      return <span style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>已锁定</span>;
    }
    return <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>正常</span>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-6)' }}>
        用户管理
      </h1>

      {/* Search and Filter */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Card padding="sm">
          <form onSubmit={handleSearch} className="cluster" style={{ gap: 'var(--space-3)' }}>
          <TextField
            label=""
            placeholder="搜索用户名或邮箱"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: '200px' }}
          />
          <select
            className="field__input"
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); setCurrentPage(1); }}
            style={{ maxWidth: '150px' }}
          >
            <option value="">全部角色</option>
            <option value="admin">管理员</option>
            <option value="user">普通用户</option>
          </select>
          <Button type="submit" size="sm">搜索</Button>
        </form>
      </Card>
      </div>

      {/* Users Table */}
      <Card>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', padding: 'var(--space-4)' }}>加载中...</p>
        ) : (
          <ResponsiveTable
            columns={[
              {
                header: 'ID',
                accessor: 'id',
                render: (u) => <span style={{ fontSize: 'var(--text-sm)' }}>{u.id}</span>,
              },
              {
                header: '用户名',
                accessor: 'username',
                render: (u) => <span style={{ fontWeight: 'var(--weight-semibold)' }}>{u.username}</span>,
              },
              {
                header: '邮箱',
                accessor: 'email',
                render: (u) => (
                  <div>
                    <span style={{ fontSize: 'var(--text-sm)' }}>{u.email}</span>
                    {u.email_verified ? (
                      <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)', marginLeft: 'var(--space-1)' }}>✓</span>
                    ) : (
                      <span style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)', marginLeft: 'var(--space-1)' }}>?</span>
                    )}
                  </div>
                ),
              },
              {
                header: '角色',
                accessor: 'role',
                render: (u) => getRoleBadge(u.role),
              },
              {
                header: '状态',
                accessor: 'status',
                render: (u) => getStatusBadge(u),
              },
              {
                header: '注册时间',
                accessor: 'created',
                render: (u) => (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {new Date(u.created_at).toLocaleDateString('zh-CN')}
                  </span>
                ),
              },
              {
                header: '操作',
                accessor: 'actions',
                render: (u) => (
                  <div className="cluster" style={{ gap: 'var(--space-1)' }}>
                    {hasPermission('users.ban') && u.ban_status === 'none' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSelectedUser(u); setActionDialog('ban'); }}
                      >
                        封禁
                      </Button>
                    )}
                    {hasPermission('users.ban') && u.ban_status !== 'none' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await api.del(`/api/admin/users/${u.id}/ban`);
                            toast('success', '已解封');
                            loadUsers();
                          } catch {
                            toast('error', '操作失败');
                          }
                        }}
                      >
                        解封
                      </Button>
                    )}
                    {hasPermission('users.ban') && u.ban_status === 'none' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSelectedUser(u); setActionDialog('mute'); }}
                      >
                        禁言
                      </Button>
                    )}
                    {hasPermission('users.unlock') && u.lock_level > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSelectedUser(u); setActionDialog('unlock'); }}
                      >
                        解锁
                      </Button>
                    )}
                    {hasPermission('users.reset_password') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setSelectedUser(u); setActionDialog('reset'); }}
                      >
                        重置密码
                      </Button>
                    )}
                    {hasPermission('users.delete') && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => { setSelectedUser(u); setActionDialog('delete'); }}
                      >
                        删除
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
            data={users}
            keyExtractor={(u) => u.id}
            emptyMessage="暂无用户"
          />
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="cluster cluster--center" style={{ marginTop: 'var(--space-4)' }}>
            <Button
              size="sm"
              variant="secondary"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <span style={{ fontSize: 'var(--text-sm)' }}>
              {currentPage} / {pagination.totalPages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={currentPage === pagination.totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </Card>

      {/* Action Dialogs */}
      <Dialog
        open={actionDialog === 'ban' || actionDialog === 'mute'}
        onClose={() => { setActionDialog(null); setReason(''); }}
        title={actionDialog === 'ban' ? '封禁用户' : '禁言用户'}
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setActionDialog(null); setReason(''); }}>
              取消
            </Button>
            <Button variant="danger" onClick={handleAction} loading={actionLoading}>
              确认
            </Button>
          </div>
        }
      >
        <div className="stack">
          <p>确认{actionDialog === 'ban' ? '封禁' : '禁言'}用户 <strong>{selectedUser?.username}</strong>?</p>
          <TextField
            label="原因 (可选)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="封禁/禁言原因"
          />
          <div>
            <label className="field__label">时长</label>
            <select
              className="field__input"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="24h">24小时</option>
              <option value="7d">7天</option>
              <option value="30d">30天</option>
              <option value="permanent">永久</option>
            </select>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={actionDialog === 'unlock'}
        onClose={() => setActionDialog(null)}
        title="解锁账号"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setActionDialog(null)}>取消</Button>
            <Button onClick={handleAction} loading={actionLoading}>确认解锁</Button>
          </div>
        }
      >
        <p>确认解锁用户 <strong>{selectedUser?.username}</strong>?</p>
      </Dialog>

      <Dialog
        open={actionDialog === 'reset'}
        onClose={() => setActionDialog(null)}
        title="重置密码"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setActionDialog(null)}>取消</Button>
            <Button variant="danger" onClick={handleAction} loading={actionLoading}>确认重置</Button>
          </div>
        }
      >
        <p>确认重置用户 <strong>{selectedUser?.username}</strong> 的密码?临时密码将发送到用户邮箱。</p>
      </Dialog>

      <Dialog
        open={actionDialog === 'delete'}
        onClose={() => setActionDialog(null)}
        title="删除用户"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setActionDialog(null)}>取消</Button>
            <Button variant="danger" onClick={handleAction} loading={actionLoading}>确认删除</Button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-error)' }}>
          警告: 此操作将永久删除用户 <strong>{selectedUser?.username}</strong> 及其所有数据,不可恢复!
        </p>
      </Dialog>
    </div>
  );
}
