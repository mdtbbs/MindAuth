import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { AuthShell } from '@/user/components/AuthShell';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { useToast } from '@/shared/ToastProvider';
import { useAuth } from '@/auth/AuthProvider';
import type { QqRegistrationResponse } from '@/api/types';

/**
 * QQ 注册页面
 *
 * 用户未绑定 QQ 时会跳转此页面，需要填写：
 * - 用户名
 * - 邮箱
 * - 邮箱验证码
 * - 密码
 *
 * 注册成功后会自动创建 session 并跳转到 dashboard 或恢复 OAuth 流程。
 */
export function QqRegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { loadCurrentUser } = useAuth();

  const state = params.get('state') || '';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [codeSending, setCodeSending] = useState(false);
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    if (!email) {
      toast('error', '请先填写邮箱');
      return;
    }
    setCodeSending(true);
    try {
      await api.post('/api/register/send-code', { email: email.trim() });
      toast('success', '验证码已发送，请查收邮件');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setCodeSending(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state) {
      toast('error', '注册状态无效，请重新发起 QQ 登录');
      navigate('/login', { replace: true });
      return;
    }
    if (!username || !email || !password || !emailCode) {
      toast('error', '请填写全部字段');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post<QqRegistrationResponse>('/api/auth/qq/complete', {
        state,
        username: username.trim(),
        email: email.trim(),
        email_code: emailCode,
        password,
      });

      // 刷新当前用户
      await loadCurrentUser();

      toast('success', '注册成功');

      // 跳转到后端返回的 URL，或默认 dashboard
      const redirectUrl = response.redirect || '/dashboard';
      navigate(redirectUrl, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '注册失败';
      toast('error', message);
    } finally {
      setLoading(false);
    }
  }

  // state 缺失时显示错误
  if (!state) {
    return (
      <AuthShell
        title="QQ 注册"
        description="注册状态无效或已过期。"
        footer={<Link className="inline-link" to="/login">返回登录</Link>}
      >
        <p>请重新发起 QQ 登录流程。</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="使用 QQ 注册"
      description="完善资料后即可创建 MindAuth 账户。"
      footer={<Link className="inline-link" to="/login">返回登录</Link>}
    >
      <form onSubmit={submit} className="stack">
        <TextField
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />
        <TextField
          label="邮箱"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <div className="cluster">
          <TextField
            label="邮箱验证码"
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
          />
          <Button type="button" variant="secondary" size="sm" loading={codeSending} onClick={sendCode}>
            发送验证码
          </Button>
        </div>
        <TextField
          label="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" fullWidth size="lg" loading={loading}>
          完成注册
        </Button>
      </form>
    </AuthShell>
  );
}
