import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
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

/**
 * Account settings page: password, email, avatar/banner, custom fields, privacy, deletion.
 */
export function AccountSettingsPage() {
  const navigate = useNavigate();
  const { user, logout, loadCurrentUser } = useAuth();
  const { toast } = useToast();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) {
      toast('warning', '请先登录');
      navigate('/login', { replace: true });
    }
  }, [user, navigate, toast]);

  // ── Password change ────────────────────────────────────────────────────────
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

  // ── Email change ───────────────────────────────────────────────────────────
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

  // ── Avatar upload/delete ──────────────────────────────────────────────────
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
      formData.append('avatar', file);
      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message || '上传失败');
      }
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

  // ── Banner upload/delete ──────────────────────────────────────────────────
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
      formData.append('banner', file);
      const res = await fetch('/api/account/banner', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message || '上传失败');
      }
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

  // ── Privacy settings ──────────────────────────────────────────────────────
  const [privacy, setPrivacy] = useState<PrivacySettings>({
    profile_public: true,
    email_public: false,
    show_activity: true,
  });
  const [privacyLoading, setPrivacyLoading] = useState(false);

  useEffect(() => {
    api
      .get<{ success: boolean; settings: PrivacySettings }>('/api/account/privacy')
      .then((res) => {
        if (res.settings) setPrivacy(res.settings);
      })
      .catch(() => {});
  }, []);

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

  // ── Custom fields ─────────────────────────────────────────────────────────
  const [fieldDefs, setFieldDefs] = useState<UserFieldDef[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<number, string>>({});
  const [fieldsLoading, setFieldsLoading] = useState(false);

  useEffect(() => {
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
      } catch {
        // fields load failure is non-fatal
      }
    }
    loadFields();
  }, []);

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

  // ── Delete account ────────────────────────────────────────────────────────
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
    }
  }

  if (!user) {
    return null;
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-6)', paddingBottom: 'var(--space-6)' }}>
      <div className="cluster cluster--spread" style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' }}>账户设置</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
          返回 Dashboard
        </Button>
      </div>

      <div className="stack stack--xl">
        {/* Change Password */}
        <Card>
          <CardTitle>修改密码</CardTitle>
          <form id="change-password-form" onSubmit={handleChangePassword} data-testid="change-password-form">
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
                hint="至少8个字符，包含大小写字母和数字"
                autoComplete="new-password"
              />
              <Button type="submit" loading={pwdLoading}>
                修改密码
              </Button>
            </div>
          </form>
        </Card>

        {/* Change Email */}
        <Card>
          <CardTitle>修改邮箱</CardTitle>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            当前邮箱: {user.email}
          </p>
          <form id="change-email-form" onSubmit={handleChangeEmail} data-testid="change-email-form">
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
              <Button type="submit" loading={emailLoading}>
                修改邮箱
              </Button>
            </div>
          </form>
        </Card>

        {/* Avatar */}
        <Card>
          <CardTitle>头像</CardTitle>
          <div className="cluster" style={{ gap: 'var(--space-4)' }}>
            {user.avatar_url && (
              <img
                src={user.avatar_url}
                alt="Avatar"
                style={{ width: 64, height: 64, borderRadius: 'var(--radius-full)', objectFit: 'cover' }}
              />
            )}
            <div className="cluster" style={{ gap: 'var(--space-2)' }}>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarUpload}
                data-testid="avatar-input"
              />
              <Button
                variant="secondary"
                size="sm"
                loading={avatarLoading}
                onClick={() => avatarInputRef.current?.click()}
              >
                上传头像
              </Button>
              {user.avatar_url && (
                <Button variant="ghost" size="sm" onClick={handleDeleteAvatar}>
                  删除
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Banner */}
        <Card>
          <CardTitle>个人横幅</CardTitle>
          <div className="stack stack--sm">
            {user.banner_url && (
              <img
                src={user.banner_url}
                alt="Banner"
                style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 'var(--radius-md)' }}
              />
            )}
            <div className="cluster" style={{ gap: 'var(--space-2)' }}>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleBannerUpload}
                data-testid="banner-input"
              />
              <Button
                variant="secondary"
                size="sm"
                loading={bannerLoading}
                onClick={() => bannerInputRef.current?.click()}
              >
                上传横幅
              </Button>
              {user.banner_url && (
                <Button variant="ghost" size="sm" onClick={handleDeleteBanner}>
                  删除
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Custom Fields */}
        {fieldDefs.length > 0 && (
          <Card>
            <CardTitle>自定义字段</CardTitle>
            <div className="stack">
              {fieldDefs.map((def) => (
                <TextField
                  key={def.id}
                  label={def.field_label}
                  value={fieldValues[def.id] || ''}
                  onChange={(e) =>
                    setFieldValues((prev) => ({ ...prev, [def.id]: e.target.value }))
                  }
                  hint={def.is_required ? '必填' : '选填'}
                />
              ))}
              <Button variant="secondary" loading={fieldsLoading} onClick={handleSaveFields}>
                保存字段
              </Button>
            </div>
          </Card>
        )}

        {/* Privacy */}
        <Card>
          <CardTitle>隐私设置</CardTitle>
          <div className="stack">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={privacy.profile_public}
                onChange={(e) => setPrivacy((p) => ({ ...p, profile_public: e.target.checked }))}
              />
              <span style={{ fontSize: 'var(--text-sm)' }}>公开个人资料</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={privacy.email_public}
                onChange={(e) => setPrivacy((p) => ({ ...p, email_public: e.target.checked }))}
              />
              <span style={{ fontSize: 'var(--text-sm)' }}>公开邮箱地址</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={privacy.show_activity}
                onChange={(e) => setPrivacy((p) => ({ ...p, show_activity: e.target.checked }))}
              />
              <span style={{ fontSize: 'var(--text-sm)' }}>显示活动状态</span>
            </label>
            <Button variant="secondary" loading={privacyLoading} onClick={handleSavePrivacy}>
              保存隐私设置
            </Button>
          </div>
        </Card>

        {/* Delete Account */}
        <Card>
          <CardTitle>删除账户</CardTitle>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>
            此操作不可撤销。删除后所有数据将被永久清除。
          </p>
          <form
            id="delete-account-form"
            onSubmit={(e) => {
              e.preventDefault();
              setDeleteDialogOpen(true);
            }}
            data-testid="delete-account-form"
          >
            <Button variant="danger" type="submit">
              删除账户
            </Button>
          </form>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
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
            此操作不可撤销！您的所有数据（包括帖子、设置等）将被永久删除。
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
    </div>
  );
}
