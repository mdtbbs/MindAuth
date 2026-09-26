import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import { LoadingState } from '@/shared/LoadingState';
import type { EmailConfigData, SmsConfigData, SystemConfigItem } from '@/api/types';

type SettingsTab = 'email' | 'sms' | 'system' | 'appearance';

export function AdminSettingsPage({ initialTab, standalone = false, showMessagingTabs = false, hideTitle = false }: { initialTab?: SettingsTab; standalone?: boolean; showMessagingTabs?: boolean; hideTitle?: boolean }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'email');
  const { hasPermission } = useAdminAuth();
  useEffect(() => { if (initialTab) setActiveTab(initialTab); }, [initialTab]);

  const tabs: { id: SettingsTab; label: string; perm: string }[] = [
    { id: 'email', label: '邮件配置', perm: 'email_config.read' },
    { id: 'sms', label: '短信配置', perm: 'sms_config.read' },
    { id: 'system', label: '系统配置', perm: 'config.read' },
    { id: 'appearance', label: '登录页外观', perm: 'config.read' },
  ];

  const visibleTabs = tabs.filter((t) => hasPermission(t.perm) && (!showMessagingTabs || t.id === 'email' || t.id === 'sms'));

  return (
    <div>
      {!hideTitle && <h1 className="admin-page-title">
        {standalone ? (activeTab === 'email' || activeTab === 'sms' ? '邮件与短信' : activeTab === 'appearance' ? '登录页外观' : '注册与认证') : '系统配置'}
      </h1>}

      {/* Tab bar */}
      {(!standalone || showMessagingTabs) && <div className="admin-tabs" role="tablist" aria-label="配置分类">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {showMessagingTabs ? (tab.id === 'email' ? '邮件' : '短信') : tab.label}
          </button>
        ))}
      </div>}

      {activeTab === 'email' && <EmailConfigSection />}
      {activeTab === 'sms' && <SmsConfigSection />}
      {activeTab === 'system' && <SystemConfigSection />}
      {activeTab === 'appearance' && <AppearanceSection />}
    </div>
  );
}

/* ─── Appearance Section (auth page background) ─────────────────────────────── */

function AppearanceSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const canWrite = hasPermission('config.write');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadBackground = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; background_url: string | null }>('/api/public/auth-page-config');
      setBackgroundUrl(res.background_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取登录页背景配置失败';
      setLoadError(message);
      toast('error', message);
    }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadBackground(); }, [loadBackground]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('error', '图片大小不能超过 5MB');
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.postForm<{ success: boolean; background_url: string }>('/api/admin/auth-background', formData);
      setBackgroundUrl(res.background_url);
      toast('success', '登录页背景已更新');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '上传失败');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      await api.del('/api/admin/auth-background');
      setBackgroundUrl(null);
      toast('success', '已恢复默认背景');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;
  if (loadError) return <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadBackground()}>重试</Button></div>;

  return (
    <Card>
      <CardTitle>登录页背景</CardTitle>
      <p className="section-description" style={{ marginBottom: 'var(--space-4)' }}>
        自定义登录、注册等认证页面的整屏背景图（JPEG/PNG/WebP，5MB 以内）。未设置时使用默认网格背景。
      </p>
      <div
        style={{
          height: '10rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border-soft)',
          marginBottom: 'var(--space-4)',
          backgroundColor: 'var(--auth-bg)',
          backgroundImage: backgroundUrl
            ? `url(${backgroundUrl})`
            : 'linear-gradient(var(--auth-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--auth-grid-line) 1px, transparent 1px)',
          backgroundSize: backgroundUrl ? 'cover' : '24px 24px',
          backgroundPosition: backgroundUrl ? 'center' : undefined,
        }}
        role="img"
        aria-label={backgroundUrl ? '当前自定义背景预览' : '默认网格背景预览'}
      />
      <div className="cluster">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <Button onClick={() => fileInputRef.current?.click()} loading={busy} disabled={!canWrite}>
          上传背景图
        </Button>
        {backgroundUrl ? (
          <Button variant="secondary" onClick={handleReset} disabled={!canWrite || busy}>
            恢复默认背景
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/* ─── Email Config Section ──────────────────────────────────────────────────── */

function EmailConfigSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [config, setConfig] = useState<EmailConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState('');
  const [secure, setSecure] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  const loadConfig = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; config: EmailConfigData | null }>('/api/admin/email-config');
      if (res.config) {
        setConfig(res.config);
        setHost(res.config.host || '');
        setPort(String(res.config.port || ''));
        setUser(res.config.user || '');
        setFrom(res.config.from || '');
        setSecure(!!res.config.secure);
      }
    } catch (error) { const message = error instanceof Error ? error.message : '获取邮件配置失败'; setLoadError(message); toast('error', message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  async function handleSave() {
    if (!host || !port || !user || !from) {
      toast('error', '主机、端口、用户名和发件人必填');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/admin/email-config', {
        host, port: Number(port), user, password: password || undefined, from, secure,
      });
      toast('success', '邮件配置已保存');
      setPassword('');
      loadConfig();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  }

  async function handleTest() {
    if (!testEmail.trim()) { toast('error', '请输入测试邮箱'); return; }
    setTesting(true);
    try {
      await api.post('/api/admin/test-email', { email: testEmail.trim() });
      toast('success', '测试邮件已发送');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '发送失败');
    } finally { setTesting(false); }
  }

  if (loading) return <LoadingState />;
  if (loadError) return <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadConfig()}>重试</Button></div>;

  const canWrite = hasPermission('email_config.write');

  return (
    <Card>
      <div className="stack">
        <div className="grid grid--2">
          <TextField label="SMTP 主机" value={host} onChange={(e) => setHost(e.target.value)} disabled={!canWrite} placeholder="smtp.example.com" />
          <TextField label="端口" value={port} onChange={(e) => setPort(e.target.value)} disabled={!canWrite} placeholder="465" />
        </div>
        <div className="grid grid--2">
          <TextField label="用户名" value={user} onChange={(e) => setUser(e.target.value)} disabled={!canWrite} placeholder="SMTP 用户名" />
          <TextField label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!canWrite} hint={config?.hasPassword ? '已配置，留空保持不变' : '未配置'} placeholder="SMTP 密码" />
        </div>
        <TextField label="发件人" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!canWrite} placeholder="noreply@example.com" />
        <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} disabled={!canWrite} />
          <span style={{ fontSize: 'var(--text-sm)' }}>使用 SSL/TLS</span>
        </label>

        {canWrite && (
          <Button onClick={handleSave} loading={saving}>保存配置</Button>
        )}

        <hr className="divider" />

        <CardTitle>测试邮件</CardTitle>
        <div className="cluster" style={{ gap: 'var(--space-2)' }}>
          <TextField
            label=""
            type="email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="测试邮箱地址"
            style={{ flex: 1 }}
          />
          <Button variant="secondary" onClick={handleTest} loading={testing} disabled={!canWrite}>
            发送测试
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ─── SMS Config Section ────────────────────────────────────────────────────── */

function SmsConfigSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [config, setConfig] = useState<SmsConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [signName, setSignName] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [testPhone, setTestPhone] = useState('');

  const loadConfig = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; config: SmsConfigData | null }>('/api/admin/sms-config');
      if (res.config) {
        setConfig(res.config);
        setEnabled(!!res.config.enabled);
        setAccessKeyId(res.config.access_key_id || '');
        setSignName(res.config.sign_name || '');
        setTemplateCode(res.config.template_code || '');
      }
    } catch (error) { const message = error instanceof Error ? error.message : '获取短信配置失败'; setLoadError(message); toast('error', message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  async function handleSave() {
    if (enabled && (!accessKeyId || !signName || !templateCode)) {
      toast('error', '启用短信时 AccessKey ID、签名和模板必填');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/admin/sms-config', {
        enabled,
        access_key_id: accessKeyId,
        access_key_secret: accessKeySecret || undefined,
        sign_name: signName,
        template_code: templateCode,
      });
      toast('success', '短信配置已保存');
      setAccessKeySecret('');
      loadConfig();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '保存失败');
    } finally { setSaving(false); }
  }

  async function handleTest() {
    if (!testPhone.trim()) { toast('error', '请输入测试手机号'); return; }
    if (!/^1[3-9]\d{9}$/.test(testPhone.trim())) { toast('error', '请输入有效的 11 位手机号'); return; }
    setTesting(true);
    try {
      await api.post('/api/admin/test-sms', { phone: testPhone.trim() });
      toast('success', '测试短信已发送');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '发送失败');
    } finally { setTesting(false); }
  }

  if (loading) return <LoadingState />;
  if (loadError) return <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadConfig()}>重试</Button></div>;

  const canWrite = hasPermission('sms_config.write');

  return (
    <Card>
      <div className="stack">
        <label className="cluster" style={{ gap: 'var(--space-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canWrite} />
          <span style={{ fontSize: 'var(--text-sm)' }}>启用短信验证</span>
        </label>

        {enabled && (
          <>
            <div className="grid grid--2">
              <TextField label="AccessKey ID" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} disabled={!canWrite} />
              <TextField label="AccessKey Secret" type="password" value={accessKeySecret} onChange={(e) => setAccessKeySecret(e.target.value)} disabled={!canWrite} hint={config?.has_access_key_secret ? '已配置，留空保持不变' : '未配置'} />
            </div>
            <div className="grid grid--2">
              <TextField label="短信签名" value={signName} onChange={(e) => setSignName(e.target.value)} disabled={!canWrite} />
              <TextField label="模板 Code" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} disabled={!canWrite} />
            </div>
          </>
        )}

        {canWrite && (
          <Button onClick={handleSave} loading={saving}>保存配置</Button>
        )}

        {enabled && (
          <>
            <hr className="divider" />
            <CardTitle>测试短信</CardTitle>
            <div className="cluster" style={{ gap: 'var(--space-2)' }}>
              <TextField
                label=""
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="测试手机号 (例如: 13800138000)"
                style={{ flex: 1 }}
              />
              <Button variant="secondary" onClick={handleTest} loading={testing} disabled={!canWrite}>
                发送测试
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ─── System Config Section ─────────────────────────────────────────────────── */

function SystemConfigSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<SystemConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const loadConfigs = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get<{ success: boolean; system: SystemConfigItem[] }>('/api/admin/config');
      // auth_background_url 由「登录页外观」tab 专管（含旧文件清理），此处隐藏避免双入口
      setConfigs((res.system || []).filter((c) => c.key !== 'auth_background_url'));
    } catch (error) { const message = error instanceof Error ? error.message : '获取系统配置失败'; setLoadError(message); toast('error', message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  async function handleSave(key: string) {
    try {
      await api.put(`/api/admin/config/${key}`, { value: editValue });
      toast('success', '配置已更新');
      setEditingKey(null);
      loadConfigs();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '更新失败');
    }
  }

  if (loading) return <LoadingState />;
  if (loadError) return <div className="admin-inline-state admin-inline-state--error" role="alert"><p>{loadError}</p><Button size="sm" variant="secondary" onClick={() => void loadConfigs()}>重试</Button></div>;

  const canWrite = hasPermission('config.write');
  const labels: Record<string, string> = {
    registration_enabled: '允许新用户注册',
    password_min_length: '密码最小长度',
    password_require_complexity: '要求密码复杂度',
    session_lifetime_days: '登录会话有效期（天）',
    audit_retention_days: '管理日志保留（天）',
    sms_audit_retention_days: '短信记录保留（天）',
  };
  const orderedKeys = ['registration_enabled', 'password_min_length', 'password_require_complexity', 'session_lifetime_days', 'audit_retention_days', 'sms_audit_retention_days'];
  const readableConfigs = orderedKeys.map((key) => configs.find((cfg) => cfg.key === key)).filter((cfg): cfg is SystemConfigItem => Boolean(cfg));
  const beginEdit = (cfg: SystemConfigItem) => { setEditingKey(cfg.key); setEditValue(cfg.value); };
  const saveImmediate = async (cfg: SystemConfigItem, value: string) => {
    try { await api.put(`/api/admin/config/${cfg.key}`, { value }); toast('success', '配置已更新'); await loadConfigs(); }
    catch (err) { toast('error', err instanceof Error ? err.message : '更新失败'); }
  };

  return <div className="admin-config-layout">
    <Card>
      <div className="admin-section-heading"><h2>注册与密码</h2><p>调整注册开关、密码要求和会话时长。</p></div>
      <div className="admin-setting-list">
        {readableConfigs.map((cfg) => <div key={cfg.key} className="admin-setting-row">
          <div><strong>{labels[cfg.key]}</strong>{cfg.description && <small>{cfg.description}</small>}</div>
          <div className="admin-setting-control">
            {editingKey === cfg.key ? <>
              <input aria-label={labels[cfg.key]} type="number" min="1" max="3650" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
              <Button size="sm" onClick={() => handleSave(cfg.key)}>保存</Button><Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>取消</Button>
            </> : <>
              <span className="admin-setting-value">{cfg.key === 'registration_enabled' || cfg.key === 'password_require_complexity' ? (cfg.value === '1' ? '开启' : '关闭') : cfg.key === 'password_min_length' ? `${cfg.value} 位` : `${cfg.value} 天`}</span>
              {canWrite && (cfg.key === 'registration_enabled' || cfg.key === 'password_require_complexity'
                ? <button className={`admin-switch ${cfg.value === '1' ? 'is-on' : ''}`} type="button" role="switch" aria-checked={cfg.value === '1'} aria-label={labels[cfg.key]} onClick={() => void saveImmediate(cfg, cfg.value === '1' ? '0' : '1')} />
                : <Button size="sm" variant="secondary" onClick={() => beginEdit(cfg)}>修改</Button>)}
            </>}
          </div>
        </div>)}
        <div className="admin-setting-row"><div><strong>邮箱注册与验证</strong><small>当前注册流程要求完成邮箱验证码校验；邮箱为账号注册方式。</small></div><span className="admin-badge is-neutral">由认证流程强制</span></div>
      </div>
    </Card>
    <details className="admin-advanced-config">
      <summary>高级配置（原始键值）</summary>
      <Card><div className="admin-setting-list">{configs.map((cfg) => <div key={cfg.key} className="admin-setting-row">
        <div><code>{cfg.key}</code>{cfg.description && <small>{cfg.description}</small>}</div>
        <div className="admin-setting-control">{editingKey === cfg.key ? <><input value={editValue} onChange={(e) => setEditValue(e.target.value)} /><Button size="sm" onClick={() => handleSave(cfg.key)}>保存</Button><Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>取消</Button></> : <><code>{cfg.value}</code>{canWrite && <Button size="sm" variant="ghost" onClick={() => beginEdit(cfg)}>编辑</Button>}</>}</div>
      </div>)}</div></Card>
    </details>
  </div>;
}
