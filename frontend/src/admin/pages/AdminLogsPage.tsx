import { useState, useEffect, useCallback } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { ResponsiveTable } from '@/shared/ResponsiveTable';
import { SkeletonTable } from '@/shared/Skeleton';
import { useDebouncedValue } from '@/shared/useDebouncedValue';
import type { AdminLoginLogEntry, AuditLogEntry, SmsAuditLogEntry, PaginationData } from '@/api/types';

type LogsTab = 'login' | 'audit' | 'sms';

export function AdminLogsPage() {
  const [activeTab, setActiveTab] = useState<LogsTab>('login');
  const { hasPermission } = useAdminAuth();

  const tabs: { id: LogsTab; label: string; perm: string }[] = [
    { id: 'login', label: '登录日志', perm: 'login_logs.read' },
    { id: 'audit', label: '管理审计', perm: 'audit_logs.read' },
    { id: 'sms', label: '短信审计', perm: 'sms_audit.read' },
  ];

  const visibleTabs = tabs.filter((t) => hasPermission(t.perm));

  return (
    <div>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-6)' }}>
        日志查看
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

      {activeTab === 'login' && <LoginLogsSection />}
      {activeTab === 'audit' && <AuditLogsSection />}
      {activeTab === 'sms' && <SmsLogsSection />}
    </div>
  );
}

/* ─── Login Logs Section ────────────────────────────────────────────────────── */

function LoginLogsSection() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AdminLoginLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [userIdFilter, setUserIdFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const debouncedUserId = useDebouncedValue(userIdFilter, 300);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('limit', '50');
      if (debouncedUserId) params.append('user_id', debouncedUserId);
      if (typeFilter) params.append('login_type', typeFilter);

      const res = await api.get<{ success: boolean; logs: AdminLoginLogEntry[] }>(
        `/api/admin/login-logs?${params.toString()}`
      );
      setLogs(res.logs);
    } catch { toast('error', '获取登录日志失败'); }
    finally { setLoading(false); }
  }, [currentPage, debouncedUserId, typeFilter, toast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
      <Card padding="sm">
        <form className="cluster" style={{ gap: 'var(--space-3)' }} onSubmit={(e) => { e.preventDefault(); setCurrentPage(1); loadLogs(); }}>
          <TextField label="" placeholder="用户 ID" value={userIdFilter} onChange={(e) => setUserIdFilter(e.target.value)} style={{ maxWidth: '120px' }} />
          <select className="field__input" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }} style={{ maxWidth: '120px' }}>
            <option value="">全部类型</option>
            <option value="web">Web</option>
            <option value="oauth">OAuth</option>
          </select>
          <Button type="submit" size="sm">筛选</Button>
        </form>
      </Card>
      </div>

      <Card>
        {loading ? (
          <SkeletonTable rows={6} columns={5} />
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
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const debouncedAction = useDebouncedValue(actionFilter, 300);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('limit', '50');
      if (debouncedAction) params.append('action', debouncedAction);
      if (targetTypeFilter) params.append('target_type', targetTypeFilter);

      const res = await api.get<{ success: boolean; logs: AuditLogEntry[]; pagination?: PaginationData }>(
        `/api/admin/audit-logs?${params.toString()}`
      );
      setLogs(res.logs);
      if (res.pagination) setPagination(res.pagination);
    } catch { toast('error', '获取审计日志失败'); }
    finally { setLoading(false); }
  }, [currentPage, debouncedAction, targetTypeFilter, toast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  function parseDetails(details: string | null): string {
    if (!details) return '—';
    try {
      const obj = JSON.parse(details);
      return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
    } catch {
      return details;
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-4)' }}>
      <Card padding="sm">
        <form className="cluster" style={{ gap: 'var(--space-3)' }} onSubmit={(e) => { e.preventDefault(); setCurrentPage(1); loadLogs(); }}>
          <TextField label="" placeholder="操作 (如 user.ban)" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ maxWidth: '200px' }} />
          <select className="field__input" value={targetTypeFilter} onChange={(e) => { setTargetTypeFilter(e.target.value); setCurrentPage(1); }} style={{ maxWidth: '150px' }}>
            <option value="">全部类型</option>
            <option value="user">用户</option>
            <option value="config">配置</option>
            <option value="ip_ban">IP 黑名单</option>
            <option value="challenge">题库</option>
            <option value="user_field">自定义字段</option>
          </select>
          <Button type="submit" size="sm">筛选</Button>
        </form>
      </Card>
      </div>

      <Card>
        {loading ? (
          <SkeletonTable rows={6} columns={5} />
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
              { header: '详情', accessor: 'details', render: (l) => (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', maxWidth: '200px', display: 'inline-block' }} className="text-truncate">
                  {parseDetails(l.details)}
                </span>
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
    </div>
  );
}

/* ─── SMS Audit Logs Section ────────────────────────────────────────────────── */

function SmsLogsSection() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<SmsAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [phoneLast4, setPhoneLast4] = useState('');
  const debouncedPhone = useDebouncedValue(phoneLast4, 300);

  const loadLogs = useCallback(async () => {
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
      setLogs(res.logs);
      if (res.pagination) setPagination(res.pagination);
    } catch { toast('error', '获取短信审计日志失败'); }
    finally { setLoading(false); }
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
