import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle, CardDescription } from '@/shared/Card';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
import { LoadingState } from '@/shared/LoadingState';
import { AccountShell } from '@/user/components/AccountShell';
import type { PrivacySettings } from '@/api/types';

interface UserFieldDef {
  id: number;
  field_key: string;
  field_label: string;
  field_type: string;
  is_required: boolean;
  is_public: boolean;
  options: string | null;
}

interface UserFieldValue {
  field_id: number;
  value: string;
}

type SettingsSection = 'profile' | 'security' | 'privacy' | 'fields' | 'danger';

const ACCOUNT_NAV = [
  { key: 'overview', label: '概览', href: '/dashboard' },
  { key: 'settings', label: '账户设置', href: '/account-settings' },
];

const SETTINGS_NAV: Array<{ key: SettingsSection; label: string }> = [
  { key: 'profile', label: '个人资料' },
  { key: 'security', label: '账号与安全' },
  { key: 'privacy', label: '隐私设置' },
  { key: 'fields', label: '自定义字段' },
  { key: 'danger', label: '危险操作' },
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN');
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'M';
}

export function AccountSettingsPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, logout, loadCurrentUser } = useAuth();
  const { toast } = useToast();

  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');

  useEffect(() => {
    if (!authLoading && !user) {
      toast('warning', '请先登录');
      navigate('/login', { replace: true });
    }
  }, [authLoading, user, navigate, toast]);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwdError('');
    if (!oldPassword || !newPassword) {
      setPwdError('请填写所有字段');
      return;
    }
    setPwdLoading(true);
    try {
      await api.post('/api/account/change-password', {
        current_password: oldPassword,
        new_password: newPassword,
      });
      toast('success', '密码已更新');
      setOldPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '修改失败';
      setPwdError(msg);
      toast('error', msg);
    } finally {
      setPwdLoading(false);
    }
  }

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  async function handleChangeEmail(e: FormEvent) {
    e.preventDefault();
    setEmailError('');
    if (!newEmail || !emailPassword) {
      setEmailError('请填写所有字段');
      return;
    }
    setEmailLoading(true);
    try {
      await api.post('/api/account/change-email', {
        new_email: newEmail,
        password: emailPassword,
      });
      toast('success', '邮箱已更新');
      setNewEmail('');
      setEmailPassword('');
      await loadCurrentUser();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '修改失败';
      setEmailError(msg);
      toast('error', msg);
    } finally {
      setEmailLoading(false);
    }
  }

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('error', '图片大小不能超过 2MB');
      return;
    }
    setAvatarLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.postForm('/api/account/avatar', formData);
      toast('success', '头像已更新');
      await loadCurrentUser();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败';
      toast('error', msg);
    } finally {
      setAvatarLoading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }

  async function handleDeleteAvatar() {
    try {
      await api.del('/api/account/avatar');
      toast('success', '头像已删除');
      await loadCurrentUser();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败';
      toast('error', msg);
    }
  }

  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [bannerLoading, setBannerLoading] = useState(false);

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('error', '图片大小不能超过 5MB');
      return;
    }
    setBannerLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.postForm('/api/account/banner', formData);
      toast('success', '横幅已更新');
      await loadCurrentUser();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败';
      toast('error', msg);
    } finally {
      setBannerLoading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  }

  async function handleDeleteBanner() {
    try {
      await api.del('/api/account/banner');
      toast('success', '横幅已删除');
      await loadCurrentUser();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败';
      toast('error', msg);
    }
  }

  const [privacy, setPrivacy] = useState<PrivacySettings>({
    profile_public: true,
    email_public: false,
    show_activity: true,
  });
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const privacyLoaded = useRef(false);

  // Defer until the user actually opens the "隐私" tab (load once)
  useEffect(() => {
    if (activeSection !== 'privacy' || privacyLoaded.current) return;
    privacyLoaded.current = true;
    api
      .get<{ success: boolean; settings: PrivacySettings }>('/api/account/privacy')
      .then((res) => {
        if (res.settings) setPrivacy(res.settings);
      })
      .catch(() => {});
  }, [activeSection]);

  async function handleSavePrivacy() {
    setPrivacyLoading(true);
    try {
      await api.put('/api/account/privacy', privacy);
      toast('success', '隐私设置已保存');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存失败';
      toast('error', msg);
    } finally {
      setPrivacyLoading(false);
    }
  }

  const [fieldDefs, setFieldDefs] = useState<UserFieldDef[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<number, string>>({});
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const fieldsLoaded = useRef(false);

  // Defer until the user opens the "自定义字段" tab (load once)
  useEffect(() => {
    if (activeSection !== 'fields' || fieldsLoaded.current) return;
    fieldsLoaded.current = true;
    async function loadFields() {
      try {
        const [defsRes, valsRes] = await Promise.allSettled([
          api.get<{ success: boolean; fields: UserFieldDef[] }>('/api/admin/user-fields'),
          api.get<{ success: boolean; values: UserFieldValue[] }>('/api/account/fields'),
        ]);
        if (defsRes.status === 'fulfilled') {
          setFieldDefs(defsRes.value.fields || []);
        }
        if (valsRes.status === 'fulfilled') {
          const map: Record<number, string> = {};
          for (const v of valsRes.value.values || []) {
            map[v.field_id] = v.value;
          }
          setFieldValues(map);
        }
      } catch {}
    }
    loadFields();
  }, [activeSection]);

  async function handleSaveFields() {
    setFieldsLoading(true);
    try {
      const values = Object.entries(fieldValues).map(([fieldId, value]) => ({
        field_id: Number(fieldId),
        value,
      }));
      await api.put('/api/account/fields', { values });
      toast('success', '自定义字段已保存');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存失败';
      toast('error', msg);
    } finally {
      setFieldsLoading(false);
    }
  }

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDeleteAccount() {
    if (!deletePassword) {
      toast('error', '请输入密码以确认删除');
      return;
    }
    setDeleteLoading(true);
    try {
      await api.del('/api/account/');
      toast('success', '账户已删除');
      await logout();
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败';
      toast('error', msg);
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
      setDeletePassword('');
    }
  }

  if (authLoading) {
    return (
      <div className="page--auth auth-shell__main">
        <LoadingState />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <>
      <AccountShell
        user={user}
        title="账户设置"
        description="集中管理个人资料、账号安全、隐私设置与危险操作。"
        navItems={ACCOUNT_NAV}
        activeNavKey="settings"
        headerActions={
          <Button variant="secondary" size="sm" onClick={() => navigate('/dashboard')}>
            返回概览
          </Button>
        }
        heroActions={
          <>
            <Button variant="secondary" onClick={() => setActiveSection('security')}>
              查看安全设置
            </Button>
            <Button variant="ghost" onClick={() => setActiveSection('danger')}>
              危险操作
            </Button>
          </>
        }
      >
        <div className="settings-layout">
          <aside className="settings-nav card">
            {SETTINGS_NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`settings-nav__button ${activeSection === item.key ? 'settings-nav__button--active' : ''}`.trim()}
                onClick={() => setActiveSection(item.key)}
              >
                {item.label}
              </button>
            ))}
          </aside>

          <div className="settings-content">
            {activeSection === 'profile' ? (
              <div className="settings-panel stack stack--xl">
                <Card>
                  <CardTitle>个人资料</CardTitle>
                  <CardDescription>管理头像、横幅和基础展示信息。</CardDescription>
                  <div className="stack stack--lg" style={{ marginTop: 'var(--space-5)' }}>
                    <div className="settings-banner">
                      {user.banner_url ? <img src={user.banner_url} alt="个人横幅" /> : null}
                      <div className="settings-banner__overlay">
                        <div>
                          <div className="settings-banner__title">个人横幅</div>
                          <div className="text-secondary" style={{ color: 'rgba(255,255,255,0.85)' }}>
                            上传 5MB 以内的横幅图片，展示更完整的个人资料风格。
                          </div>
                        </div>
                        <div className="cluster">
                          <input
                            ref={bannerInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            hidden
                            onChange={handleBannerUpload}
                            data-testid="banner-input"
                          />
                          <Button variant="secondary" size="sm" loading={bannerLoading} onClick={() => bannerInputRef.current?.click()}>
                            上传横幅
                          </Button>
                          {user.banner_url ? (
                            <Button variant="ghost" size="sm" onClick={handleDeleteBanner}>
                              删除横幅
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="settings-profile">
                      <div className="account-avatar" aria-hidden="true">
                        {user.avatar_url ? <img src={user.avatar_url} alt="" /> : getInitial(user.username)}
                      </div>
                      <div className="settings-profile__meta stack stack--sm">
                        <div>
                          <div className="section-title" style={{ fontSize: 'var(--text-xl)' }}>{user.username}</div>
                          <div className="section-description">{user.email}</div>
                        </div>
                        <div className="cluster">
                          <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            hidden
                            onChange={handleAvatarUpload}
                            data-testid="avatar-input"
                          />
                          <Button variant="secondary" size="sm" loading={avatarLoading} onClick={() => avatarInputRef.current?.click()}>
                            上传头像
                          </Button>
                          {user.avatar_url ? (
                            <Button variant="ghost" size="sm" onClick={handleDeleteAvatar}>
                              删除头像
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="settings-meta-grid">
                      <div className="settings-meta-item">
                        <div className="settings-meta-item__label">角色</div>
                        <div className="settings-meta-item__value">{user.role === 'admin' ? '管理员' : '普通用户'}</div>
                      </div>
                      <div className="settings-meta-item">
                        <div className="settings-meta-item__label">注册时间</div>
                        <div className="settings-meta-item__value">{formatDate(user.created_at)}</div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            ) : null}

            {activeSection === 'security' ? (
              <div className="settings-panel stack stack--xl">
                <Card>
                  <CardTitle>账号与安全</CardTitle>
                  <CardDescription>处理邮箱、密码以及账户认证状态。</CardDescription>
                  <div className="info-list" style={{ marginTop: 'var(--space-5)' }}>
                    <div className="info-row">
                      <div className="info-row__main">
                        <span className="info-row__icon info-row__icon--primary">@</span>
                        <div className="info-row__content">
                          <div className="info-row__label">当前邮箱</div>
                          <div className="info-row__value">{user.email}</div>
                          <div className="info-row__meta">用于登录、通知和账户恢复。</div>
                        </div>
                      </div>
                      <div className="info-row__actions">
                        <span className={`status-badge ${user.email_verified ? 'status-badge--success' : 'status-badge--warning'}`}>
                          {user.email_verified ? '已验证' : '待验证'}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card>
                  <CardTitle>修改邮箱</CardTitle>
                  <CardDescription>变更主邮箱后会刷新当前账户资料。</CardDescription>
                  <form id="change-email-form" onSubmit={handleChangeEmail} data-testid="change-email-form" style={{ marginTop: 'var(--space-5)' }}>
                    <div className="stack">
                      <TextField
                        label="新邮箱"
                        type="email"
                        name="new_email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        error={emailError}
                        placeholder="请输入新邮箱"
                        autoComplete="email"
                      />
                      <TextField
                        label="确认密码"
                        type="password"
                        name="email_password"
                        value={emailPassword}
                        onChange={(e) => setEmailPassword(e.target.value)}
                        placeholder="请输入密码以确认"
                        autoComplete="current-password"
                      />
                      <div className="cluster">
                        <Button type="submit" loading={emailLoading}>
                          修改邮箱
                        </Button>
                      </div>
                    </div>
                  </form>
                </Card>

                <Card>
                  <CardTitle>修改密码</CardTitle>
                  <CardDescription>建议定期更新密码并保持复杂度。</CardDescription>
                  <form id="change-password-form" onSubmit={handleChangePassword} data-testid="change-password-form" style={{ marginTop: 'var(--space-5)' }}>
                    <div className="stack">
                      <TextField
                        id="old_password"
                        label="当前密码"
                        type="password"
                        name="old_password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        autoComplete="current-password"
                      />
                      <TextField
                        id="new_password"
                        label="新密码"
                        type="password"
                        name="new_password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        error={pwdError}
                        hint="至少 8 个字符，包含大小写字母和数字"
                        autoComplete="new-password"
                      />
                      <div className="cluster">
                        <Button type="submit" loading={pwdLoading}>
                          修改密码
                        </Button>
                      </div>
                    </div>
                  </form>
                </Card>
              </div>
            ) : null}

            {activeSection === 'privacy' ? (
              <div className="settings-panel stack stack--xl">
                <Card>
                  <CardTitle>隐私设置</CardTitle>
                  <CardDescription>控制资料公开程度与活动展示范围。</CardDescription>
                  <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
                    <label className="cluster">
                      <input
                        type="checkbox"
                        checked={privacy.profile_public}
                        onChange={(e) => setPrivacy((p) => ({ ...p, profile_public: e.target.checked }))}
                      />
                      <span>公开个人资料</span>
                    </label>
                    <label className="cluster">
                      <input
                        type="checkbox"
                        checked={privacy.email_public}
                        onChange={(e) => setPrivacy((p) => ({ ...p, email_public: e.target.checked }))}
                      />
                      <span>公开邮箱地址</span>
                    </label>
                    <label className="cluster">
                      <input
                        type="checkbox"
                        checked={privacy.show_activity}
                        onChange={(e) => setPrivacy((p) => ({ ...p, show_activity: e.target.checked }))}
                      />
                      <span>显示活动状态</span>
                    </label>
                    <div className="cluster">
                      <Button variant="secondary" loading={privacyLoading} onClick={handleSavePrivacy}>
                        保存隐私设置
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            ) : null}

            {activeSection === 'fields' ? (
              <div className="settings-panel stack stack--xl">
                <Card>
                  <CardTitle>自定义字段</CardTitle>
                  <CardDescription>填写管理员配置的附加资料字段。</CardDescription>
                  {fieldDefs.length > 0 ? (
                    <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
                      {fieldDefs.map((def) => (
                        <TextField
                          key={def.id}
                          label={def.field_label}
                          value={fieldValues[def.id] || ''}
                          onChange={(e) => setFieldValues((prev) => ({ ...prev, [def.id]: e.target.value }))}
                          hint={def.is_required ? '必填' : '选填'}
                        />
                      ))}
                      <div className="cluster">
                        <Button variant="secondary" loading={fieldsLoading} onClick={handleSaveFields}>
                          保存字段
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">当前没有可编辑的自定义字段</div>
                  )}
                </Card>
              </div>
            ) : null}

            {activeSection === 'danger' ? (
              <div className="settings-panel stack stack--xl">
                <Card className="danger-zone">
                  <CardTitle>删除账户</CardTitle>
                  <CardDescription>此操作不可撤销，删除后所有数据将被永久清除。</CardDescription>
                  <form
                    id="delete-account-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setDeleteDialogOpen(true);
                    }}
                    data-testid="delete-account-form"
                    style={{ marginTop: 'var(--space-5)' }}
                  >
                    <Button variant="danger" type="submit">
                      删除账户
                    </Button>
                  </form>
                </Card>
              </div>
            ) : null}
          </div>
        </div>
      </AccountShell>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="确认删除账户"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="danger" loading={deleteLoading} onClick={handleDeleteAccount}>
              确认删除
            </Button>
          </>
        }
      >
        <div className="stack">
          <p style={{ color: 'var(--color-error)' }}>
            此操作不可撤销。请输入当前密码以确认删除账户。
          </p>
          <TextField
            label="请输入密码以确认"
            type="password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </Dialog>
    </>
  );
}
