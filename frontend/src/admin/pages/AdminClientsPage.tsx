import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useAdminClientsI18n } from '../i18n/adminClients';

const SUPPORTED_SCOPES = [
  'openid', 'profile', 'email', 'forum.read', 'forum.write',
  'resource.read', 'resource.download', 'resource.upload',
  'notification.read', 'message.read', 'message.write',
  'friends.read', 'presence.read', 'presence.write', 'multiplayer.read', 'multiplayer.write',
  'game_content.saves.read', 'game_content.saves.write', 'game_content.saves.delete',
] as const;

export function AdminClientsPage() {
  const { locale, setLocale, t } = useAdminClientsI18n();
  const navigate = useNavigate();
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState<AdminOAuthClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editClient, setEditClient] = useState<AdminOAuthClient | null>(null);
  const [deleteClient, setDeleteClient] = useState<AdminOAuthClient | null>(null);
  const [rotateClient, setRotateClient] = useState<AdminOAuthClient | null>(null);
  const [revokeClient, setRevokeClient] = useState<AdminOAuthClient | null>(null);
  const [createdSecret, setCreatedSecret] = useState<AdminCreatedClient | null>(null);
  const [secretDialogTitle, setSecretDialogTitle] = useState(t('secretCreated'));

  // Form state
  const [name, setName] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [requirePkce, setRequirePkce] = useState(false);
  const [ecosystem, setEcosystem] = useState<'mdtbbs' | 'mindustry-club' | 'global'>('mdtbbs');
  const [scopes, setScopes] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadClients = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; clients: AdminOAuthClient[] }>('/api/admin/clients');
      setClients(res.clients);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('loadFailed');
      setLoadError(message);
      toast('error', message);
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  function validateRedirectUri(uri: string): string | null {
    const values = uri.split('\n').map(value => value.trim()).filter(Boolean);
    if (!values.length) return t('redirectRequired');
    for (const value of values) {
      try {
        const url = new URL(value);
        if (url.username || url.password || url.hash) return t('redirectCredentials');
        if (url.protocol === 'https:') continue;
        if (url.protocol === 'http:') {
          if (['127.0.0.1', '[::1]'].includes(url.hostname)) continue;
          if (['localhost', '0.0.0.0'].includes(url.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return t('redirectPrivate');
          continue; // Retained for already registered public HTTP integrations.
        }
        const scheme = url.protocol.slice(0, -1).toLowerCase();
        if (!/^[a-z][a-z0-9+.-]{1,31}$/.test(scheme) || ['javascript', 'vbscript', 'data', 'file', 'blob', 'about', 'intent', 'content', 'mailto'].includes(scheme) || !url.hostname) return t('redirectUnsafeScheme');
      } catch { return t('invalidUrl', { value }); }
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
    setEcosystem('mdtbbs');
    setFormError('');
  }

  async function handleCreate() {
    const uriError = validateRedirectUri(redirectUri);
    if (uriError) {
      setFormError(uriError);
      return;
    }
    if (!name.trim()) {
      setFormError(t('nameRequired'));
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
        ecosystem,
      });
      setSecretDialogTitle(t('secretCreated'));
      setCreatedSecret(res);
      setCreateDialogOpen(false);
      resetForm();
      loadClients();
      toast('success', t('createdToast'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('createFailed');
      setFormError(msg);
      toast('error', msg);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleUpdate() {
    if (!editClient) return;

    if (!name.trim()) { setFormError(t('nameRequired')); return; }
    if (!scopes.length) { setFormError(t('scopeRequired')); return; }
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
        scopes,
        ecosystem,
      });
      setEditClient(null);
      resetForm();
      loadClients();
      toast('success', t('updatedToast'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('updateFailed');
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
      toast('success', t('deletedToast'));
    } catch {
      toast('error', t('deleteFailed'));
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
      setSecretDialogTitle(t('secretRotated'));
      setCreatedSecret(res);
      toast('success', t('rotatedToast'));
    } catch {
      toast('error', t('rotateFailed'));
    } finally {
      setFormLoading(false);
    }
  }

  async function handleReview(client: AdminOAuthClient, status: 'approved' | 'suspended', scopes = client.approved_scopes) {
    try {
      await api.patch(`/api/admin/clients/${client.id}/review`, {
        status,
        approved_scopes: status === 'approved' ? scopes : [],
      });
      await loadClients();
      toast('success', status === 'approved' ? t('reviewApproved') : t('reviewSuspended'));
    } catch (error) {
      toast('error', error instanceof Error ? error.message : t('reviewFailed'));
    }
  }

  async function handleRevokeAuthorizations() {
    if (!revokeClient) return;
    setFormLoading(true);
    try {
      await api.post(`/api/admin/clients/${revokeClient.id}/revoke-authorizations`);
      setRevokeClient(null); await loadClients(); toast('success', t('revokeSuccess'));
    } catch (error) { toast('error', error instanceof Error ? error.message : t('revokeFailed')); }
    finally { setFormLoading(false); }
  }

  function openEdit(client: AdminOAuthClient) {
    setEditClient(client);
    setName(client.name);
    setRedirectUri((client.redirect_uris || [{ redirect_uri: client.redirect_uri }]).map(item => item.redirect_uri).join('\n'));
    setRequirePkce(client.require_pkce ?? false);
    setEcosystem(client.ecosystem || 'mdtbbs');
    setScopes([...(client.status === 'approved' ? client.approved_scopes : client.requested_scopes)]);
    setFormError('');
  }

  return (
    <div>
      <div className="cluster cluster--spread" style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>
          {t('pageTitle')}
        </h1>
        <label className="admin-client-language"><span>{t('language')}</span><select aria-label={t('language')} value={locale} onChange={event => setLocale(event.target.value as typeof locale)}><option value="en">English</option><option value="ru">Русский</option><option value="ja">日本語</option><option value="zh-CN">简体中文</option></select></label>
        {hasPermission('clients.write') && (
          <Button onClick={() => { resetForm(); setCreateDialogOpen(true); }}>
            {t('createClient')}
          </Button>
        )}
      </div>

      <Card>
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : loadError ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadClients()}>{t('retry')}</Button></div>
        ) : (
          <ResponsiveTable
            columns={[
              {
                header: t('name'),
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
                header: t('redirectUris'),
                accessor: 'redirect_uri',
                render: (c) => (
                  <span className="text-truncate" style={{ fontSize: 'var(--text-sm)', maxWidth: '200px', display: 'inline-block' }}>
                    {(c.redirect_uris || [{ redirect_uri: c.redirect_uri }]).map(item => item.redirect_uri).join(', ')}
                  </span>
                ),
              },
              {
                header: t('ecosystemTypeStatus'),
                accessor: 'client_type',
                render: (c) => <span>{c.ecosystem === 'mindustry-club' ? 'Mindustry Club' : c.ecosystem === 'global' ? t('globalEcosystem') : 'MDTBBS'} · {c.client_type === 'public' ? t('publicClient') : t('confidentialClient')} · {c.party_type === 'first_party' ? t('firstParty') : t('thirdParty')} · {t(c.status)}</span>,
              },
              {
                header: t('scopes'),
                accessor: 'scopes',
                render: (c) => <span title={t('approvedTitle', { value: c.approved_scopes.join(' ') })}>{c.status === 'pending' ? t('requested', { value: c.requested_scopes.join(' ') }) : t('approvedScopes', { value: c.approved_scopes.join(' ') })}</span>,
              },
              {
                header: t('pkce'),
                accessor: 'pkce',
                render: (c) => c.require_pkce ? (
                  <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>{c.client_type === 'public' ? t('s256Required') : t('enabled')}</span>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>{t('disabled')}</span>
                ),
              },
              {
                header: t('createdAt'),
                accessor: 'created',
                render: (c) => (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {new Date(c.created_at).toLocaleDateString(({ en: 'en', ru: 'ru', ja: 'ja-JP', 'zh-CN': 'zh-CN' } as const)[locale])}
                  </span>
                ),
              },
              { header: t('ownerUsers'), accessor: 'owner', render: (c) => <span>{c.owner_username || t('platformApp')}<small className="admin-cell-sub">{t('authorizationCount', { count: c.authorization_count || 0 })}</small></span> },
              { header: t('lastUsed'), accessor: 'last_used', render: (c) => c.last_used_at ? new Date(c.last_used_at).toLocaleString(({ en: 'en', ru: 'ru', ja: 'ja-JP', 'zh-CN': 'zh-CN' } as const)[locale]) : '—' },
              {
                header: t('actions'),
                accessor: 'actions',
                render: (c) => hasPermission('clients.write') ? (
                  <div className="cluster" style={{ gap: 'var(--space-1)' }}>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>{t('edit')}</Button>
                    {c.client_type === 'confidential' ? <Button size="sm" variant="ghost" onClick={() => setRotateClient(c)}>{t('rotateSecret')}</Button> : null}
                    {c.status === 'pending' && c.party_type === 'third_party' ? <Button size="sm" onClick={() => navigate('/applications')}>{t('review')}</Button> : null}
                    {c.status === 'approved' ? <Button size="sm" variant="ghost" onClick={() => void handleReview(c, 'suspended')}>{t('disable')}</Button> : null}
                    {c.status === 'suspended' ? <Button size="sm" variant="ghost" onClick={() => void handleReview(c, 'approved', c.approved_scopes)}>{t('restore')}</Button> : null}
                    {c.status === 'approved' && <Button size="sm" variant="secondary" onClick={() => setRevokeClient(c)}>{t('revokeAll')}</Button>}
                    <Button size="sm" variant="danger" onClick={() => setDeleteClient(c)}>{t('delete')}</Button>
                  </div>
                ) : <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>{t('readOnly')}</span>,
              },
            ]}
            data={clients}
            keyExtractor={(c) => c.id}
            emptyMessage={t('empty')}
          />
        )}
      </Card>

      <Dialog open={!!revokeClient} onClose={() => setRevokeClient(null)} title={t('revokeTitle')} footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setRevokeClient(null)}>{t('cancel')}</Button><Button variant="danger" onClick={() => void handleRevokeAuthorizations()} loading={formLoading}>{t('confirmRevoke')}</Button></div>}>
        <p>{t('revokeBody', { name: revokeClient?.name || '' })}</p>
      </Dialog>

      {/* Create Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => { setCreateDialogOpen(false); resetForm(); }}
        title={t('createTitle')}
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setCreateDialogOpen(false); resetForm(); }}>{t('cancel')}</Button>
            <Button onClick={handleCreate} loading={formLoading}>{t('create')}</Button>
          </div>
        }
      >
        <div className="stack">
          <label className="field"><span className="field__label">{t('ecosystem')}</span><select className="field__input" value={ecosystem} onChange={event => setEcosystem(event.target.value as typeof ecosystem)}><option value="mdtbbs">MDTBBS</option><option value="mindustry-club">Mindustry Club</option><option value="global">{t('globalEcosystem')}</option></select></label>
          <TextField
            label={t('clientName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={formError && !name.trim() ? formError : undefined}
            placeholder={t('createNamePlaceholder')}
            autoFocus
          />
          <label className="field">
            <span className="field__label">{t('callbackLabel')}</span>
            <textarea className="field__input" rows={4} value={redirectUri}
              onChange={(e) => { setRedirectUri(e.target.value); setFormError(''); }}
              placeholder={'https://example.com/callback\nmyapp://oauth/callback\nhttp://127.0.0.1:0/callback'} />
            <span className="field__hint">{t('callbackHint')}</span>
          </label>
          {formError ? <p role="alert" style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>{formError}</p> : null}
          <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requirePkce}
              onChange={(e) => setRequirePkce(e.target.checked)}
            />
            <span style={{ fontSize: 'var(--text-sm)' }}>{t('requirePkceRecommended')}</span>
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
        title={t('editTitle')}
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setEditClient(null); resetForm(); }}>{t('cancel')}</Button>
            <Button onClick={handleUpdate} loading={formLoading}>{t('save')}</Button>
          </div>
        }
      >
        <div className="stack">
          <label className="field"><span className="field__label">{t('ecosystem')}</span><select className="field__input" value={ecosystem} onChange={event => setEcosystem(event.target.value as typeof ecosystem)}><option value="mdtbbs">MDTBBS</option><option value="mindustry-club">Mindustry Club</option><option value="global">{t('globalEcosystem')}</option></select></label>
          <TextField
            label={t('clientName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('editNamePlaceholder')}
          />
          <label className="field">
            <span className="field__label">{t('callbackLabel')}</span>
            <textarea className="field__input" rows={4}
            value={redirectUri}
            onChange={(e) => { setRedirectUri(e.target.value); setFormError(''); }}
            placeholder={'https://example.com/callback\nmyapp://oauth/callback\nhttp://127.0.0.1:0/callback'}
            />
            <span className="field__hint">{t('callbackHint')}</span>
          </label>
          <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={requirePkce}
              onChange={(e) => setRequirePkce(e.target.checked)}
            />
            <span style={{ fontSize: 'var(--text-sm)' }}>{t('requirePkce')}</span>
          </label>
          <fieldset className="field">
            <legend className="field__label">{t('allowedScopes')}</legend>
            <div className="admin-scope-options">
              {SUPPORTED_SCOPES.map(scope => (
                <label key={scope} className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) => setScopes(current => event.target.checked
                      ? [...current, scope]
                      : current.filter(item => item !== scope))}
                  />
                  <code>{scope}</code>
                </label>
              ))}
            </div>
            <span className="field__hint">{t('scopeChangeWarning')}</span>
          </fieldset>
        </div>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={!!deleteClient}
        onClose={() => setDeleteClient(null)}
        title={t('deleteTitle')}
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setDeleteClient(null)}>{t('cancel')}</Button>
            <Button variant="danger" onClick={handleDelete} loading={formLoading}>{t('confirmDelete')}</Button>
          </div>
        }
      >
        <p>{t('deleteBody', { name: deleteClient?.name || '' })}</p>
      </Dialog>

      {/* Rotate Secret Confirm Dialog */}
      <Dialog
        open={!!rotateClient}
        onClose={() => setRotateClient(null)}
        title={t('rotateTitle')}
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setRotateClient(null)}>{t('cancel')}</Button>
            <Button variant="danger" onClick={handleRotate} loading={formLoading}>{t('confirmRotate')}</Button>
          </div>
        }
      >
        <p>
          {t('rotateBody', { name: rotateClient?.name || '' })} {t('rotateWarning')}
        </p>
      </Dialog>

      {/* One-time Secret Display */}
      <Dialog
        open={!!createdSecret}
        onClose={() => setCreatedSecret(null)}
        title={secretDialogTitle}
        footer={
          <Button onClick={() => setCreatedSecret(null)}>{t('savedClose')}</Button>
        }
      >
        {createdSecret && (
          <div className="stack">
            <p style={{ color: 'var(--color-warning)', fontWeight: 'var(--weight-semibold)' }}>
              {t('saveSecretNow')}
            </p>
            <div>
              <label className="field__label">{t('clientId')}</label>
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
              <label className="field__label">{t('clientSecret')}</label>
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
