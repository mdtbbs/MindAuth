import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';

interface Application {
  id: number; name: string; description: string | null; website_url: string | null; client_id: string;
  client_type: string; party_type: string; status: 'pending' | 'approved' | 'rejected' | 'suspended' | 'draft';
  owner_user_id: number | null; owner_username: string | null; requested_scopes: string[]; approved_scopes: string[];
  redirect_uris: { redirect_uri: string }[]; created_at: string; admin_review_note: string | null; authorization_count: number;
}
type ReviewStatus = 'approved' | 'rejected';

function statusText(status: Application['status']) {
  return ({ pending: '待审核', approved: '已批准', rejected: '已拒绝', suspended: '已停用', draft: '草稿' })[status];
}

export function AdminApplicationsPage() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const canReview = hasPermission('developers.review');
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'pending' | 'all' | 'approved' | 'rejected'>('pending');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Application | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('approved');
  const [approvedScopes, setApprovedScopes] = useState<string[]>([]);
  const [reviewReason, setReviewReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const res = await api.get<{ applications: Application[] }>('/api/admin/developer-applications', { signal });
      setApplications(res.applications || []);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '获取应用申请失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const rows = useMemo(() => applications.filter(app => {
    const stateMatches = filter === 'all' || app.status === filter;
    const text = `${app.name} ${app.client_id} ${app.owner_username || ''} ${app.redirect_uris.map(item => item.redirect_uri).join(' ')}`.toLowerCase();
    return stateMatches && text.includes(query.trim().toLowerCase());
  }), [applications, filter, query]);

  function openReview(application: Application, status: ReviewStatus) {
    setSelected(application); setReviewStatus(status);
    setApprovedScopes(application.approved_scopes.length ? application.approved_scopes : application.requested_scopes);
    setReviewReason(status === 'rejected' ? '' : application.admin_review_note || '');
  }

  async function submitReview() {
    if (!selected) return;
    if (reviewStatus === 'approved' && approvedScopes.length === 0) { toast('error', '批准时至少选择一个 scope'); return; }
    if (reviewStatus === 'rejected' && !reviewReason.trim()) { toast('error', '请填写拒绝原因'); return; }
    setSaving(true);
    try {
      await api.patch(`/api/admin/developer-applications/${selected.id}/review`, {
        status: reviewStatus,
        approved_scopes: reviewStatus === 'approved' ? approvedScopes : [],
        review_reason: reviewReason.trim() || null,
      });
      setSelected(null); await load(); toast('success', reviewStatus === 'approved' ? '应用已批准' : '申请已拒绝');
    } catch (err) { toast('error', err instanceof Error ? err.message : '审核失败'); }
    finally { setSaving(false); }
  }

  return <div className="admin-page">
    <div className="admin-page-heading"><div><h1 className="admin-page-title">应用申请</h1><p className="admin-page-lead">审核开发者提交的 Public Client、回调地址和请求权限。</p></div></div>
    <div className="admin-tabs" role="tablist" aria-label="申请状态">{(['pending', 'all', 'approved', 'rejected'] as const).map(value => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{value === 'pending' ? `待审核 (${applications.filter(item => item.status === 'pending').length})` : value === 'all' ? '全部申请' : statusText(value)}</button>)}</div>
    <Card>
      <div className="admin-filter-bar"><label className="admin-search"><span className="sr-only">搜索应用</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索应用、开发者或回调地址" /></label></div>
      {loading ? <div className="admin-inline-state">正在加载申请…</div> : error ? <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{error}</p><Button size="sm" variant="secondary" onClick={() => load()}>重试</Button></div> : rows.length === 0 ? <div className="admin-inline-state">{filter === 'pending' ? '当前没有待审核申请' : '没有匹配的申请'}</div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>应用</th><th>开发者</th><th>类型</th><th>Redirect URI</th><th>请求 scopes</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>{rows.map(app => <tr key={app.id}>
        <td><strong>{app.name}</strong><small className="admin-cell-sub">{app.client_id}</small></td><td>{app.owner_username || '—'}<small className="admin-cell-sub">ID {app.owner_user_id || '—'}</small></td><td>{app.client_type === 'public' ? 'Public Client' : 'Confidential Client'}</td><td><div className="admin-uri-list">{app.redirect_uris.map(uri => <code key={uri.redirect_uri}>{uri.redirect_uri}</code>)}</div></td><td><div className="admin-scope-list">{app.requested_scopes.map(scope => <code key={scope}>{scope}</code>)}</div></td><td><span className={`admin-badge ${app.status === 'approved' ? 'is-success' : app.status === 'rejected' ? 'is-danger' : 'is-warning'}`}>{statusText(app.status)}</span></td><td>{new Date(app.created_at).toLocaleString('zh-CN')}</td>
        <td>{canReview && app.status !== 'suspended' ? <div className="admin-row-actions"><button type="button" onClick={() => openReview(app, 'approved')}>{app.status === 'approved' ? '修改批准' : '批准'}</button><button type="button" className="is-danger" onClick={() => openReview(app, 'rejected')}>拒绝</button></div> : <span>—</span>}</td>
      </tr>)}</tbody></table></div>}
    </Card>
    <Dialog open={!!selected} onClose={() => setSelected(null)} title={reviewStatus === 'approved' ? '审核并批准应用' : '拒绝应用申请'} footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setSelected(null)}>取消</Button><Button variant={reviewStatus === 'rejected' ? 'danger' : 'primary'} onClick={submitReview} loading={saving}>{reviewStatus === 'rejected' ? '确认拒绝' : '批准应用'}</Button></div>}>
      {selected && <div className="admin-form-stack"><p><strong>{selected.name}</strong> · {selected.owner_username || `用户 ${selected.owner_user_id}`}</p><p>{selected.description || '未填写应用说明'}</p><dl className="admin-detail-list"><div><dt>Client ID</dt><dd><code>{selected.client_id}</code></dd></div><div><dt>回调地址</dt><dd>{selected.redirect_uris.map(uri => <code key={uri.redirect_uri}>{uri.redirect_uri}</code>)}</dd></div></dl>
        {reviewStatus === 'approved' && <fieldset className="admin-scope-editor"><legend>批准的权限（可调整）</legend>{selected.requested_scopes.map(scope => <label key={scope}><input type="checkbox" checked={approvedScopes.includes(scope)} onChange={e => setApprovedScopes(scopes => e.target.checked ? [...scopes, scope] : scopes.filter(item => item !== scope))} /><code>{scope}</code></label>)}</fieldset>}
        <label className="field"><span className="field__label">{reviewStatus === 'rejected' ? '拒绝原因（必填）' : '审核备注（可选）'}</span><textarea rows={3} maxLength={1000} value={reviewReason} onChange={e => setReviewReason(e.target.value)} /></label>
        <p className="admin-form-note">Public Client 不生成或保存 client_secret，获批后必须使用 Authorization Code + PKCE S256。</p>
      </div>}
    </Dialog>
  </div>;
}
