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
import { useI18n } from '@/i18n/I18nProvider';

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
  const { t } = useI18n();
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
      toast('error', t('profile.imageTooLarge', { size: maxSize }));
      event.target.value = '';
      return;
    }
    const setLoading = kind === 'avatar' ? setAvatarLoading : setBannerLoading;
    setLoading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await api.postForm(`/api/account/${kind}`, body);
      toast('success', kind === 'avatar' ? t('profile.avatarUpdated') : t('profile.bannerUpdated'));
      await loadCurrentUser();
    } catch {
      toast('error', t('profile.uploadFailed'));
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  }

  async function removeImage(kind: 'avatar' | 'banner') {
    try {
      await api.del(`/api/account/${kind}`);
      toast('success', kind === 'avatar' ? t('profile.avatarDeleted') : t('profile.bannerDeleted'));
      await loadCurrentUser();
    } catch {
      toast('error', t('profile.deleteFailed'));
    }
  }

  async function changeUsername(event: FormEvent) {
    event.preventDefault();
    setUsernameError('');
    if (!user || !username.trim() || username.trim() === user.username) {
      setUsernameError(t('profile.newUsernameRequired'));
      return;
    }
    setUsernameLoading(true);
    try {
      await api.post('/api/account/change-username', { new_username: username.trim() });
      toast('success', t('profile.usernameUpdated'));
      await logout();
      navigate('/login', { replace: true });
    } catch {
      const message = t('profile.usernameFailed');
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
      toast('success', t('profile.fieldsSaved'));
    } catch {
      toast('error', t('profile.fieldsSaveFailed'));
    } finally {
      setFieldsSaving(false);
    }
  }

  return (
    <AccountShell title={t('profile.title')} description={t('profile.description')}>
      {user ? (
        <div className="account-page-sections">
          <AccountSection title={t('profile.avatar')} description={t('profile.avatarDescription')}>
            <SettingsRow title={t('profile.avatarTitle')} description={t('profile.imageTypes', { size: 2 })}>
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
                  <Button type="button" variant="secondary" loading={avatarLoading} onClick={() => avatarInput.current?.click()}>{t('profile.changeAvatar')}</Button>
                  {user.avatar_url ? <Button type="button" variant="ghost" onClick={() => void removeImage('avatar')}>{t('profile.remove')}</Button> : null}
                </div>
              </div>
            </SettingsRow>
          </AccountSection>

          <AccountSection title={t('profile.basic')} description={t('profile.basicDescription')}>
            <SettingsRow title={t('profile.username')} description={t('profile.usernameDescription')}>
              <form id="change-username-form" data-testid="change-username-form" className="account-inline-form" onSubmit={changeUsername}>
                <TextField
                  id="new_username"
                  label={t('profile.username')}
                  name="new_username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  error={usernameError}
                  hint={t('profile.usernameHint')}
                  autoComplete="username"
                />
                <Button type="submit" loading={usernameLoading}>{t('profile.saveUsername')}</Button>
              </form>
            </SettingsRow>
            <SettingsRow title={t('profile.email')} description={t('profile.emailDescription')}>
              <div className="account-value-stack">
                <span>{user.email}</span>
                <StatusLabel needsAction={!user.email_verified}>{user.email_verified ? t('profile.verified') : t('profile.pending')}</StatusLabel>
                {!user.email_verified ? <Link className="account-text-link" to="/security">{t('profile.verifyEmail')}</Link> : null}
              </div>
            </SettingsRow>
            <SettingsRow title={t('profile.createdAt')}>
              <span className="account-secondary-value">{formatAccountDate(user.created_at)}</span>
            </SettingsRow>
          </AccountSection>

          <AccountSection title={t('profile.banner')} description={t('profile.bannerDescription')}>
            <SettingsRow title={t('profile.bannerTitle')} description={t('profile.bannerTypes')}>
              <div className="profile-banner-control">
                <div className="profile-banner-control__preview">
                  {user.banner_url ? <img src={user.banner_url} alt={t('profile.bannerPreview')} /> : <span>{t('profile.bannerUnset')}</span>}
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
                  <Button type="button" variant="secondary" loading={bannerLoading} onClick={() => bannerInput.current?.click()}>{t('profile.changeBanner')}</Button>
                  {user.banner_url ? <Button type="button" variant="ghost" onClick={() => void removeImage('banner')}>{t('profile.remove')}</Button> : null}
                </div>
              </div>
            </SettingsRow>
          </AccountSection>

          <AccountSection id="custom-fields" title={t('profile.custom')} description={t('profile.customDescription')}>
            <AccountLoadState
              loading={fieldsLoading}
              error={fieldsError ? new Error('load_failed') : null}
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
                          <option value="">{t('profile.choose')}</option>
                          {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        {field.is_required ? <span className="field__hint">{t('profile.required')}</span> : null}
                      </label>
                    ) : (
                      <TextField
                        key={field.field_key}
                        label={field.field_label}
                        type={field.field_type === 'email' || field.field_type === 'url' ? field.field_type : 'text'}
                        value={fieldValues[field.field_key] || ''}
                        required={field.is_required}
                        onChange={(event) => setFieldValues((previous) => ({ ...previous, [field.field_key]: event.target.value }))}
                        hint={field.is_required ? t('profile.required') : t('profile.optional')}
                      />
                    )
                  ))}
                  <div className="account-form-actions"><Button type="button" loading={fieldsSaving} onClick={() => void saveFields()}>{t('profile.save')}</Button></div>
                </div>
              ) : <AccountEmptyState>{t('profile.emptyFields')}</AccountEmptyState>}
            </AccountLoadState>
          </AccountSection>
        </div>
      ) : null}
    </AccountShell>
  );
}
