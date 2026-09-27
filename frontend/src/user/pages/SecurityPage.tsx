import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { ApiError } from '@/api/client';
import type { SocialBinding, SocialBindingsResponse } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Button } from '@/shared/Button';
import { Dialog } from '@/shared/Dialog';
import { TextField } from '@/shared/TextField';
import {
  AccountLoadState,
  AccountSection,
  SettingsRow,
  StatusLabel,
} from '@/user/components/AccountPageParts';
import { AccountShell } from '@/user/components/AccountShell';
import { useI18n } from '@/i18n/I18nProvider';

export function SecurityPage() {
  const { t } = useI18n();
  const { user, loadCurrentUser, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsCooldown, setSmsCooldown] = useState(0);
  const [bindings, setBindings] = useState<SocialBinding[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(true);
  const [bindingsError, setBindingsError] = useState(false);
  const [bindingAction, setBindingAction] = useState(false);
  const [bindingToRemove, setBindingToRemove] = useState<SocialBinding | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadBindings = useCallback(async () => {
    setBindingsLoading(true);
    setBindingsError(false);
    try {
      const response = await api.get<SocialBindingsResponse>('/api/account/bindings');
      setBindings(response.bindings || []);
    } catch {
      setBindingsError(true);
    } finally {
      setBindingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadBindings();
  }, [user, loadBindings]);

  useEffect(() => {
    if (searchParams.get('social') === 'qq_bound') toast('success', t('security.qqBoundToast'));
  }, [searchParams, toast, t]);

  useEffect(() => {
    if (smsCooldown <= 0) return;
    const timer = window.setInterval(() => setSmsCooldown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [smsCooldown]);

  async function sendEmailVerification() {
    try {
      await api.post('/api/email-verification/send');
      toast('success', t('security.emailSent'));
    } catch {
      toast('error', t('dashboard.emailSendFailed'));
    }
  }

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    setEmailError('');
    if (!newEmail.trim() || !emailPassword) {
      setEmailError(t('security.emailAndPasswordRequired'));
      return;
    }
    setEmailLoading(true);
    try {
      await api.post('/api/account/change-email', { new_email: newEmail.trim(), password: emailPassword });
      toast('success', t('security.emailChangeSent'));
      setNewEmail('');
      setEmailPassword('');
    } catch {
      const message = t('security.emailChangeFailed');
      setEmailError(message);
      toast('error', message);
    } finally {
      setEmailLoading(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError('');
    if (!oldPassword || !newPassword) {
      setPasswordError(t('security.passwordsRequired'));
      return;
    }
    setPasswordLoading(true);
    try {
      await api.post('/api/account/change-password', { old_password: oldPassword, new_password: newPassword });
      toast('success', t('security.passwordChanged'));
      await logout();
      navigate('/login', { replace: true });
    } catch {
      const message = t('security.passwordChangeFailed');
      setPasswordError(message);
      toast('error', message);
    } finally {
      setPasswordLoading(false);
    }
  }

  async function sendSmsCode() {
    if (!phone.trim()) {
      toast('error', t('security.phoneRequired'));
      return;
    }
    setSmsLoading(true);
    try {
      await api.post('/api/sms/send', { phone: phone.trim() });
      setSmsCooldown(60);
      toast('success', t('security.codeSent'));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SMS_RATE_LIMITED') {
        const seconds = error.retry_after_seconds || 60;
        setSmsCooldown(seconds);
        toast('error', t('security.rateLimited', { seconds }));
      } else {
        toast('error', t('security.sendCodeFailed'));
      }
    } finally {
      setSmsLoading(false);
    }
  }

  async function verifyPhone(event: FormEvent) {
    event.preventDefault();
    if (!phone.trim() || !smsCode.trim()) {
      toast('error', t('security.phoneAndCodeRequired'));
      return;
    }
    setSmsLoading(true);
    try {
      await api.post('/api/sms/verify', { phone: phone.trim(), code: smsCode.trim() });
      toast('success', t('security.phoneBoundSuccess'));
      setPhone('');
      setSmsCode('');
      setSmsCooldown(0);
      await loadCurrentUser();
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'SMS_RATE_LIMITED' || error.code === 'SMS_VERIFY_RATE_LIMITED')) {
        const seconds = error.retry_after_seconds || 60;
        setSmsCooldown(seconds);
        toast('error', t('security.rateLimited', { seconds }));
      } else {
        toast('error', t('security.phoneVerifyFailed'));
      }
    } finally {
      setSmsLoading(false);
    }
  }

  async function unbindSocialAccount() {
    if (!bindingToRemove) return;
    setBindingAction(true);
    try {
      await api.del(`/api/account/bindings/${bindingToRemove.id}`);
      toast('success', t('security.socialUnbound'));
      setBindingToRemove(null);
      await loadBindings();
    } catch {
      toast('error', t('security.unbindFailed'));
    } finally {
      setBindingAction(false);
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (!deletePassword) {
      toast('error', t('security.deletePasswordRequired'));
      return;
    }
    setDeleteLoading(true);
    try {
      await api.del('/api/account/', { password: deletePassword });
      toast('success', t('security.accountDeleted'));
      await logout();
      navigate('/login', { replace: true });
    } catch {
      toast('error', t('security.deleteFailed'));
    } finally {
      setDeleteLoading(false);
      setDeleteOpen(false);
      setDeletePassword('');
    }
  }

  return (
    <AccountShell title={t('security.title')} description={t('security.description')}>
      {user ? (
        <div className="account-page-sections">
          <AccountSection title={t('security.email')} description={t('security.emailDescription')}>
            <SettingsRow title={t('security.currentEmail')} description={user.email}>
              <div className="account-button-row">
                <StatusLabel needsAction={!user.email_verified}>{user.email_verified ? t('security.verified') : t('security.unverified')}</StatusLabel>
                {!user.email_verified ? <Button type="button" variant="secondary" size="sm" onClick={() => void sendEmailVerification()}>{t('security.sendVerification')}</Button> : null}
              </div>
            </SettingsRow>
            <SettingsRow title={t('security.changeEmail')} description={t('security.changeEmailDescription')}>
              <form id="change-email-form" data-testid="change-email-form" className="account-inline-form" onSubmit={changeEmail}>
                <TextField label={t('security.newEmail')} type="email" name="new_email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} autoComplete="email" />
                <TextField label={t('security.currentPassword')} type="password" name="email_password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} autoComplete="current-password" />
                {emailError ? <p className="field__error" role="alert">{emailError}</p> : null}
                <Button type="submit" loading={emailLoading}>{t('security.sendChangeLink')}</Button>
              </form>
            </SettingsRow>
          </AccountSection>

          <AccountSection title={t('security.phone')} description={t('security.phoneDescription')}>
            <SettingsRow title={t('security.phoneStatus')} description={user.phone_verified ? t('security.phoneBound') : t('security.phoneUnbound')}>
              {user.phone_verified ? (
                <div className="account-button-row"><span>{user.phone_masked || t('security.bound')}</span><StatusLabel>{t('security.verified')}</StatusLabel></div>
              ) : (
                <form className="account-inline-form account-inline-form--compact" onSubmit={(event) => void verifyPhone(event)}>
                  <TextField label={t('security.phoneLabel')} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
                  <div className="account-sms-code">
                    <TextField label={t('security.smsCode')} inputMode="numeric" autoComplete="one-time-code" value={smsCode} onChange={(event) => setSmsCode(event.target.value)} />
                    <Button type="button" variant="secondary" disabled={smsCooldown > 0} loading={smsLoading} onClick={() => void sendSmsCode()}>
                      {smsCooldown > 0 ? t('security.resendAfter', { seconds: smsCooldown }) : t('security.sendCode')}
                    </Button>
                  </div>
                  <Button type="submit" loading={smsLoading}>{t('security.verifyBind')}</Button>
                </form>
              )}
            </SettingsRow>
          </AccountSection>

          <AccountSection title={t('security.password')} description={t('security.passwordDescription')}>
            <SettingsRow title={t('security.changePassword')} description={t('security.changePasswordDescription')}>
              <form id="change-password-form" data-testid="change-password-form" className="account-inline-form" onSubmit={changePassword}>
                <TextField id="old_password" label={t('security.currentPassword')} type="password" name="old_password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" />
                <TextField id="new_password" label={t('security.newPassword')} type="password" name="new_password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" hint={t('security.passwordHint')} error={passwordError} />
                <Button type="submit" loading={passwordLoading}>{t('security.updatePassword')}</Button>
              </form>
            </SettingsRow>
          </AccountSection>

          <AccountSection title={t('security.social')} description={t('security.socialDescription')}>
            <AccountLoadState loading={bindingsLoading} error={bindingsError ? new Error('加载失败') : null} retry={() => void loadBindings()}>
              <div className="settings-row-list">
                {bindings.map((binding) => (
                  <SettingsRow key={binding.id} title={binding.provider.toUpperCase()} description={binding.nickname || t('security.linkedAccount')}>
                    <div className="account-button-row">
                      <StatusLabel>{t('security.bound')}</StatusLabel>
                      <Button type="button" variant="secondary" size="sm" loading={bindingAction && bindingToRemove?.id === binding.id} onClick={() => setBindingToRemove(binding)}>{t('security.unbind')}</Button>
                    </div>
                  </SettingsRow>
                ))}
                {!bindings.some((binding) => binding.provider === 'qq') ? (
                  <SettingsRow title="QQ" description={t('security.qqDescription')}>
                    <a className="btn btn--secondary btn--sm" href="/api/auth/qq?intent=bind">{t('security.bindQQ')}</a>
                  </SettingsRow>
                ) : null}
              </div>
            </AccountLoadState>
          </AccountSection>

          <AccountSection id="danger-zone" title={t('security.dangerTitle')} description={t('security.dangerDescription')}>
            <div className="account-danger-row">
              <p>{t('security.irreversible')}</p>
              <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>{t('security.deleteAccount')}</Button>
            </div>
          </AccountSection>
        </div>
      ) : null}

      <Dialog
        open={Boolean(bindingToRemove)}
        onClose={() => setBindingToRemove(null)}
        title={t('security.confirmUnbind')}
        footer={<><Button type="button" variant="ghost" onClick={() => setBindingToRemove(null)}>{t('security.cancel')}</Button><Button type="button" variant="danger" loading={bindingAction} onClick={() => void unbindSocialAccount()}>{t('security.confirmUnbindButton')}</Button></>}
      >
        <p>{t('security.unbindBody')}</p>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('security.confirmDelete')}
        footer={<><Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>{t('security.cancel')}</Button><Button type="submit" form="delete-account-confirm-form" variant="danger" loading={deleteLoading}>{t('security.permanentDelete')}</Button></>}
      >
        <form id="delete-account-confirm-form" onSubmit={(event) => void deleteAccount(event)} className="account-inline-form">
          <p>{t('security.deletePrompt')}</p>
          <TextField label={t('security.currentPassword')} type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" />
        </form>
      </Dialog>
    </AccountShell>
  );
}
