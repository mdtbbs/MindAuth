import { useCallback, useEffect, useState } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
import { TextField } from '@/shared/TextField';

interface EmailRule {
  id: number; match_type: 'exact' | 'suffix'; pattern: string; policy: 'allow' | 'deny';
  reason: string | null; enabled: number | boolean; hit_count: number; last_hit_at: string | null; created_at: string;
}
interface RuleForm { match_type: 'exact' | 'suffix'; pattern: string; policy: 'allow' | 'deny'; reason: string; enabled: boolean }
const initialForm: RuleForm = { match_type: 'exact', pattern: '', policy: 'deny', reason: '', enabled: true };

export function AdminEmailPolicyPage() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const canWrite = hasPermission('email_rules.write');
  const [rules, setRules] = useState<EmailRule[]>([]);
  const [allowlistMode, setAllowlistMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<'edit' | 'batch' | 'mode' | null>(null);
  const [editing, setEditing] = useState<EmailRule | null>(null);
  const [form, setForm] = useState<RuleForm>(initialForm);
  const [batchText, setBatchText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<EmailRule | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const res = await api.get<{ success: boolean; rules: EmailRule[]; allowlist_mode: boolean }>(`/api/admin/email-policy${query ? `?search=${encodeURIComponent(query)}` : ''}`, { signal });
      setRules(res.rules || []);
      setAllowlistMode(Boolean(res.allowlist_mode));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '获取邮箱策略失败');
    } finally { setLoading(false); }
  }, [query]);

  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => load(controller.signal), 180); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);

  async function toggleMode() {
    if (!allowlistMode) { setDialog('mode'); return; }
    await saveMode(false);
  }

  async function saveMode(allowlist_mode: boolean) {
    setBusy(true);
    try {
      const res = await api.patch<{ allowlist_mode: boolean }>('/api/admin/email-policy/mode', { allowlist_mode });
      setAllowlistMode(res.allowlist_mode);
      setDialog(null);
      toast('success', res.allowlist_mode ? '白名单模式已启用' : '白名单模式已关闭');
    } catch (err) { toast('error', err instanceof Error ? err.message : '更新模式失败'); }
    finally { setBusy(false); }
  }

  function openCreate() { setEditing(null); setForm(initialForm); setDialog('edit'); }
  function openEdit(rule: EmailRule) { setEditing(rule); setForm({ match_type: rule.match_type, pattern: rule.pattern, policy: rule.policy, reason: rule.reason || '', enabled: Boolean(rule.enabled) }); setDialog('edit'); }

  async function saveRule() {
    setBusy(true);
    try {
      const body = { ...form, pattern: form.pattern.trim() };
      if (editing) await api.put(`/api/admin/email-policy/${editing.id}`, body);
      else await api.post('/api/admin/email-policy', body);
      setDialog(null); toast('success', editing ? '邮箱规则已更新' : '邮箱规则已创建'); await load();
    } catch (err) { toast('error', err instanceof Error ? err.message : '保存失败'); }
    finally { setBusy(false); }
  }

  async function toggleRule(rule: EmailRule) {
    setBusy(true);
    try {
      await api.put(`/api/admin/email-policy/${rule.id}`, { match_type: rule.match_type, pattern: rule.pattern, policy: rule.policy, reason: rule.reason, enabled: !Boolean(rule.enabled) });
      await load();
    } catch (err) { toast('error', err instanceof Error ? err.message : '更新失败'); }
    finally { setBusy(false); }
  }

  async function addBatch() {
    setBusy(true);
    try {
      const res = await api.post<{ created_count: number; duplicate_count: number }>('/api/admin/email-policy/batch', { patterns: batchText });
      setDialog(null); setBatchText(''); await load();
      toast('success', `新增 ${res.created_count} 条，重复 ${res.duplicate_count} 条`);
    } catch (err) { toast('error', err instanceof Error ? err.message : '批量添加失败'); }
    finally { setBusy(false); }
  }

  async function removeRule() {
    if (!deleteTarget) return;
    setBusy(true);
    try { await api.del(`/api/admin/email-policy/${deleteTarget.id}`); setDeleteTarget(null); await load(); toast('success', '邮箱规则已删除'); }
    catch (err) { toast('error', err instanceof Error ? err.message : '删除失败'); }
    finally { setBusy(false); }
  }

  return <div className="admin-page">
    <div className="admin-page-heading"><div><h1 className="admin-page-title">邮箱策略</h1><p className="admin-page-lead">统一管理注册、邮箱更换和验证流程使用的邮箱域名规则。</p></div>{canWrite && <div className="admin-toolbar"><Button variant="secondary" onClick={() => { setBatchText(''); setDialog('batch'); }}>批量添加</Button><Button onClick={openCreate}>新增规则</Button></div>}</div>
    <Card>
      <div className="admin-policy-mode"><div><strong>邮箱白名单模式</strong><p>默认允许所有邮箱，仅拦截拒绝规则。{allowlistMode && <span className="admin-warning-text">启用后，未匹配允许规则的邮箱将无法注册或绑定。</span>}</p></div><button type="button" className={`admin-switch${allowlistMode ? ' is-on' : ''}`} role="switch" aria-checked={allowlistMode} disabled={!canWrite || busy} onClick={toggleMode}><span /></button></div>
    </Card>
    <section className="admin-section">
      <div className="admin-section-heading"><h2>规则</h2><label className="admin-search"><span className="sr-only">搜索规则</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索域名或备注" /></label></div>
      {loading ? <div className="admin-inline-state">正在加载规则…</div> : error ? <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{error}</p><Button size="sm" variant="secondary" onClick={() => load()}>重试</Button></div> : rules.length === 0 ? <div className="admin-inline-state">{query ? '没有匹配的规则' : '还没有邮箱域名规则'}</div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>域名</th><th>匹配</th><th>策略</th><th>状态</th><th>命中</th><th>最近命中</th><th>备注</th><th>创建时间</th>{canWrite && <th>操作</th>}</tr></thead><tbody>{rules.map(rule => <tr key={rule.id}>
        <td><code>{rule.pattern}</code></td><td>{rule.match_type === 'suffix' ? '域名后缀' : '完全匹配'}</td><td><span className={`admin-badge ${rule.policy === 'deny' ? 'is-danger' : 'is-success'}`}>{rule.policy === 'deny' ? '拒绝' : '允许'}</span></td><td>{Boolean(rule.enabled) ? '启用' : '停用'}</td><td>{Number(rule.hit_count).toLocaleString('zh-CN')}</td><td>{rule.last_hit_at ? new Date(rule.last_hit_at).toLocaleString('zh-CN') : '—'}</td><td>{rule.reason || '—'}</td><td>{new Date(rule.created_at).toLocaleDateString('zh-CN')}</td>
        {canWrite && <td><div className="admin-row-actions"><button type="button" onClick={() => openEdit(rule)}>编辑</button><button type="button" onClick={() => toggleRule(rule)} disabled={busy}>{Boolean(rule.enabled) ? '停用' : '启用'}</button><button type="button" className="is-danger" onClick={() => setDeleteTarget(rule)}>删除</button></div></td>}
      </tr>)}</tbody></table></div>}
    </section>
    <Dialog open={dialog === 'edit'} onClose={() => setDialog(null)} title={editing ? '编辑邮箱规则' : '新增邮箱规则'} footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setDialog(null)}>取消</Button><Button onClick={saveRule} loading={busy}>保存</Button></div>}>
      <div className="admin-form-stack"><TextField label="邮箱域名" value={form.pattern} onChange={e => setForm({ ...form, pattern: e.target.value })} placeholder="@Example.COM" hint="保存时会转换为小写 IDN 域名并移除 @。" />
        <label className="field"><span className="field__label">匹配方式</span><select value={form.match_type} onChange={e => setForm({ ...form, match_type: e.target.value as RuleForm['match_type'] })}><option value="exact">完全匹配</option><option value="suffix">域名后缀（含子域名）</option></select></label>
        <label className="field"><span className="field__label">策略</span><select value={form.policy} onChange={e => setForm({ ...form, policy: e.target.value as RuleForm['policy'] })}><option value="deny">拒绝</option><option value="allow">允许</option></select></label>
        <label className="field"><span className="field__label">管理员备注</span><textarea value={form.reason} maxLength={500} rows={3} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
        <label className="admin-check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />启用此规则</label>
      </div>
    </Dialog>
    <Dialog open={dialog === 'batch'} onClose={() => setDialog(null)} title="批量添加拒绝规则" footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setDialog(null)}>取消</Button><Button onClick={addBatch} loading={busy}>添加规则</Button></div>}>
      <label className="field"><span className="field__label">邮箱域名</span><textarea rows={8} value={batchText} onChange={e => setBatchText(e.target.value)} placeholder={'mailinator.com\ntempmail.com\n10minutemail.com'} /><span className="field__hint">每行一个域名；自动去重、转小写并移除 @。</span></label>
    </Dialog>
    <Dialog open={dialog === 'mode'} onClose={() => setDialog(null)} title="启用邮箱白名单模式" footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setDialog(null)}>取消</Button><Button variant="danger" onClick={() => void saveMode(true)} loading={busy}>确认启用</Button></div>}>
      <div className="admin-danger-note"><strong>未匹配允许规则的邮箱将无法注册、修改或完成验证。</strong><p>请先确认所需邮箱域名都配置了 allow 规则。deny 规则仍然优先生效。</p></div>
    </Dialog>
    <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="删除邮箱规则" footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" onClick={removeRule} loading={busy}>确认删除</Button></div>}><p>删除 <code>{deleteTarget?.pattern}</code> 后，相关邮箱地址可能重新通过策略检查。</p></Dialog>
  </div>;
}
