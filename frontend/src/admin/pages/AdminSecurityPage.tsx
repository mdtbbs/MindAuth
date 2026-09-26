import { useState, useEffect, useCallback } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { Dialog } from '@/shared/Dialog';
import { ResponsiveTable } from '@/shared/ResponsiveTable';
import { SkeletonTable } from '@/shared/Skeleton';
import type { IpBan, Challenge, UserField, PaginationData } from '@/api/types';

type SecurityTab = 'ip_bans' | 'challenges' | 'fields';

export function AdminSecurityPage({ initialSection, standalone = false, hideTitle = false }: { initialSection?: SecurityTab; standalone?: boolean; hideTitle?: boolean }) {
  const [activeTab, setActiveTab] = useState<SecurityTab>(initialSection || 'ip_bans');
  useEffect(() => { if (initialSection) setActiveTab(initialSection); }, [initialSection]);

  const tabs: { id: SecurityTab; label: string; perm: string }[] = [
    { id: 'ip_bans', label: 'IP 黑名单', perm: 'ip_bans.read' },
    { id: 'challenges', label: '安全题库', perm: 'config.read' },
    { id: 'fields', label: '自定义字段', perm: 'config.read' },
  ];

  const { hasPermission } = useAdminAuth();
  const visibleTabs = tabs.filter((t) => hasPermission(t.perm));

  return (
    <div>
      {!hideTitle && <h1 className="admin-page-title">
        {standalone ? (activeTab === 'ip_bans' ? 'IP 规则' : activeTab === 'fields' ? '用户资料字段' : '注册验证问题') : '安全设置'}
      </h1>}

      {/* Tab bar */}
      {!standalone && <div className="cluster" style={{ marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              fontWeight: activeTab === tab.id ? 'var(--weight-semibold)' : 'var(--weight-normal)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>}

      {activeTab === 'ip_bans' && <IpBansSection />}
      {activeTab === 'challenges' && <ChallengesSection />}
      {activeTab === 'fields' && <FieldsSection />}
    </div>
  );
}

/* ─── IP Bans Section ───────────────────────────────────────────────────────── */

function IpBansSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [bans, setBans] = useState<IpBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteBan, setDeleteBan] = useState<IpBan | null>(null);
  const [editBan, setEditBan] = useState<IpBan | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editExpiry, setEditExpiry] = useState('');

  // Form state
  const [ip, setIp] = useState('');
  const [cidrPrefix, setCidrPrefix] = useState('');
  const [banReason, setBanReason] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadBans = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; bans: IpBan[]; pagination?: PaginationData }>(
        `/api/admin/ip-bans?page=${currentPage}&limit=20`
      );
      setBans(res.bans);
      if (res.pagination) setPagination(res.pagination);
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取 IP 黑名单失败';
      setLoadError(message); toast('error', message);
    } finally {
      setLoading(false);
    }
  }, [currentPage, toast]);

  useEffect(() => { loadBans(); }, [loadBans]);

  async function handleAdd() {
    const trimmedIp = ip.trim();
    if (!trimmedIp) { setFormError('IP 地址必填'); return; }
    const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
    // Loose IPv6 shape check (hex groups / '::' / optional v4-mapped tail); server does strict validation
    const ipv6Re = /^[0-9a-fA-F:]*:[0-9a-fA-F:]*(:(\d{1,3}\.){3}\d{1,3})?$/;
    const isIpv6 = trimmedIp.includes(':') && ipv6Re.test(trimmedIp);
    if (!ipv4Re.test(trimmedIp) && !isIpv6) { setFormError('IP 地址格式无效（支持 IPv4 / IPv6）'); return; }
    const maxPrefix = isIpv6 ? 128 : 32;
    if (cidrPrefix && (isNaN(Number(cidrPrefix)) || Number(cidrPrefix) < 0 || Number(cidrPrefix) > maxPrefix)) {
      setFormError(`CIDR 前缀须为 0-${maxPrefix}`); return;
    }

    setFormLoading(true);
    setFormError('');
    try {
      await api.post('/api/admin/ip-bans', {
        ip: ip.trim(),
        cidr_prefix: cidrPrefix ? Number(cidrPrefix) : null,
        reason: banReason || null,
      });
      setAddDialogOpen(false);
      setIp(''); setCidrPrefix(''); setBanReason('');
      loadBans();
      toast('success', 'IP 已加入黑名单');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '添加失败';
      setFormError(msg);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteBan) return;
    setFormLoading(true);
    try {
      await api.del(`/api/admin/ip-bans/${deleteBan.id}`);
      setDeleteBan(null);
      loadBans();
      toast('success', '已删除');
    } catch { toast('error', '删除失败'); }
    finally { setFormLoading(false); }
  }

  function openEdit(ban: IpBan) {
    setEditBan(ban);
    setEditReason(ban.reason || '');
    setEditExpiry(ban.expires_at ? new Date(new Date(ban.expires_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  }

  async function handleEdit() {
    if (!editBan) return;
    setFormLoading(true);
    try {
      await api.put(`/api/admin/ip-bans/${editBan.id}`, { reason: editReason.trim() || null, expires_at: editExpiry ? new Date(editExpiry).toISOString() : null });
      setEditBan(null); await loadBans(); toast('success', 'IP 规则已更新');
    } catch (err) { toast('error', err instanceof Error ? err.message : '更新失败'); }
    finally { setFormLoading(false); }
  }

  function setExpiryAfter(hours: number) {
    setEditExpiry(new Date(Date.now() + hours * 60 * 60 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  }

  return (
    <>
      <Card>
        {hasPermission('ip_bans.write') && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Button size="sm" onClick={() => { setIp(''); setCidrPrefix(''); setBanReason(''); setFormError(''); setAddDialogOpen(true); }}>
              添加 IP 黑名单
            </Button>
          </div>
        )}
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : loadError ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadBans()}>重试</Button></div>
        ) : (
          <ResponsiveTable
            columns={[
              { header: 'IP', accessor: 'ip', render: (b) => (
                <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>
                  {b.ip_address}{b.cidr_prefix != null ? `/${b.cidr_prefix}` : ''}
                </span>
              )},
              { header: '原因', accessor: 'reason', render: (b) => b.reason || <span style={{ color: 'var(--color-text-muted)' }}>—</span> },
              { header: '创建时间', accessor: 'created', render: (b) => new Date(b.created_at).toLocaleString('zh-CN') },
              { header: '过期时间', accessor: 'expires', render: (b) => b.expires_at ? new Date(b.expires_at).toLocaleString('zh-CN') : '永久' },
              ...(hasPermission('ip_bans.write') ? [{
                header: '操作',
                accessor: 'actions',
                render: (b: IpBan) => (
                  <div className="admin-row-actions"><Button size="sm" variant="secondary" onClick={() => openEdit(b)}>编辑</Button><Button size="sm" variant="danger" onClick={() => setDeleteBan(b)}>删除</Button></div>
                ),
              }] : []),
            ]}
            data={bans}
            keyExtractor={(b) => b.id}
            emptyMessage="暂无 IP 黑名单"
          />
        )}
        {pagination && pagination.totalPages > 1 && (
          <div className="cluster cluster--center" style={{ marginTop: 'var(--space-4)' }}>
            <Button size="sm" variant="secondary" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>上一页</Button>
            <span style={{ fontSize: 'var(--text-sm)' }}>{currentPage} / {pagination.totalPages}</span>
            <Button size="sm" variant="secondary" disabled={currentPage === pagination.totalPages} onClick={() => setCurrentPage(p => p + 1)}>下一页</Button>
          </div>
        )}
      </Card>

      <Dialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        title="添加 IP 黑名单"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setAddDialogOpen(false)}>取消</Button>
            <Button onClick={handleAdd} loading={formLoading}>添加</Button>
          </div>
        }
      >
        <div className="stack">
          <TextField label="IP 地址" value={ip} onChange={(e) => setIp(e.target.value)} error={formError} placeholder="例如: 192.168.1.1 或 2001:db8::1" />
          <TextField label="CIDR 前缀 (可选)" value={cidrPrefix} onChange={(e) => setCidrPrefix(e.target.value)} hint="IPv4 0-32 / IPv6 0-128，留空表示单个 IP" placeholder="例如: 24" />
          <TextField label="原因 (可选)" value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="封禁原因" />
        </div>
      </Dialog>

      <Dialog open={!!editBan} onClose={() => setEditBan(null)} title="编辑 IP 规则" footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setEditBan(null)}>取消</Button><Button onClick={handleEdit} loading={formLoading}>保存</Button></div>}>
        <div className="admin-form-stack">
          <p>规则：<code>{editBan?.ip_address}{editBan?.cidr_prefix != null ? `/${editBan.cidr_prefix}` : ''}</code></p>
          <TextField label="原因" value={editReason} onChange={e => setEditReason(e.target.value)} />
          <label className="field"><span className="field__label">到期时间（留空表示永久）</span><input className="field__input" type="datetime-local" value={editExpiry} onChange={e => setEditExpiry(e.target.value)} /></label>
          <div className="admin-row-actions"><button type="button" onClick={() => setEditExpiry('')}>永久</button><button type="button" onClick={() => setExpiryAfter(1)}>1 小时</button><button type="button" onClick={() => setExpiryAfter(24)}>24 小时</button><button type="button" onClick={() => setExpiryAfter(24 * 7)}>7 天</button><button type="button" onClick={() => setExpiryAfter(24 * 30)}>30 天</button></div>
        </div>
      </Dialog>

      <Dialog
        open={!!deleteBan}
        onClose={() => setDeleteBan(null)}
        title="删除 IP 黑名单"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setDeleteBan(null)}>取消</Button>
            <Button variant="danger" onClick={handleDelete} loading={formLoading}>确认删除</Button>
          </div>
        }
      >
        <p>确认删除 IP 黑名单 <strong>{deleteBan?.ip_address}</strong>?</p>
      </Dialog>
    </>
  );
}

/* ─── Challenges Section ────────────────────────────────────────────────────── */

function ChallengesSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editChallenge, setEditChallenge] = useState<Challenge | null>(null);
  const [deleteChallenge, setDeleteChallenge] = useState<Challenge | null>(null);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadChallenges = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; challenges: Challenge[] }>('/api/admin/challenges');
      setChallenges(res.challenges);
    } catch (error) { const message = error instanceof Error ? error.message : '获取题库失败'; setLoadError(message); toast('error', message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadChallenges(); }, [loadChallenges]);

  function resetForm() { setQuestion(''); setAnswer(''); setFormError(''); }

  async function handleCreate() {
    if (!question.trim() || !answer.trim()) { setFormError('题目和答案必填'); return; }
    setFormLoading(true); setFormError('');
    try {
      await api.post('/api/admin/challenges', { question: question.trim(), answer: answer.trim() });
      setDialogOpen(false); resetForm(); loadChallenges(); toast('success', '题目已添加');
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : '创建失败'); }
    finally { setFormLoading(false); }
  }

  async function handleUpdate() {
    if (!editChallenge) return;
    if (!question.trim() && !answer.trim()) { setFormError('无更新内容'); return; }
    setFormLoading(true); setFormError('');
    try {
      await api.put(`/api/admin/challenges/${editChallenge.id}`, {
        question: question.trim() || undefined,
        answer: answer.trim() || undefined,
      });
      setEditChallenge(null); resetForm(); loadChallenges(); toast('success', '题目已更新');
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : '更新失败'); }
    finally { setFormLoading(false); }
  }

  async function handleToggle(challenge: Challenge) {
    try {
      await api.patch(`/api/admin/challenges/${challenge.id}/toggle`, { enabled: !challenge.enabled });
      loadChallenges(); toast('success', challenge.enabled ? '已禁用' : '已启用');
    } catch { toast('error', '操作失败'); }
  }

  async function handleDelete() {
    if (!deleteChallenge) return;
    setFormLoading(true);
    try {
      await api.del(`/api/admin/challenges/${deleteChallenge.id}`);
      setDeleteChallenge(null); loadChallenges(); toast('success', '题目已删除');
    } catch { toast('error', '删除失败'); }
    finally { setFormLoading(false); }
  }

  return (
    <>
      <Card>
        {hasPermission('config.write') && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }}>添加题目</Button>
          </div>
        )}
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : loadError ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadChallenges()}>重试</Button></div>
        ) : (
          <ResponsiveTable
            columns={[
              { header: '题目', accessor: 'question', render: (c) => <span style={{ fontSize: 'var(--text-sm)' }}>{c.question}</span> },
              { header: '状态', accessor: 'enabled', render: (c) => c.enabled ? (
                <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>启用</span>
              ) : (
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>禁用</span>
              )},
              { header: '操作', accessor: 'actions', render: (c) => hasPermission('config.write') ? (
                <div className="cluster" style={{ gap: 'var(--space-1)' }}>
                  <Button size="sm" variant="ghost" onClick={() => handleToggle(c)}>{c.enabled ? '禁用' : '启用'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditChallenge(c); setQuestion(c.question); setAnswer(''); setFormError(''); }}>编辑</Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteChallenge(c)}>删除</Button>
                </div>
              ) : null },
            ]}
            data={challenges}
            keyExtractor={(c) => c.id}
            emptyMessage="暂无题目"
          />
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); resetForm(); }}
        title="添加安全题目"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setDialogOpen(false); resetForm(); }}>取消</Button>
            <Button onClick={handleCreate} loading={formLoading}>添加</Button>
          </div>
        }
      >
        <div className="stack">
          <TextField label="题目" value={question} onChange={(e) => setQuestion(e.target.value)} error={formError} placeholder="安全问题" />
          <TextField label="答案" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="答案" />
        </div>
      </Dialog>

      <Dialog
        open={!!editChallenge}
        onClose={() => { setEditChallenge(null); resetForm(); }}
        title="编辑安全题目"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setEditChallenge(null); resetForm(); }}>取消</Button>
            <Button onClick={handleUpdate} loading={formLoading}>保存</Button>
          </div>
        }
      >
        <div className="stack">
          <TextField label="题目" value={question} onChange={(e) => setQuestion(e.target.value)} error={formError} />
          <TextField label="新答案 (留空不修改)" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        </div>
      </Dialog>

      <Dialog
        open={!!deleteChallenge}
        onClose={() => setDeleteChallenge(null)}
        title="删除题目"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setDeleteChallenge(null)}>取消</Button>
            <Button variant="danger" onClick={handleDelete} loading={formLoading}>确认删除</Button>
          </div>
        }
      >
        <p>确认删除题目 <strong>{deleteChallenge?.question}</strong>?</p>
      </Dialog>
    </>
  );
}

/* ─── Custom Fields Section ─────────────────────────────────────────────────── */

function FieldsSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [fields, setFields] = useState<UserField[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editField, setEditField] = useState<UserField | null>(null);
  const [deleteField, setDeleteField] = useState<UserField | null>(null);

  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [choicesText, setChoicesText] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadFields = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; fields: UserField[] }>('/api/admin/user-fields');
      setFields(res.fields);
    } catch (error) { const message = error instanceof Error ? error.message : '获取字段列表失败'; setLoadError(message); toast('error', message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadFields(); }, [loadFields]);

  function resetForm() {
    setFieldKey(''); setFieldLabel(''); setFieldType('text'); setChoicesText('');
    setIsRequired(false); setIsPublic(true); setFormError('');
  }

  function openFieldEditor(field?: UserField) {
    setEditField(field || null);
    setFieldKey(field?.field_key || ''); setFieldLabel(field?.field_label || ''); setFieldType(field?.field_type || 'text');
    setIsRequired(Boolean(field?.is_required)); setIsPublic(field ? Boolean(field.is_public) : true);
    try { const options = field?.options ? JSON.parse(field.options) : null; setChoicesText(Array.isArray(options?.choices) ? options.choices.join('\n') : ''); }
    catch { setChoicesText(''); }
    setFormError(''); setDialogOpen(true);
  }

  function fieldOptions() {
    return fieldType === 'select' ? { choices: choicesText.split('\n').map(choice => choice.trim()).filter(Boolean) } : null;
  }

  async function handleCreate() {
    if (!fieldKey.trim() || !fieldLabel.trim()) { setFormError('field_key 和 field_label 必填'); return; }
    if (!editField && !/^[a-z][a-z0-9_]{1,30}$/.test(fieldKey)) { setFormError('field_key 须为小写字母开头，仅含字母数字下划线'); return; }
    if (fieldType === 'select' && !fieldOptions()?.choices.length) { setFormError('下拉选项至少填写一项'); return; }

    setFormLoading(true); setFormError('');
    try {
      const data = { field_key: fieldKey.trim(), field_label: fieldLabel.trim(), field_type: fieldType, is_required: isRequired, is_public: isPublic, options: fieldOptions() };
      if (editField) await api.put(`/api/admin/user-fields/${editField.id}`, { field_label: data.field_label, field_type: data.field_type, is_required: data.is_required, is_public: data.is_public, options: data.options });
      else await api.post('/api/admin/user-fields', data);
      setDialogOpen(false); resetForm(); setEditField(null); loadFields(); toast('success', editField ? '字段已更新' : '字段已创建');
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : '创建失败'); }
    finally { setFormLoading(false); }
  }

  async function handleDelete() {
    if (!deleteField) return;
    setFormLoading(true);
    try {
      await api.del(`/api/admin/user-fields/${deleteField.id}`);
      setDeleteField(null); loadFields(); toast('success', '字段已删除');
    } catch { toast('error', '删除失败'); }
    finally { setFormLoading(false); }
  }

  async function moveField(field: UserField, direction: -1 | 1) {
    const ordered = [...fields].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const index = ordered.findIndex(item => item.id === field.id); const next = index + direction;
    if (next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    try { await api.patch('/api/admin/user-fields/sort', { orders: ordered.map((item, order) => ({ id: item.id, sort_order: order })) }); await loadFields(); }
    catch (err) { toast('error', err instanceof Error ? err.message : '排序失败'); }
  }

  return (
    <>
      <Card>
        {hasPermission('config.write') && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Button size="sm" onClick={() => openFieldEditor()}>添加字段</Button>
          </div>
        )}
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : loadError ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadFields()}>重试</Button></div>
        ) : (
          <ResponsiveTable
            columns={[
              { header: 'Key', accessor: 'key', render: (f) => <code style={{ fontSize: 'var(--text-xs)' }}>{f.field_key}</code> },
              { header: '标签', accessor: 'label', render: (f) => f.field_label },
              { header: '类型', accessor: 'type', render: (f) => f.field_type === 'select' ? '下拉选择' : f.field_type },
              { header: '必填', accessor: 'required', render: (f) => f.is_required ? '是' : '否' },
              { header: '公开', accessor: 'public', render: (f) => f.is_public ? '是' : '否' },
              ...(hasPermission('config.write') ? [{
                header: '操作',
                accessor: 'actions',
                render: (f: UserField) => (
                  <div className="admin-row-actions"><Button size="sm" variant="ghost" onClick={() => moveField(f, -1)}>上移</Button><Button size="sm" variant="ghost" onClick={() => moveField(f, 1)}>下移</Button><Button size="sm" variant="secondary" onClick={() => openFieldEditor(f)}>编辑</Button><Button size="sm" variant="danger" onClick={() => setDeleteField(f)}>删除</Button></div>
                ),
              }] : []),
            ]}
            data={fields}
            keyExtractor={(f) => f.id}
            emptyMessage="暂无自定义字段"
          />
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); resetForm(); }}
        title={editField ? '编辑自定义字段' : '添加自定义字段'}
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setDialogOpen(false); resetForm(); setEditField(null); }}>取消</Button>
            <Button onClick={handleCreate} loading={formLoading}>{editField ? '保存' : '创建'}</Button>
          </div>
        }
      >
        <div className="stack">
          <TextField label="field_key" value={fieldKey} disabled={Boolean(editField)} onChange={(e) => setFieldKey(e.target.value)} error={formError} hint="小写字母开头，仅含字母数字下划线" placeholder="e.g. discord_id" />
          <TextField label="field_label" value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} placeholder="显示名称" />
          <div>
            <label className="field__label">field_type</label>
            <select className="field__input" value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
              <option value="text">text</option>
              <option value="textarea">textarea</option>
              <option value="number">number</option>
              <option value="select">select</option>
              <option value="url">url</option>
            </select>
          </div>
          {fieldType === 'select' && <label className="field"><span className="field__label">下拉选项（每行一项）</span><textarea className="field__input" rows={4} value={choicesText} onChange={e => setChoicesText(e.target.value)} placeholder={'选项一\n选项二'} /></label>}
          <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            <span style={{ fontSize: 'var(--text-sm)' }}>必填</span>
          </label>
          <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            <span style={{ fontSize: 'var(--text-sm)' }}>公开可见</span>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={!!deleteField}
        onClose={() => setDeleteField(null)}
        title="删除字段"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => setDeleteField(null)}>取消</Button>
            <Button variant="danger" onClick={handleDelete} loading={formLoading}>确认删除</Button>
          </div>
        }
      >
        <p>确认删除字段 <strong>{deleteField?.field_label}</strong>? 关联的用户数据也会被删除。</p>
      </Dialog>
    </>
  );
}
