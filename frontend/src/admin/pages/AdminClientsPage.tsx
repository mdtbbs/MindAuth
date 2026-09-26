import { useCallback, useState, useEffect } from 'react';
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
  const [reviewClient, setReviewClient] = useState<AdminOAuthClient | null>(null);
  const [reviewScopes, setReviewScopes] = useState<string[]>([]);
  const [createdSecret, setCreatedSecret] = useState<AdminCreatedClient | null>(null);
  const [secretDialogTitle, setSecretDialogTitle] = useState('客户端创建成功');

  // Form state
  const [name, setName] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [requirePkce, setRequirePkce] = useState(false);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadClients = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; clients: AdminOAuthClient[] }>('/api/admin/clients');
      setClients(res.clients);
    } catch {
      toast('error', '获取客户端列表失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  function validateRedirectUri(uri: string): string | null {
    const values = uri.split('\n').map(value => value.trim()).filter(Boolean);
    if (!values.length) return '至少需要一个回调地址';
    for (const value of values) {
      try {
        const url = new URL(value);
        if (url.username || url.password || url.hash) return '回调地址不能包含用户凭证或 fragment';
        if (url.protocol === 'https:') continue;
        if (url.protocol === 'http:') {
          if (['127.0.0.1', '[::1]'].includes(url.hostname)) continue;
          if (['localhost', '0.0.0.0'].includes(url.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return '回调地址不能使用内网地址';
          continue; // Retained for already registered public HTTP integrations.
        }
        const scheme = url.protocol.slice(0, -1).toLowerCase();
        if (!/^[a-z][a-z0-9+.-]{1,31}$/.test(scheme) || ['javascript', 'vbscript', 'data', 'file', 'blob', 'about', 'intent', 'content', 'mailto'].includes(scheme) || !url.hostname) return '自定义回调协议不安全或格式不正确';
      } catch { return `无效的 URL 格式：${value}`; }
    }
    return null;
  }

  function redirectUriValues() {
    return redirectUri.split('\n').map(value => value.trim()).filter(Boolean);
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
        redirect_uri: redirectUriValues()[0],
        redirect_uris: redirectUriValues(),
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

    if (!name.trim()) { setFormError('名称必填'); return; }
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
        redirect_uris: redirectUriValues(),
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

  async function handleReview(client: AdminOAuthClient, status: 'approved' | 'rejected' | 'suspended', scopes = client.requested_scopes) {
    try {
      await api.patch(`/api/admin/clients/${client.id}/review`, {
        status,
        approved_scopes: status === 'approved' ? scopes : [],
      });
      setReviewClient(null);
      await loadClients();
      toast('success', status === 'approved' ? '应用已批准' : status === 'rejected' ? '应用已拒绝' : '应用已停用');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '审核操作失败');
    }
  }

  function openEdit(client: AdminOAuthClient) {
    setEditClient(client);
    setName(client.name);
    setRedirectUri((client.redirect_uris || [{ redirect_uri: client.redirect_uri }]).map(item => item.redirect_uri).join('\n'));
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
                    {(c.redirect_uris || [{ redirect_uri: c.redirect_uri }]).map(item => item.redirect_uri).join(', ')}
                  </span>
                ),
              },
              {
                header: '应用类型 / 状态',
                accessor: 'client_type',
                render: (c) => <span>{c.client_type === 'public' ? 'Public' : 'Confidential'} · {c.party_type === 'first_party' ? '第一方' : '第三方'} · {c.status}</span>,
              },
              {
                header: 'Scope',
                accessor: 'scopes',
                render: (c) => <span title={`已批准：${c.approved_scopes.join(' ')}`}>{c.status === 'pending' ? `申请：${c.requested_scopes.join(' ')}` : `批准：${c.approved_scopes.join(' ')}`}</span>,
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
                    {c.client_type === 'confidential' ? <Button size="sm" variant="ghost" onClick={() => setRotateClient(c)}>轮换密钥</Button> : null}
                    {c.status === 'pending' ? <><Button size="sm" onClick={() => { setReviewClient(c); setReviewScopes(c.requested_scopes); }}>审核 Scope</Button><Button size="sm" variant="ghost" onClick={() => void handleReview(c, 'rejected')}>拒绝</Button></> : null}
                    {c.status === 'approved' ? <Button size="sm" variant="ghost" onClick={() => void handleReview(c, 'suspended')}>停用</Button> : null}
                    {c.status === 'suspended' ? <Button size="sm" variant="ghost" onClick={() => void handleReview(c, 'approved', c.approved_scopes)}>恢复</Button> : null}
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
          <label className="field">
            <span className="field__label">回调地址 (Redirect URI)，每行一个</span>
            <textarea className="field__input" rows={4} value={redirectUri}
              onChange={(e) => { setRedirectUri(e.target.value); setFormError(''); }}
              placeholder={'https://example.com/callback\nmyapp://oauth/callback\nhttp://127.0.0.1:0/callback'} />
            <span className="field__hint">支持 HTTPS、自定义应用协议，以及 loopback 随机端口。</span>
          </label>
          {formError ? <p role="alert" style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>{formError}</p> : null}
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

      <Dialog
        open={Boolean(reviewClient)}
        onClose={() => setReviewClient(null)}
        title={`审核 ${reviewClient?.name || '应用'}`}
        footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setReviewClient(null)}>取消</Button><Button onClick={() => reviewClient && void handleReview(reviewClient, 'approved', reviewScopes)}>批准所选 Scope</Button></div>}
      >
        <div className="stack">
          <p>只批准应用确实需要的权限。批准后的 Scope 将成为 OAuth 运行时上限。</p>
          {(reviewClient?.requested_scopes || []).map(scope => (
            <label className="cluster" key={scope}>
              <input type="checkbox" checked={reviewScopes.includes(scope)} onChange={event => setReviewScopes(current => event.target.checked ? [...current, scope] : current.filter(item => item !== scope))} />
              <code>{scope}</code>
            </label>
          ))}
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
          <label className="field">
            <span className="field__label">回调地址 (Redirect URI)，每行一个</span>
            <textarea className="field__input" rows={4}
            value={redirectUri}
            onChange={(e) => { setRedirectUri(e.target.value); setFormError(''); }}
            placeholder={'https://example.com/callback\nmyapp://oauth/callback\nhttp://127.0.0.1:0/callback'}
            />
            <span className="field__hint">支持 HTTPS、自定义应用协议，以及 loopback 随机端口。</span>
          </label>
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
