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

export function AdminSecurityPage() {
  const [activeTab, setActiveTab] = useState<SecurityTab>('ip_bans');

  const tabs: { id: SecurityTab; label: string; perm: string }[] = [
    { id: 'ip_bans', label: 'IP 黑名单', perm: 'ip_bans.read' },
    { id: 'challenges', label: '安全题库', perm: 'config.read' },
    { id: 'fields', label: '自定义字段', perm: 'config.read' },
  ];

  const { hasPermission } = useAdminAuth();
  const visibleTabs = tabs.filter((t) => hasPermission(t.perm));

  return (
    <div>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-6)' }}>
        安全设置
      </h1>

      {/* Tab bar */}
      <div className="cluster" style={{ marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
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
      </div>

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
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteBan, setDeleteBan] = useState<IpBan | null>(null);

  // Form state
  const [ip, setIp] = useState('');
  const [cidrPrefix, setCidrPrefix] = useState('');
  const [banReason, setBanReason] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadBans = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; bans: IpBan[]; pagination?: PaginationData }>(
        `/api/admin/ip-bans?page=${currentPage}&limit=20`
      );
      setBans(res.bans);
      if (res.pagination) setPagination(res.pagination);
    } catch {
      toast('error', '获取 IP 黑名单失败');
    } finally {
      setLoading(false);
    }
  }, [currentPage, toast]);

  useEffect(() => { loadBans(); }, [loadBans]);

  async function handleAdd() {
    if (!ip.trim()) { setFormError('IP 地址必填'); return; }
    const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Re.test(ip.trim())) { setFormError('IP 地址格式无效'); return; }
    if (cidrPrefix && (isNaN(Number(cidrPrefix)) || Number(cidrPrefix) < 0 || Number(cidrPrefix) > 32)) {
      setFormError('CIDR 前缀须为 0-32'); return;
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
                  <Button size="sm" variant="danger" onClick={() => setDeleteBan(b)}>删除</Button>
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
          <TextField label="IP 地址" value={ip} onChange={(e) => setIp(e.target.value)} error={formError} placeholder="例如: 192.168.1.1" />
          <TextField label="CIDR 前缀 (可选)" value={cidrPrefix} onChange={(e) => setCidrPrefix(e.target.value)} hint="0-32，留空表示单个 IP" placeholder="例如: 24" />
          <TextField label="原因 (可选)" value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="封禁原因" />
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editChallenge, setEditChallenge] = useState<Challenge | null>(null);
  const [deleteChallenge, setDeleteChallenge] = useState<Challenge | null>(null);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadChallenges = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; challenges: Challenge[] }>('/api/admin/challenges');
      setChallenges(res.challenges);
    } catch { toast('error', '获取题库失败'); }
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteField, setDeleteField] = useState<UserField | null>(null);

  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [isRequired, setIsRequired] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const loadFields = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; fields: UserField[] }>('/api/admin/user-fields');
      setFields(res.fields);
    } catch { toast('error', '获取字段列表失败'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadFields(); }, [loadFields]);

  function resetForm() {
    setFieldKey(''); setFieldLabel(''); setFieldType('text');
    setIsRequired(false); setIsPublic(true); setFormError('');
  }

  async function handleCreate() {
    if (!fieldKey.trim() || !fieldLabel.trim()) { setFormError('field_key 和 field_label 必填'); return; }
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(fieldKey)) { setFormError('field_key 须为小写字母开头，仅含字母数字下划线'); return; }

    setFormLoading(true); setFormError('');
    try {
      await api.post('/api/admin/user-fields', {
        field_key: fieldKey.trim(),
        field_label: fieldLabel.trim(),
        field_type: fieldType,
        is_required: isRequired,
        is_public: isPublic,
      });
      setDialogOpen(false); resetForm(); loadFields(); toast('success', '字段已创建');
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

  return (
    <>
      <Card>
        {hasPermission('config.write') && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }}>添加字段</Button>
          </div>
        )}
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : (
          <ResponsiveTable
            columns={[
              { header: 'Key', accessor: 'key', render: (f) => <code style={{ fontSize: 'var(--text-xs)' }}>{f.field_key}</code> },
              { header: '标签', accessor: 'label', render: (f) => f.field_label },
              { header: '类型', accessor: 'type', render: (f) => f.field_type },
              { header: '必填', accessor: 'required', render: (f) => f.is_required ? '是' : '否' },
              { header: '公开', accessor: 'public', render: (f) => f.is_public ? '是' : '否' },
              ...(hasPermission('config.write') ? [{
                header: '操作',
                accessor: 'actions',
                render: (f: UserField) => (
                  <Button size="sm" variant="danger" onClick={() => setDeleteField(f)}>删除</Button>
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
        title="添加自定义字段"
        footer={
          <div className="cluster cluster--end">
            <Button variant="secondary" onClick={() => { setDialogOpen(false); resetForm(); }}>取消</Button>
            <Button onClick={handleCreate} loading={formLoading}>创建</Button>
          </div>
        }
      >
        <div className="stack">
          <TextField label="field_key" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} error={formError} hint="小写字母开头，仅含字母数字下划线" placeholder="e.g. discord_id" />
          <TextField label="field_label" value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} placeholder="显示名称" />
          <div>
            <label className="field__label">field_type</label>
            <select className="field__input" value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
              <option value="text">text</option>
              <option value="textarea">textarea</option>
              <option value="number">number</option>
              <option value="url">url</option>
            </select>
          </div>
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
