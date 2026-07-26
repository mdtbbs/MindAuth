import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';

interface ChallengeQuestion {
  id: number;
  question: string;
  csrf: string;
}

// Mirrors backend rules (utils/validation.js): 8+ chars, upper + lower + digit
function validateUsername(v: string): string {
  if (!v.trim()) return '请输入用户名';
  if (v.trim().length < 3) return '用户名至少 3 个字符';
  return '';
}
function validateEmail(v: string): string {
  if (!v.trim()) return '请输入邮箱';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return '邮箱格式不正确';
  return '';
}
function validatePassword(v: string): string {
  if (!v) return '请输入密码';
  if (v.length < 8) return '密码至少 8 个字符';
  if (!(/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v))) return '需包含大小写字母和数字';
  return '';
}

/** 0–4 strength score from length + character variety. */
function passwordStrength(v: string): number {
  if (!v) return 0;
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
  return Math.min(score, 4);
}
const STRENGTH_LABELS = ['太弱', '较弱', '一般', '较强', '很强'];

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, login } = useAuth();
  const { toast } = useToast();

  const redirectUri = params.get('redirect_uri') || '';
  const clientId = params.get('client_id') || '';
  const clientName = params.get('client_name') || '';
  const stateParam = params.get('state') || '';
  const decodedClientName = clientName ? decodeURIComponent(clientName) : '';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; email?: string; password?: string }>({});
  const [touched, setTouched] = useState<{ username?: boolean; email?: boolean; password?: boolean }>({});
  const [loading, setLoading] = useState(false);

  const strength = passwordStrength(password);

  const [challenge, setChallenge] = useState<ChallengeQuestion | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [challengeError, setChallengeError] = useState('');

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    api
      .get<{ success: boolean; challenge?: ChallengeQuestion }>('/api/challenge/random')
      .then((res) => {
        if (res.success && res.challenge) {
          setChallenge(res.challenge);
        }
      })
      .catch(() => {});
  }, []);

  function runValidation() {
    const errs = {
      username: validateUsername(username),
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setFieldErrors(errs);
    setTouched({ username: true, email: true, password: true });
    return !errs.username && !errs.email && !errs.password;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!runValidation()) return;

    setLoading(true);
    try {
      if (challenge) {
        try {
          await api.post('/api/challenge/verify', {
            answer: challengeAnswer,
            csrf: challenge.csrf,
          });
        } catch {
          setChallengeError('答案不正确');
          setLoading(false);
          return;
        }
      }

      const res = await api.post<{ success: boolean; message: string }>('/api/register', {
        username: username.trim(),
        email: email.trim(),
        password,
      });

      if (res.success) {
        toast('success', res.message || '注册成功');

        try {
          await login(username.trim(), password);

          if (redirectUri && clientId) {
            const oauthParams = new URLSearchParams({
              client_id: clientId,
              redirect_uri: redirectUri,
              ...(stateParam && { state: stateParam }),
            });
            window.location.href = `/api/authorize?${oauthParams.toString()}`;
          } else {
            navigate('/dashboard', { replace: true });
          }
        } catch {
          navigate('/login', { replace: true });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '注册失败';
      toast('error', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={clientId && decodedClientName ? `注册 ${decodedClientName}` : '创建 MindAuth 账户'}
      description={clientId && decodedClientName
        ? `创建账户后将继续跳转到 ${decodedClientName} 完成授权。`
        : '注册后即可统一管理账户资料、会话状态和授权应用。'}
      footer={
        <Link to="/login" className="inline-link">
          已有账号？登录
        </Link>
      }
    >
      <form id="register-form" onSubmit={handleSubmit} data-testid="register-form">
        <div className="stack">
          {clientId && decodedClientName ? (
            <div className="status-badge status-badge--info">注册后将继续连接：{decodedClientName}</div>
          ) : null}
          <TextField
            id="username"
            label="用户名"
            name="username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (touched.username) setFieldErrors((p) => ({ ...p, username: validateUsername(e.target.value) }));
            }}
            onBlur={() => {
              setTouched((p) => ({ ...p, username: true }));
              setFieldErrors((p) => ({ ...p, username: validateUsername(username) }));
            }}
            error={touched.username ? fieldErrors.username : undefined}
            placeholder="至少 3 个字符"
            autoComplete="username"
            autoFocus
          />
          <TextField
            id="email"
            label="邮箱"
            type="email"
            name="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (touched.email) setFieldErrors((p) => ({ ...p, email: validateEmail(e.target.value) }));
            }}
            onBlur={() => {
              setTouched((p) => ({ ...p, email: true }));
              setFieldErrors((p) => ({ ...p, email: validateEmail(email) }));
            }}
            error={touched.email ? fieldErrors.email : undefined}
            placeholder="请输入邮箱地址"
            autoComplete="email"
          />
          <div className="stack stack--sm">
            <TextField
              id="password"
              label="密码"
              type="password"
              name="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (touched.password) setFieldErrors((p) => ({ ...p, password: validatePassword(e.target.value) }));
              }}
              onBlur={() => {
                setTouched((p) => ({ ...p, password: true }));
                setFieldErrors((p) => ({ ...p, password: validatePassword(password) }));
              }}
              error={touched.password ? fieldErrors.password : undefined}
              hint={touched.password && fieldErrors.password ? undefined : '至少 8 个字符，包含大小写字母和数字'}
              placeholder="请输入密码"
              autoComplete="new-password"
            />
            {password ? (
              <div className="password-strength" aria-live="polite">
                <div className="password-strength__track">
                  <div
                    className={`password-strength__bar password-strength__bar--${strength}`}
                    style={{ width: `${(strength / 4) * 100}%` }}
                  />
                </div>
                <span className="password-strength__label">密码强度：{STRENGTH_LABELS[strength]}</span>
              </div>
            ) : null}
          </div>

          {challenge ? (
            <TextField
              label={`验证问题：${challenge.question}`}
              name="challenge"
              value={challengeAnswer}
              onChange={(e) => {
                setChallengeAnswer(e.target.value);
                setChallengeError('');
              }}
              error={challengeError}
              placeholder="请输入答案"
            />
          ) : null}

          <Button type="submit" fullWidth size="lg" loading={loading} data-testid="register-submit">
            注册并继续
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
