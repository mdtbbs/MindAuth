import { useState, useEffect } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { Dialog } from '@/shared/Dialog';
import { ResponsiveTable } from '@/shared/ResponsiveTable';
import { SkeletonTable } from '@/shared/Skeleton';
import type { AdminOAuthClient, AdminCreatedClient } from '@/api/types';

export function AdminClientsPage() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState<AdminOAuthClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editClient, setEditClient] = useState<AdminOAuthClient | null>(null);
  const [deleteClient, setDeleteClient] = useState<AdminOAuthClient | null>(null);
  const [rotateClient, setRotateClient] = useState<AdminOAuthClient | null>(null);
  const [createdSecret, setCreatedSecret] = useState<AdminCreatedClient | null>(null);
  const [secretDialogTitle, setSecretDialogTitle] = useState('客户端创建成功');

  // Form state
  const [name, setName] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [requirePkce, setRequirePkce] = useState(false);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    loadClients();
  }, []);

  async function loadClients() {
    try {
      const res = await api.get<{ success: boolean; clients: AdminOAuthClient[] }>('/api/admin/clients');
      setClients(res.clients);
    } catch {
      toast('error', '获取客户端列表失败');
    } finally {
      setLoading(false);
    }
  }

  function validateRedirectUri(uri: string): string | null {
    if (!uri.trim()) return '回调地址必填';
    try {
      const url = new URL(uri);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        return '生产环境回调地址必须使用 HTTPS';
      }
      if (['10.', '172.16.', '192.168.'].some(prefix => url.hostname.startsWith(prefix))) {
        return '回调地址不能使用内网 IP';
      }
      return null;
    } catch {
      return '无效的 URL 格式';
    }
  }

  function resetForm() {
    setName('');
    setRedirectUri('');
    setRequirePkce(false);
    setFormError('');
  }

  async function handleCreate() {
    const uriError = validateRedirectUri(redirectUri);
    if (uriError) {
      setFormError(uriError);
      return;
    }
    if (!name.trim()) {
      setFormError('名称必填');
      return;
    }

    setFormLoading(true);
    setFormError('');
    try {
      const res = await api.post<AdminCreatedClient>('/api/admin/clients', {
        name: name.trim(),
        redirect_uri: redirectUri.trim(),
        require_pkce: requirePkce,
      });
      setSecretDialogTitle('客户端创建成功');
      setCreatedSecret(res);
      setCreateDialogOpen(false);
      resetForm();
      loadClients();
      toast('success', '客户端已创建');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建失败';
      setFormError(msg);
      toast('error', msg);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleUpdate() {
    if (!editClient) return;

    const uriError = validateRedirectUri(redirectUri);
    if (uriError) {
      setFormError(uriError);
      return;
    }

    setFormLoading(true);
    setFormError('');
    try {
      await api.put(`/api/admin/clients/${editClient.id}`, {
        name: name.trim(),
        redirect_uri: redirectUri.trim(),
        require_pkce: requirePkce,
      });
      setEditClient(null);
      resetForm();
      loadClients();
      toast('success', '客户端已更新');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '更新失败';
      setFormError(msg);
      toast('error', msg);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteClient) return;

    setFormLoading(true);
    try {
      await api.del(`/api/admin/clients/${deleteClient.id}`);
      setDeleteClient(null);
      loadClients();
      toast('success', '客户端已删除');
    } catch {
      toast('error', '删除失败');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleRotate() {
    if (!rotateClient) return;

    setFormLoading(true);
    try {
      const res = await api.post<AdminCreatedClient>(`/api/admin/clients/${rotateClient.id}/rotate-secret`);
      setRotateClient(null);
      setSecretDialogTitle('密钥轮换成功');
      setCreatedSecret(res);
      toast('success', '密钥已轮换');
    } catch {
      toast('error', '轮换密钥失败');
    } finally {
      setFormLoading(false);
    }
  }

  function openEdit(client: AdminOAuthClient) {
    setEditClient(client);
    setName(client.name);
    setRedirectUri(client.redirect_uri);
    setRequirePkce(client.require_pkce ?? false);
    setFormError('');
  }

  return (
    <div>
      <div className="cluster cluster--spread" style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>
          OAuth 客户端管理
        </h1>
        {hasPermission('clients.write') && (
          <Button onClick={() => { resetForm(); setCreateDialogOpen(true); }}>
            创建客户端
          </Button>
        )}
      </div>

      <Card>
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : (
          <ResponsiveTable
            columns={[
              {
                header: '名称',
                accessor: 'name',
                render: (c) => <span style={{ fontWeight: 'var(--weight-semibold)' }}>{c.name}</span>,
              },
              {
                header: 'Client ID',
                accessor: 'client_id',
                render: (c) => (
                  <code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-sunken)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                    {c.client_id}
                  </code>
                ),
              },
              {
                header: '回调地址',
                accessor: 'redirect_uri',
                render: (c) => (
                  <span className="text-truncate" style={{ fontSize: 'var(--text-sm)', maxWidth: '200px', display: 'inline-block' }}>
                    {c.redirect_uri}
                  </span>
                ),
              },
              {
                header: 'PKCE',
                accessor: 'pkce',
                render: (c) => c.require_pkce ? (
                  <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>启用</span>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>关闭</span>
                ),
              },
              {
                header: '创建时间',
                accessor: 'created',
                render: (c) => (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {new Date(c.created_at).toLocaleDateString('zh-CN')}
                  </span>
                ),
              },
              {
                header: '操作',
                accessor: 'actions',
                render: (c) => hasPermission('clients.write') ? (
                  <div className="cluster" style={{ gap: 'var(--space-1)' }}>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>编辑</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRotateClient(c)}>轮换密钥</Button>
                    <Button size="sm" variant="danger" onClick={() => setDeleteClient(c)}>删除</Button>
                  </div>
                ) : <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>只读</span>,
              },
            ]}
            data={clients}
            keyExtractor={(c) => c.id}
            emptyMessage="暂无客户端"
          />
        )}
      </Card>

      {/* Create Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => { setCreateDialogOpen(false); resetForm(); }}
        title="创建 OAuth 客户端"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setCreateDialogOpen(false); resetForm(); }}>取消</Button>
            <Button onClick={handleCreate} loading={formLoading}>创建</Button>
          </div>
        }
      >
        <div className="stack">
          <TextField
            label="客户端名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={formError && !name.trim() ? formError : undefined}
            placeholder="例如: MindFourm"
            autoFocus
          />
          <TextField
            label="回调地址 (Redirect URI)"
            value={redirectUri}
            onChange={(e) => { setRedirectUri(e.target.value); setFormError(''); }}
            error={formError && (formError.includes('回调') || formError.includes('URL') || formError.includes('HTTPS') || formError.includes('内网')) ? formError : undefined}
            hint="必须为完整 URL，生产环境需 HTTPS"
            placeholder="https://example.com/callback"
          />
          <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requirePkce}
              onChange={(e) => setRequirePkce(e.target.checked)}
            />
            <span style={{ fontSize: 'var(--text-sm)' }}>要求 PKCE (推荐)</span>
          </label>
          {formError && !redirectUri && (
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>{formError}</p>
          )}
        </div>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editClient}
        onClose={() => { setEditClient(null); resetForm(); }}
        title="编辑 OAuth 客户端"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setEditClient(null); resetForm(); }}>取消</Button>
            <Button onClick={handleUpdate} loading={formLoading}>保存</Button>
          </div>
        }
      >
        <div className="stack">
          <TextField
            label="客户端名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="客户端名称"
          />
          <TextField
            label="回调地址 (Redirect URI)"
            value={redirectUri}
            onChange={(e) => { setRedirectUri(e.target.value); setFormError(''); }}
            error={formError}
            placeholder="https://example.com/callback"
          />
          <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requirePkce}
              onChange={(e) => setRequirePkce(e.target.checked)}
            />
            <span style={{ fontSize: 'var(--text-sm)' }}>要求 PKCE</span>
          </label>
        </div>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={!!deleteClient}
        onClose={() => setDeleteClient(null)}
        title="删除客户端"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setDeleteClient(null)}>取消</Button>
            <Button variant="danger" onClick={handleDelete} loading={formLoading}>确认删除</Button>
          </div>
        }
      >
        <p>确认删除客户端 <strong>{deleteClient?.name}</strong>? 所有使用该客户端的授权将失效。</p>
      </Dialog>

      {/* Rotate Secret Confirm Dialog */}
      <Dialog
        open={!!rotateClient}
        onClose={() => setRotateClient(null)}
        title="轮换客户端密钥"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setRotateClient(null)}>取消</Button>
            <Button variant="danger" onClick={handleRotate} loading={formLoading}>确认轮换</Button>
          </div>
        }
      >
        <p>
          确认为客户端 <strong>{rotateClient?.name}</strong> 生成新的 Client Secret?
          旧密钥将<strong>立即失效</strong>，使用旧密钥的应用需要更新配置后才能继续换取令牌。
        </p>
      </Dialog>

      {/* One-time Secret Display */}
      <Dialog
        open={!!createdSecret}
        onClose={() => setCreatedSecret(null)}
        title={secretDialogTitle}
        footer={
          <Button onClick={() => setCreatedSecret(null)}>我已保存，关闭</Button>
        }
      >
        {createdSecret && (
          <div className="stack">
            <p style={{ color: 'var(--color-warning)', fontWeight: 'var(--weight-semibold)' }}>
              请立即保存 Client Secret，关闭后将无法再次查看!
            </p>
            <div>
              <label className="field__label">Client ID</label>
              <div style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-bg-sunken)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'monospace',
                fontSize: 'var(--text-sm)',
                wordBreak: 'break-all',
              }}>
                {createdSecret.client_id}
              </div>
            </div>
            <div>
              <label className="field__label">Client Secret</label>
              <div style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-warning-bg)',
                border: '1px solid var(--color-warning)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'monospace',
                fontSize: 'var(--text-sm)',
                wordBreak: 'break-all',
              }}>
                {createdSecret.client_secret}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
