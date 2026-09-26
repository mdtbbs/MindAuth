import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { ResponsiveTable } from '@/shared/ResponsiveTable';
import { SkeletonTable } from '@/shared/Skeleton';
import { Dialog } from '@/shared/Dialog';
import { useDebouncedValue } from '@/shared/useDebouncedValue';
import type { AdminLoginLogEntry, AuditLogEntry, SmsAuditLogEntry, PaginationData } from '@/api/types';

type LogsTab = 'login' | 'audit' | 'sms';

export function AdminLogsPage({ initialSection, standalone = false }: { initialSection?: LogsTab; standalone?: boolean }) {
  const [activeTab, setActiveTab] = useState<LogsTab>(initialSection || 'login');
  const { hasPermission } = useAdminAuth();
  useEffect(() => { if (initialSection) setActiveTab(initialSection); }, [initialSection]);

  const tabs: { id: LogsTab; label: string; perm: string }[] = [
    { id: 'login', label: '登录日志', perm: 'login_logs.read' },
    { id: 'audit', label: '管理审计', perm: 'audit_logs.read' },
    { id: 'sms', label: '短信审计', perm: 'sms_audit.read' },
  ];

  const visibleTabs = tabs.filter((t) => hasPermission(t.perm));
  const firstVisibleTab = visibleTabs[0]?.id;
  const activeTabVisible = visibleTabs.some((tab) => tab.id === activeTab);

  useEffect(() => {
    if (firstVisibleTab && !activeTabVisible) {
      setActiveTab(firstVisibleTab);
    }
  }, [activeTabVisible, firstVisibleTab]);

  return (
    <div>
      <h1 className="admin-page-title">
        {standalone ? (activeTab === 'login' ? '登录记录' : activeTab === 'audit' ? '管理日志' : '短信记录') : '记录'}
      </h1>

      {/* Tab bar */}
      {!standalone && <div className="cluster" style={{ marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`logs-panel-${tab.id}`}
            id={`logs-tab-${tab.id}`}
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

      {activeTab === 'login' && (
        <div role="tabpanel" id="logs-panel-login" aria-labelledby="logs-tab-login"><LoginLogsSection /></div>
      )}
      {activeTab === 'audit' && (
        <div role="tabpanel" id="logs-panel-audit" aria-labelledby="logs-tab-audit"><AuditLogsSection /></div>
      )}
      {activeTab === 'sms' && (
        <div role="tabpanel" id="logs-panel-sms" aria-labelledby="logs-tab-sms"><SmsLogsSection /></div>
      )}
    </div>
  );
}

/* ─── Login Logs Section ────────────────────────────────────────────────────── */

function LoginLogsSection() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AdminLoginLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [userIdFilter, setUserIdFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const debouncedUserId = useDebouncedValue(userIdFilter, 300);
  const requestSeq = useRef(0);

  const loadLogs = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadError('');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('limit', '50');
      if (debouncedUserId) params.append('user_id', debouncedUserId);
      if (typeFilter) params.append('login_type', typeFilter);
      if (ipFilter.trim()) params.append('ip', ipFilter.trim());
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);

      const res = await api.get<{ success: boolean; logs: AdminLoginLogEntry[] }>(
        `/api/admin/login-logs?${params.toString()}`
      );
      if (seq !== requestSeq.current) return;
      setLogs(res.logs);
    } catch (error) { if (seq === requestSeq.current) { const message = error instanceof Error ? error.message : '获取登录日志失败'; setLoadError(message); toast('error', message); } }
    finally { if (seq === requestSeq.current) setLoading(false); }
  }, [currentPage, debouncedUserId, typeFilter, ipFilter, startDate, endDate, toast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
      <Card padding="sm">
        <form className="admin-filter-bar" onSubmit={(e) => { e.preventDefault(); setCurrentPage(1); loadLogs(); }}>
          <TextField label="" placeholder="用户 ID" value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} style={{ maxWidth: '120px' }} />
          <TextField label="" placeholder="IP 地址" value={ipFilter} onChange={(e) => setIpFilter(e.target.value)} style={{ maxWidth: '180px' }} />
          <select className="field__input" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }} style={{ maxWidth: '120px' }}>
            <option value="">全部类型</option>
            <option value="web">Web</option>
            <option value="oauth">OAuth</option>
          </select>
          <label className="admin-date-filter"><span>从</span><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label className="admin-date-filter"><span>至</span><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
          <Button type="submit" size="sm">筛选</Button>
        </form>
      </Card>
      </div>
      <p className="admin-data-note">登录日志只记录成功登录；失败次数请在风控中心查看。</p>

      <Card>
        {loading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : loadError ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadLogs()}>重试</Button></div>
        ) : (
          <ResponsiveTable
            columns={[
              { header: '用户', accessor: 'username', render: (l) => l.username || `#${l.user_id}` },
              { header: 'IP', accessor: 'ip', render: (l) => <code style={{ fontSize: 'var(--text-xs)' }}>{l.ip}</code> },
              { header: '设备', accessor: 'device', render: (l) => <span style={{ fontSize: 'var(--text-sm)' }}>{l.device || '—'}</span> },
              { header: '类型', accessor: 'type', render: (l) => (
                <span style={{
                  fontSize: 'var(--text-xs)',
                  padding: 'var(--space-1) var(--space-2)',
                  background: l.login_type === 'oauth' ? 'var(--color-info-bg)' : 'var(--color-bg-sunken)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  {l.login_type === 'oauth' ? 'OAuth' : 'Web'}
                </span>
              )},
              { header: '时间', accessor: 'time', render: (l) => (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {new Date(l.created_at).toLocaleString('zh-CN')}
                </span>
              )},
            ]}
            data={logs}
            keyExtractor={(l) => l.id}
            emptyMessage="暂无登录日志"
          />
        )}
      </Card>
    </div>
  );
}

/* ─── Audit Logs Section ────────────────────────────────────────────────────── */

function AuditLogsSection() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [adminIdFilter, setAdminIdFilter] = useState('');
  const [targetIdFilter, setTargetIdFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedAudit, setSelectedAudit] = useState<AuditLogEntry | null>(null);
  const debouncedAction = useDebouncedValue(actionFilter, 300);
  const requestSeq = useRef(0);

  const loadLogs = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadError('');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('limit', '50');
      if (debouncedAction) params.append('action', debouncedAction);
      if (targetTypeFilter) params.append('target_type', targetTypeFilter);
      if (adminIdFilter.trim()) params.append('admin_id', adminIdFilter.trim());
      if (targetIdFilter.trim()) params.append('target_id', targetIdFilter.trim());
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);

      const res = await api.get<{ success: boolean; logs: AuditLogEntry[]; pagination?: PaginationData }>(
        `/api/admin/audit-logs?${params.toString()}`
      );
      if (seq !== requestSeq.current) return;
      setLogs(res.logs);
      if (res.pagination) setPagination(res.pagination);
    } catch (error) { if (seq === requestSeq.current) { const message = error instanceof Error ? error.message : '获取审计日志失败'; setLoadError(message); toast('error', message); } }
    finally { if (seq === requestSeq.current) setLoading(false); }
  }, [currentPage, debouncedAction, targetTypeFilter, adminIdFilter, targetIdFilter, startDate, endDate, toast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
      <Card padding="sm">
        <form className="admin-filter-bar" onSubmit={(e) => { e.preventDefault(); setCurrentPage(1); loadLogs(); }}>
          <TextField label="" placeholder="操作 (如 user.ban)" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ maxWidth: '200px' }} />
          <TextField label="" placeholder="管理员 ID" value={adminIdFilter} onChange={e => setAdminIdFilter(e.target.value)} style={{ maxWidth: '120px' }} />
          <TextField label="" placeholder="目标 ID" value={targetIdFilter} onChange={e => setTargetIdFilter(e.target.value)} style={{ maxWidth: '120px' }} />
          <select className="field__input" value={targetTypeFilter} onChange={(e) => { setTargetTypeFilter(e.target.value); setCurrentPage(1); }} style={{ maxWidth: '150px' }}>
            <option value="">全部类型</option>
            <option value="user">用户</option>
            <option value="config">配置</option>
            <option value="ip_ban">IP 黑名单</option>
            <option value="challenge">题库</option>
            <option value="user_field">自定义字段</option>
          </select>
          <label className="admin-date-filter"><span>从</span><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label className="admin-date-filter"><span>至</span><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
          <Button type="submit" size="sm">筛选</Button>
        </form>
      </Card>
      </div>

      <Card>
        {loading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : loadError ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadLogs()}>重试</Button></div>
        ) : (
          <ResponsiveTable
            columns={[
              { header: '管理员 ID', accessor: 'admin', render: (l) => <span style={{ fontSize: 'var(--text-sm)' }}>#{l.admin_id}</span> },
              { header: '操作', accessor: 'action', render: (l) => (
                <code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-sunken)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                  {l.action}
                </code>
              )},
              { header: '目标', accessor: 'target', render: (l) => (
                <span style={{ fontSize: 'var(--text-sm)' }}>
                  {l.target_type}{l.target_id ? ` #${l.target_id}` : ''}
                </span>
              )},
              { header: '详情', accessor: 'details', render: (l) => <Button size="sm" variant="secondary" onClick={() => setSelectedAudit(l)}>查看 JSON</Button> },
              { header: 'IP', accessor: 'ip', render: (l) => <code style={{ fontSize: 'var(--text-xs)' }}>{l.ip_address}</code> },
              { header: '时间', accessor: 'time', render: (l) => (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {new Date(l.created_at).toLocaleString('zh-CN')}
                </span>
              )},
            ]}
            data={logs}
            keyExtractor={(l) => l.id}
            emptyMessage="暂无审计日志"
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
      <Dialog open={!!selectedAudit} onClose={() => setSelectedAudit(null)} title="管理操作详情" footer={<div className="cluster cluster--end"><Button variant="secondary" onClick={() => setSelectedAudit(null)}>关闭</Button></div>}>
        {selectedAudit && <div className="admin-form-stack"><dl className="admin-detail-list"><div><dt>操作</dt><dd><code>{selectedAudit.action}</code></dd></div><div><dt>目标</dt><dd>{selectedAudit.target_type} {selectedAudit.target_id ? `#${selectedAudit.target_id}` : ''}</dd></div><div><dt>管理员</dt><dd>#{selectedAudit.admin_id}</dd></div><div><dt>时间</dt><dd>{new Date(selectedAudit.created_at).toLocaleString('zh-CN')}</dd></div><div><dt>来源 IP</dt><dd><code>{selectedAudit.ip_address}</code></dd></div></dl><pre className="admin-json-detail">{(() => { if (!selectedAudit.details) return '无附加详情'; try { return JSON.stringify(JSON.parse(selectedAudit.details), null, 2); } catch { return selectedAudit.details; } })()}</pre></div>}
      </Dialog>
    </div>
  );
}

/* ─── SMS Audit Logs Section ────────────────────────────────────────────────── */

function SmsLogsSection() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<SmsAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [phoneLast4, setPhoneLast4] = useState('');
  const debouncedPhone = useDebouncedValue(phoneLast4, 300);

  const requestSeq = useRef(0);

  const loadLogs = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadError('');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('limit', '50');
      if (actionFilter) params.append('action', actionFilter);
      if (debouncedPhone) params.append('phone_last4', debouncedPhone);

      const res = await api.get<{ success: boolean; logs: SmsAuditLogEntry[]; pagination?: PaginationData }>(
        `/api/admin/sms-audit-logs?${params.toString()}`
      );
      if (seq !== requestSeq.current) return;
      setLogs(res.logs);
      if (res.pagination) setPagination(res.pagination);
    } catch (error) { if (seq === requestSeq.current) { const message = error instanceof Error ? error.message : '获取短信审计日志失败'; setLoadError(message); toast('error', message); } }
    finally { if (seq === requestSeq.current) setLoading(false); }
  }, [currentPage, actionFilter, debouncedPhone, toast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
      <Card padding="sm">
        <form className="cluster" style={{ gap: 'var(--space-3)' }} onSubmit={(e) => { e.preventDefault(); setCurrentPage(1); loadLogs(); }}>
          <select className="field__input" value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setCurrentPage(1); }} style={{ maxWidth: '150px' }}>
            <option value="">全部操作</option>
            <option value="send_code">发送验证码</option>
            <option value="verify_code">验证验证码</option>
          </select>
          <TextField label="" placeholder="手机尾号 4 位" value={phoneLast4} onChange={(e) => setPhoneLast4(e.target.value)} style={{ maxWidth: '120px' }} />
          <Button type="submit" size="sm">筛选</Button>
        </form>
      </Card>
      </div>

      <Card>
        {loading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : loadError ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadLogs()}>重试</Button></div>
        ) : (
          <ResponsiveTable
            columns={[
              { header: '用户', accessor: 'username', render: (l) => l.username || `#${l.user_id}` },
              { header: '操作', accessor: 'action', render: (l) => (
                <span style={{ fontSize: 'var(--text-sm)' }}>
                  {l.action === 'send_code' ? '发送验证码' : '验证验证码'}
                </span>
              )},
              { header: '手机号', accessor: 'phone', render: (l) => <code style={{ fontSize: 'var(--text-xs)' }}>{l.phone_masked}</code> },
              { header: '结果', accessor: 'success', render: (l) => l.success ? (
                <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-xs)' }}>成功</span>
              ) : (
                <span style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>失败</span>
              )},
              { header: 'IP', accessor: 'ip', render: (l) => <code style={{ fontSize: 'var(--text-xs)' }}>{l.ip_address}</code> },
              { header: '时间', accessor: 'time', render: (l) => (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {new Date(l.created_at).toLocaleString('zh-CN')}
                </span>
              )},
            ]}
            data={logs}
            keyExtractor={(l) => l.id}
            emptyMessage="暂无短信审计日志"
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
    </div>
  );
}
