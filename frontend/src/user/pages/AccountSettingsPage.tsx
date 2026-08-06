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
import type { SocialBindingsResponse, SocialUnbindResponse } from '@/api/types';

// GET /api/account/fields 返回定义与当前值的合并结构（按 field_key 键控）
interface AccountField {
  field_key: string;
  field_label: string;
  field_type: string;
  is_required: boolean;
  options: string[] | null;
  value: string | null;
}

type SettingsSection = 'profile' | 'security' | 'fields' | 'danger';

const ACCOUNT_NAV = [
  { key: 'overview', label: '概览', href: '/dashboard' },
  { key: 'settings', label: '账户设置', href: '/account-settings' },
];

const SETTINGS_NAV: Array<{ key: SettingsSection; label: string }> = [
  { key: 'profile', label: '个人资料' },
  { key: 'security', label: '账号与安全' },
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

  const [newUsername, setNewUsername] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState('');

  async function handleChangeUsername(e: FormEvent) {
    e.preventDefault();
    setUsernameError('');
    if (!user || !newUsername || newUsername === user.username) {
      setUsernameError('请输入新的用户名');
      return;
    }
    setUsernameLoading(true);
    try {
      await api.post('/api/account/change-username', {
        new_username: newUsername,
      });
      toast('success', '用户名已更新，请重新登录');
      // Sessions revoked, user will be redirected to login by 401 handler
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '修改失败';
      setUsernameError(msg);
      toast('error', msg);
    } finally {
      setUsernameLoading(false);
    }
  }

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
        old_password: oldPassword,
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

  // ===== QQ OAuth 绑定 =====
  const [qqBinding, setQqBinding] = useState<{
    id: number;
    nickname?: string | null;
    avatar_url?: string | null;
  } | null>(null);
  const [bindingsLoaded, setBindingsLoaded] = useState(false);
  const [qqLoading, setQqLoading] = useState(false);
  const [unbindLoading, setUnbindLoading] = useState(false);

  useEffect(() => {
    if (activeSection !== 'security' || bindingsLoaded) return;
    api.get<SocialBindingsResponse>('/api/account/bindings')
      .then((res) => {
        const qqBindingItem = res.bindings?.find((b) => b.provider === 'qq');
        if (qqBindingItem) {
          setQqBinding({
            id: qqBindingItem.id,
            nickname: qqBindingItem.nickname,
            avatar_url: qqBindingItem.avatar_url,
          });
        } else {
          setQqBinding(null);
        }
      })
      .catch(() => {})
      .finally(() => setBindingsLoaded(true));
  }, [activeSection, bindingsLoaded]);

  async function handleQqBind() {
    setQqLoading(true);
    try {
      window.location.href = '/api/auth/qq?intent=bind';
    } finally {
      setQqLoading(false);
    }
  }

  async function handleQqUnbind() {
    if (!qqBinding) return;
    if (!window.confirm('确定要解绑 QQ 账号吗？')) return;

    setUnbindLoading(true);
    try {
      await api.del<SocialUnbindResponse>(`/api/account/bindings/${qqBinding.id}`);
      toast('success', 'QQ 已解绑');
      setQqBinding(null);
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '解绑失败');
    } finally {
      setUnbindLoading(false);
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

  const [fieldDefs, setFieldDefs] = useState<AccountField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const fieldsLoaded = useRef(false);

  // Defer until the user opens the "自定义字段" tab (load once).
  // 单个用户端点即包含定义与当前值（不要调 /api/admin/user-fields —— 普通用户会 401）
  useEffect(() => {
    if (activeSection !== 'fields' || fieldsLoaded.current) return;
    fieldsLoaded.current = true;
    api
      .get<{ success: boolean; fields: AccountField[] }>('/api/account/fields')
      .then((res) => {
        const fields = res.fields || [];
        setFieldDefs(fields);
        const map: Record<string, string> = {};
        for (const f of fields) {
          if (f.value !== null) map[f.field_key] = f.value;
        }
        setFieldValues(map);
      })
      .catch(() => toast('error', '获取自定义字段失败'));
  }, [activeSection, toast]);

  async function handleSaveFields() {
    setFieldsLoading(true);
    try {
      // 后端按 { values: { [field_key]: value } } 接收
      await api.put('/api/account/fields', { values: fieldValues });
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
      // 后端要求携带密码确认删除
      await api.del('/api/account/', { password: deletePassword });
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

                <Card>
                  <CardTitle>更改用户名</CardTitle>
                  <CardDescription>
                    用户名用于登录和展示，每 30 天可更改一次。更改后需要重新登录。
                  </CardDescription>
                  <form
                    id="change-username-form"
                    onSubmit={handleChangeUsername}
                    data-testid="change-username-form"
                    style={{ marginTop: 'var(--space-5)' }}
                  >
                    <div className="stack">
                      <TextField
                        id="new_username"
                        label="新用户名"
                        name="new_username"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        error={usernameError}
                        hint="2-50 个字符，支持字母、数字、下划线、连字符和中文"
                        autoComplete="username"
                      />
                      <div className="cluster">
                        <Button type="submit" loading={usernameLoading}>
                          更改用户名
                        </Button>
                      </div>
                    </div>
                  </form>
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
                  <CardTitle>QQ 登录</CardTitle>
                  <CardDescription>绑定 QQ 后可使用 QQ 快速登录 MindAuth。</CardDescription>
                  <div className="info-list" style={{ marginTop: 'var(--space-5)' }}>
                    <div className="info-row">
                      <div className="info-row__main">
                        <span className="info-row__icon info-row__icon--primary">Q</span>
                        <div className="info-row__content">
                          <div className="info-row__label">绑定状态</div>
                          <div className="info-row__value">
                            {qqBinding ? (qqBinding.nickname || '已绑定') : '未绑定'}
                          </div>
                        </div>
                      </div>
                      <div className="info-row__actions">
                        {qqBinding ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={unbindLoading}
                            onClick={handleQqUnbind}
                          >
                            解绑
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={qqLoading}
                            onClick={handleQqBind}
                          >
                            绑定 QQ
                          </Button>
                        )}
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

            {activeSection === 'fields' ? (
              <div className="settings-panel stack stack--xl">
                <Card>
                  <CardTitle>自定义字段</CardTitle>
                  <CardDescription>填写管理员配置的附加资料字段。</CardDescription>
                  {fieldDefs.length > 0 ? (
                    <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
                      {fieldDefs.map((def) => (
                        <TextField
                          key={def.field_key}
                          label={def.field_label}
                          value={fieldValues[def.field_key] || ''}
                          onChange={(e) => setFieldValues((prev) => ({ ...prev, [def.field_key]: e.target.value }))}
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
