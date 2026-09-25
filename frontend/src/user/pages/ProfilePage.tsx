import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Button } from '@/shared/Button';
import { TextField } from '@/shared/TextField';
import {
  AccountEmptyState,
  AccountLoadState,
  AccountSection,
  SettingsRow,
  StatusLabel,
  formatAccountDate,
} from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';

interface AccountField {
  field_key: string;
  field_label: string;
  field_type: string;
  is_required: boolean;
  options: string[] | null;
  value: string | null;
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'M';
}

export function ProfilePage() {
  const { user, loadCurrentUser, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [bannerLoading, setBannerLoading] = useState(false);
  const [fields, setFields] = useState<AccountField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState(false);
  const [fieldsSaving, setFieldsSaving] = useState(false);

  useEffect(() => {
    if (user) setUsername(user.username);
  }, [user]);

  async function loadFields() {
    setFieldsLoading(true);
    setFieldsError(false);
    try {
      const response = await api.get<{ success: boolean; fields: AccountField[] }>('/api/account/fields');
      const values: Record<string, string> = {};
      for (const field of response.fields || []) {
        if (field.value !== null) values[field.field_key] = field.value;
      }
      setFields(response.fields || []);
      setFieldValues(values);
    } catch {
      setFieldsError(true);
    } finally {
      setFieldsLoading(false);
    }
  }

  useEffect(() => {
    if (user) void loadFields();
  }, [user]);

  async function uploadImage(kind: 'avatar' | 'banner', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const maxSize = kind === 'avatar' ? 2 : 5;
    if (file.size > maxSize * 1024 * 1024) {
      toast('error', `图片大小不能超过 ${maxSize}MB`);
      event.target.value = '';
      return;
    }
    const setLoading = kind === 'avatar' ? setAvatarLoading : setBannerLoading;
    setLoading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await api.postForm(`/api/account/${kind}`, body);
      toast('success', kind === 'avatar' ? '头像已更新' : '横幅已更新');
      await loadCurrentUser();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '上传失败');
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  }

  async function removeImage(kind: 'avatar' | 'banner') {
    try {
      await api.del(`/api/account/${kind}`);
      toast('success', kind === 'avatar' ? '头像已删除' : '横幅已删除');
      await loadCurrentUser();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '删除失败');
    }
  }

  async function changeUsername(event: FormEvent) {
    event.preventDefault();
    setUsernameError('');
    if (!user || !username.trim() || username.trim() === user.username) {
      setUsernameError('请输入新的用户名');
      return;
    }
    setUsernameLoading(true);
    try {
      await api.post('/api/account/change-username', { new_username: username.trim() });
      toast('success', '用户名已更新，请重新登录');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : '修改用户名失败';
      setUsernameError(message);
      toast('error', message);
    } finally {
      setUsernameLoading(false);
    }
  }

  async function saveFields() {
    setFieldsSaving(true);
    try {
      await api.put('/api/account/fields', { values: fieldValues });
      toast('success', '自定义资料已保存');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '保存资料失败');
    } finally {
      setFieldsSaving(false);
    }
  }

  return (
    <AccountShell title="个人资料" description="管理头像、横幅、用户名和展示资料。">
      {user ? (
        <div className="account-page-sections">
          <AccountSection title="头像" description="使用清晰的图片帮助识别你的账户。">
            <SettingsRow title="账户头像" description="支持 JPEG、PNG、GIF 或 WebP，最大 2MB。">
              <div className="profile-avatar-control">
                <div className="profile-avatar-control__preview" aria-hidden="true">
                  {user.avatar_url ? <img src={user.avatar_url} alt="" /> : initial(user.username)}
                </div>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  hidden
                  data-testid="avatar-input"
                  onChange={(event) => void uploadImage('avatar', event)}
                />
                <div className="account-button-row">
                  <Button type="button" variant="secondary" loading={avatarLoading} onClick={() => avatarInput.current?.click()}>更换头像</Button>
                  {user.avatar_url ? <Button type="button" variant="ghost" onClick={() => void removeImage('avatar')}>移除</Button> : null}
                </div>
              </div>
            </SettingsRow>
          </AccountSection>

          <AccountSection title="基本资料" description="用于展示和识别你的 MindAuth 账户。">
            <SettingsRow title="用户名" description="每 30 天可更改一次；更改后需要重新登录。">
              <form id="change-username-form" data-testid="change-username-form" className="account-inline-form" onSubmit={changeUsername}>
                <TextField
                  id="new_username"
                  label="用户名"
                  name="new_username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  error={usernameError}
                  hint="2–50 个字符，支持字母、数字、下划线、连字符和中文"
                  autoComplete="username"
                />
                <Button type="submit" loading={usernameLoading}>保存用户名</Button>
              </form>
            </SettingsRow>
            <SettingsRow title="邮箱" description="邮箱用于登录和账户恢复，修改操作位于安全设置。">
              <div className="account-value-stack">
                <span>{user.email}</span>
                <StatusLabel needsAction={!user.email_verified}>{user.email_verified ? '已验证' : '待验证'}</StatusLabel>
                {!user.email_verified ? <Link className="account-text-link" to="/security">验证邮箱</Link> : null}
              </div>
            </SettingsRow>
            <SettingsRow title="账户创建时间">
              <span className="account-secondary-value">{formatAccountDate(user.created_at)}</span>
            </SettingsRow>
          </AccountSection>

          <AccountSection title="个人横幅" description="横幅只用于资料展示，不会显示在账户概览中。">
            <SettingsRow title="横幅图片" description="支持 JPEG、PNG、GIF 或 WebP，最大 5MB。">
              <div className="profile-banner-control">
                <div className="profile-banner-control__preview">
                  {user.banner_url ? <img src={user.banner_url} alt="个人横幅预览" /> : <span>尚未设置横幅</span>}
                </div>
                <input
                  ref={bannerInput}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  hidden
                  data-testid="banner-input"
                  onChange={(event) => void uploadImage('banner', event)}
                />
                <div className="account-button-row">
                  <Button type="button" variant="secondary" loading={bannerLoading} onClick={() => bannerInput.current?.click()}>更换横幅</Button>
                  {user.banner_url ? <Button type="button" variant="ghost" onClick={() => void removeImage('banner')}>移除</Button> : null}
                </div>
              </div>
            </SettingsRow>
          </AccountSection>

          <AccountSection id="custom-fields" title="自定义资料" description="填写由 MindAuth 管理员提供的可选资料字段。">
            <AccountLoadState
              loading={fieldsLoading}
              error={fieldsError ? new Error('加载失败') : null}
              retry={() => void loadFields()}
            >
              {fields.length ? (
                <div className="account-settings-fields">
                  {fields.map((field) => (
                    field.field_type === 'select' && field.options?.length ? (
                      <label className="field" key={field.field_key}>
                        <span className="field__label">{field.field_label}</span>
                        <select
                          className="field__input"
                          value={fieldValues[field.field_key] || ''}
                          required={field.is_required}
                          onChange={(event) => setFieldValues((previous) => ({ ...previous, [field.field_key]: event.target.value }))}
                        >
                          <option value="">请选择</option>
                          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        {field.is_required ? <span className="field__hint">必填</span> : null}
                      </label>
                    ) : (
                      <TextField
                        key={field.field_key}
                        label={field.field_label}
                        type={field.field_type === 'email' || field.field_type === 'url' ? field.field_type : 'text'}
                        value={fieldValues[field.field_key] || ''}
                        required={field.is_required}
                        onChange={(event) => setFieldValues((previous) => ({ ...previous, [field.field_key]: event.target.value }))}
                        hint={field.is_required ? '必填' : '选填'}
                      />
                    )
                  ))}
                  <div className="account-form-actions"><Button type="button" loading={fieldsSaving} onClick={() => void saveFields()}>保存资料</Button></div>
                </div>
              ) : <AccountEmptyState>目前没有可编辑的自定义字段。</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>
        </div>
      ) : null}
    </AccountShell>
  );
}
