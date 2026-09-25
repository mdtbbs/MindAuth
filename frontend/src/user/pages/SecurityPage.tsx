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

export function SecurityPage() {
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
    if (searchParams.get('social') === 'qq_bound') toast('success', 'QQ 账号已绑定');
  }, [searchParams, toast]);

  useEffect(() => {
    if (smsCooldown <= 0) return;
    const timer = window.setInterval(() => setSmsCooldown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [smsCooldown]);

  async function sendEmailVerification() {
    try {
      await api.post('/api/email-verification/send');
      toast('success', '验证邮件已发送');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '发送验证邮件失败');
    }
  }

  async function changeEmail(event: FormEvent) {
    event.preventDefault();
    setEmailError('');
    if (!newEmail.trim() || !emailPassword) {
      setEmailError('请填写新邮箱和当前密码');
      return;
    }
    setEmailLoading(true);
    try {
      await api.post('/api/account/change-email', { new_email: newEmail.trim(), password: emailPassword });
      toast('success', '验证邮件已发送到新邮箱，请按邮件提示完成更换');
      setNewEmail('');
      setEmailPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : '发起邮箱更换失败';
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
      setPasswordError('请填写当前密码和新密码');
      return;
    }
    setPasswordLoading(true);
    try {
      await api.post('/api/account/change-password', { old_password: oldPassword, new_password: newPassword });
      toast('success', '密码已更新，请重新登录');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : '修改密码失败';
      setPasswordError(message);
      toast('error', message);
    } finally {
      setPasswordLoading(false);
    }
  }

  async function sendSmsCode() {
    if (!phone.trim()) {
      toast('error', '请输入手机号');
      return;
    }
    setSmsLoading(true);
    try {
      await api.post('/api/sms/send', { phone: phone.trim() });
      setSmsCooldown(60);
      toast('success', '验证码已发送');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SMS_RATE_LIMITED') {
        const seconds = error.retry_after_seconds || 60;
        setSmsCooldown(seconds);
        toast('error', `发送太频繁，请 ${seconds} 秒后重试`);
      } else {
        toast('error', error instanceof Error ? error.message : '发送验证码失败');
      }
    } finally {
      setSmsLoading(false);
    }
  }

  async function verifyPhone(event: FormEvent) {
    event.preventDefault();
    if (!phone.trim() || !smsCode.trim()) {
      toast('error', '请输入手机号和验证码');
      return;
    }
    setSmsLoading(true);
    try {
      await api.post('/api/sms/verify', { phone: phone.trim(), code: smsCode.trim() });
      toast('success', '手机号绑定成功');
      setPhone('');
      setSmsCode('');
      setSmsCooldown(0);
      await loadCurrentUser();
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'SMS_RATE_LIMITED' || error.code === 'SMS_VERIFY_RATE_LIMITED')) {
        const seconds = error.retry_after_seconds || 60;
        setSmsCooldown(seconds);
        toast('error', `操作太频繁，请 ${seconds} 秒后重试`);
      } else {
        toast('error', error instanceof Error ? error.message : '手机号验证失败');
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
      toast('success', '关联账号已解绑');
      setBindingToRemove(null);
      await loadBindings();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '解绑失败');
    } finally {
      setBindingAction(false);
    }
  }

  async function deleteAccount(event: FormEvent) {
    event.preventDefault();
    if (!deletePassword) {
      toast('error', '请输入密码以确认删除');
      return;
    }
    setDeleteLoading(true);
    try {
      await api.del('/api/account/', { password: deletePassword });
      toast('success', '账户已删除');
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '删除账户失败');
    } finally {
      setDeleteLoading(false);
      setDeleteOpen(false);
      setDeletePassword('');
    }
  }

  return (
    <AccountShell title="登录与安全" description="管理用于登录、验证和恢复 MindAuth 账户的方式。">
      {user ? (
        <div className="account-page-sections">
          <AccountSection title="邮箱" description="邮箱可用于登录、通知和账户恢复。">
            <SettingsRow title="当前邮箱" description={user.email}>
              <div className="account-button-row">
                <StatusLabel needsAction={!user.email_verified}>{user.email_verified ? '已验证' : '尚未验证'}</StatusLabel>
                {!user.email_verified ? <Button type="button" variant="secondary" size="sm" onClick={() => void sendEmailVerification()}>发送验证邮件</Button> : null}
              </div>
            </SettingsRow>
            <SettingsRow title="更换邮箱" description="向新邮箱发送验证链接，完成验证后才会更新账户邮箱。">
              <form id="change-email-form" data-testid="change-email-form" className="account-inline-form" onSubmit={changeEmail}>
                <TextField label="新邮箱" type="email" name="new_email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} autoComplete="email" />
                <TextField label="当前密码" type="password" name="email_password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} autoComplete="current-password" />
                {emailError ? <p className="field__error" role="alert">{emailError}</p> : null}
                <Button type="submit" loading={emailLoading}>发送更换链接</Button>
              </form>
            </SettingsRow>
          </AccountSection>

          <AccountSection title="手机号" description="绑定手机号可以增强账户恢复能力。">
            <SettingsRow title="绑定状态" description={user.phone_verified ? '手机号已验证并绑定。' : '尚未绑定手机号。'}>
              {user.phone_verified ? (
                <div className="account-button-row"><span>{user.phone_masked || '已绑定'}</span><StatusLabel>已验证</StatusLabel></div>
              ) : (
                <form className="account-inline-form account-inline-form--compact" onSubmit={(event) => void verifyPhone(event)}>
                  <TextField label="手机号" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
                  <div className="account-sms-code">
                    <TextField label="短信验证码" inputMode="numeric" autoComplete="one-time-code" value={smsCode} onChange={(event) => setSmsCode(event.target.value)} />
                    <Button type="button" variant="secondary" disabled={smsCooldown > 0} loading={smsLoading} onClick={() => void sendSmsCode()}>
                      {smsCooldown > 0 ? `${smsCooldown} 秒后重发` : '发送验证码'}
                    </Button>
                  </div>
                  <Button type="submit" loading={smsLoading}>验证并绑定</Button>
                </form>
              )}
            </SettingsRow>
          </AccountSection>

          <AccountSection title="密码" description="定期更新密码，并避免在其他服务重复使用。">
            <SettingsRow title="更改密码" description="保存后会注销此账户的所有会话，需要重新登录。">
              <form id="change-password-form" data-testid="change-password-form" className="account-inline-form" onSubmit={changePassword}>
                <TextField id="old_password" label="当前密码" type="password" name="old_password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" />
                <TextField id="new_password" label="新密码" type="password" name="new_password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" hint="至少 8 个字符，包含大小写字母和数字" error={passwordError} />
                <Button type="submit" loading={passwordLoading}>更新密码</Button>
              </form>
            </SettingsRow>
          </AccountSection>

          <AccountSection title="关联账号" description="使用第三方账号登录 MindAuth。">
            <AccountLoadState loading={bindingsLoading} error={bindingsError ? new Error('加载失败') : null} retry={() => void loadBindings()}>
              <div className="settings-row-list">
                {bindings.map((binding) => (
                  <SettingsRow key={binding.id} title={binding.provider.toUpperCase()} description={binding.nickname || '已关联账号'}>
                    <div className="account-button-row">
                      <StatusLabel>已绑定</StatusLabel>
                      <Button type="button" variant="secondary" size="sm" loading={bindingAction && bindingToRemove?.id === binding.id} onClick={() => setBindingToRemove(binding)}>解绑</Button>
                    </div>
                  </SettingsRow>
                ))}
                {!bindings.some((binding) => binding.provider === 'qq') ? (
                  <SettingsRow title="QQ" description="绑定 QQ 后可使用 QQ 快速登录。">
                    <a className="btn btn--secondary btn--sm" href="/api/auth/qq?intent=bind">绑定 QQ</a>
                  </SettingsRow>
                ) : null}
              </div>
            </AccountLoadState>
          </AccountSection>

          <AccountSection id="danger-zone" title="删除账户" description="删除账户会永久清除账户资料、授权、通知和登录记录。">
            <div className="account-danger-row">
              <p>此操作不可撤销，删除后无法恢复账户或关联数据。</p>
              <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>删除账户</Button>
            </div>
          </AccountSection>
        </div>
      ) : null}

      <Dialog
        open={Boolean(bindingToRemove)}
        onClose={() => setBindingToRemove(null)}
        title="确认解绑关联账号"
        footer={<><Button type="button" variant="ghost" onClick={() => setBindingToRemove(null)}>取消</Button><Button type="button" variant="danger" loading={bindingAction} onClick={() => void unbindSocialAccount()}>确认解绑</Button></>}
      >
        <p>解绑后将不能再使用该第三方账号登录。</p>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="确认删除账户"
        footer={<><Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>取消</Button><Button type="submit" form="delete-account-confirm-form" variant="danger" loading={deleteLoading}>永久删除</Button></>}
      >
        <form id="delete-account-confirm-form" onSubmit={(event) => void deleteAccount(event)} className="account-inline-form">
          <p>请输入当前密码以确认删除账户。此操作无法撤销。</p>
          <TextField label="当前密码" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" />
        </form>
      </Dialog>
    </AccountShell>
  );
}
