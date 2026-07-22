import { useState, useEffect, useCallback } from 'react';
import api from '@/api/client';
import { useAdminAuth } from '../AdminAuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import type { EmailConfigData, SmsConfigData, SystemConfigItem } from '@/api/types';

type SettingsTab = 'email' | 'sms' | 'system';

export function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('email');
  const { hasPermission } = useAdminAuth();

  const tabs: { id: SettingsTab; label: string; perm: string }[] = [
    { id: 'email', label: '邮件配置', perm: 'email_config.read' },
    { id: 'sms', label: '短信配置', perm: 'sms_config.read' },
    { id: 'system', label: '系统配置', perm: 'config.read' },
  ];

  const visibleTabs = tabs.filter((t) => hasPermission(t.perm));

  return (
    <div>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-6)' }}>
        系统配置
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

      {activeTab === 'email' && <EmailConfigSection />}
      {activeTab === 'sms' && <SmsConfigSection />}
      {activeTab === 'system' && <SystemConfigSection />}
    </div>
  );
}

/* ─── Email Config Section ──────────────────────────────────────────────────── */

function EmailConfigSection() {
  const { hasPermission } = useAdminAuth();
  const { toast } = useToast();
  const [config, setConfig] = useState<EmailConfigData | null>(null);
  const [loading, setLoading] = useState(true);
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
    } catch { toast('error', '获取邮件配置失败'); }
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

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>加载中...</p>;

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
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [accessKeySecret, setAccessKeySecret] = useState('');
  const [signName, setSignName] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [testPhone, setTestPhone] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; config: SmsConfigData | null }>('/api/admin/sms-config');
      if (res.config) {
        setConfig(res.config);
        setEnabled(!!res.config.enabled);
        setAccessKeyId(res.config.access_key_id || '');
        setSignName(res.config.sign_name || '');
        setTemplateCode(res.config.template_code || '');
      }
    } catch { toast('error', '获取短信配置失败'); }
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

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>加载中...</p>;

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
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const loadConfigs = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; system: SystemConfigItem[] }>('/api/admin/config');
      setConfigs(res.system || []);
    } catch { toast('error', '获取系统配置失败'); }
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

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>加载中...</p>;

  const canWrite = hasPermission('config.write');

  return (
    <Card>
      <div className="stack">
        {configs.map((cfg) => (
          <div key={cfg.key} className="cluster cluster--spread" style={{
            padding: 'var(--space-3)',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{cfg.key}</div>
              {cfg.description && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>{cfg.description}</div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              {editingKey === cfg.key ? (
                <div className="cluster" style={{ gap: 'var(--space-2)' }}>
                  <input
                    className="field__input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Button size="sm" onClick={() => handleSave(cfg.key)}>保存</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>取消</Button>
                </div>
              ) : (
                <div className="cluster cluster--spread">
                  <code style={{ fontSize: 'var(--text-sm)', background: 'var(--color-bg-sunken)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                    {cfg.value}
                  </code>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditingKey(cfg.key); setEditValue(cfg.value); }}
                    >
                      编辑
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {configs.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>暂无系统配置</p>
        )}
      </div>
    </Card>
  );
}
