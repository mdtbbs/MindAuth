import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';
import { AuthShell } from '@/user/components/AuthShell';
import type { SendRegistrationCodeResponse } from '@/api/types';

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
function validateEmailCode(v: string): string {
  if (!v) return '请输入验证码';
  if (!/^\d{6}$/.test(v)) return '验证码为 6 位数字';
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

const SEND_COOLDOWN_SECONDS = 60;

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, login } = useAuth();
  const { toast } = useToast();

  const redirectUri = params.get('redirect_uri') || params.get('redirect') || '';
  const clientId = params.get('client_id') || '';
  const clientName = params.get('client_name') || '';
  const stateParam = params.get('state') || '';
  const decodedClientName = clientName ? decodeURIComponent(clientName) : '';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    username?: string;
    email?: string;
    password?: string;
  }>({});
  const [touched, setTouched] = useState<{
    username?: boolean;
    email?: boolean;
    password?: boolean;
  }>({});
  const [loading, setLoading] = useState(false);

  // Email code state
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeError, setCodeError] = useState('');
  const [emailFieldError, setEmailFieldError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<number | null>(null);

  const strength = passwordStrength(password);

  const [challenge, setChallenge] = useState<ChallengeQuestion | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [challengeError, setChallengeError] = useState('');

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  // Clear the countdown timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (countdownRef.current !== null) {
        window.clearInterval(countdownRef.current);
      }
    };
  }, []);

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

  function startCountdown(seconds: number) {
    setCountdown(seconds);
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current);
    }
    countdownRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current !== null) {
            window.clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSendCode() {
    const emailErr = validateEmail(email);
    if (emailErr) {
      setFieldErrors((p) => ({ ...p, email: emailErr }));
      setTouched((p) => ({ ...p, email: true }));
      return;
    }

    setCodeSending(true);
    setCodeError('');
    setEmailFieldError('');
    try {
      const res = await api.post<SendRegistrationCodeResponse>('/api/register/send-code', {
        email: email.trim(),
      });
      if (res.success) {
        setCodeSent(true);
        startCountdown(SEND_COOLDOWN_SECONDS);
        // In dev mode, the response includes the code for tests.
        // If it's there, pre-fill for convenience (dev-only).
        if (res.code) {
          setEmailCode(res.code);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败';
      // Map known error codes to inline email field errors
      const errObj = err as { code?: string; message?: string } | null;
      const code = errObj?.code;
      if (code === 'EMAIL_ALREADY_REGISTERED') {
        setEmailFieldError('该邮箱已注册，请直接登录');
      } else if (code === 'SMTP_UNAVAILABLE') {
        setCodeError('邮件服务暂时不可用，请稍后重试');
      } else if (code === 'EMAIL_COOLDOWN') {
        setCodeError(msg);
      } else {
        toast('error', msg);
      }
    } finally {
      setCodeSending(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!runValidation()) return;

    const codeErr = validateEmailCode(emailCode);
    if (codeErr) {
      setCodeError(codeErr);
      return;
    }

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
        email_code: emailCode,
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
      const errObj = err as { code?: string; message?: string } | null;
      const code = errObj?.code;
      const msg = err instanceof Error ? err.message : '注册失败';

      if (code === 'EMAIL_CODE_INVALID' || code === 'EMAIL_CODE_MISMATCH' || code === 'EMAIL_CODE_MAX_FAILURES') {
        setCodeError(msg);
      } else {
        toast('error', msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const emailValid = !validateEmail(email);
  const canSendCode = emailValid && !codeSending && countdown === 0;
  const canSubmit = emailValid && codeSent && /^\d{6}$/.test(emailCode) && !loading;

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
          <div>
            <TextField
              id="email"
              label="邮箱"
              type="email"
              name="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailFieldError('');
                if (touched.email) setFieldErrors((p) => ({ ...p, email: validateEmail(e.target.value) }));
                // Reset code state when email changes.
                if (codeSent && e.target.value.trim().toLowerCase() !== email.trim().toLowerCase()) {
                  setCodeSent(false);
                  setEmailCode('');
                  setCodeError('');
                }
              }}
              onBlur={() => {
                setTouched((p) => ({ ...p, email: true }));
                setFieldErrors((p) => ({ ...p, email: validateEmail(email) }));
              }}
              error={touched.email ? fieldErrors.email || emailFieldError : emailFieldError || undefined}
              placeholder="请输入邮箱地址"
              autoComplete="email"
            />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleSendCode}
                disabled={!canSendCode}
                loading={codeSending}
                data-testid="register-send-code"
              >
                {countdown > 0 ? `重新发送 (${countdown}s)` : codeSent ? '重新发送验证码' : '发送验证码'}
              </Button>
              {codeSent && (
                <span className="text-muted" style={{ fontSize: 12 }} data-testid="register-code-sent-hint">
                  验证码已发送到您的邮箱，请查收
                </span>
              )}
            </div>
          </div>

          {codeSent && (
            <TextField
              id="emailCode"
              label="邮箱验证码"
              name="emailCode"
              value={emailCode}
              onChange={(e) => {
                // Keep only digits, max 6
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                setEmailCode(digits);
                if (codeError) setCodeError('');
              }}
              onBlur={() => {
                if (emailCode) {
                  const err = validateEmailCode(emailCode);
                  if (err) setCodeError(err);
                }
              }}
              error={codeError || undefined}
              placeholder="请输入 6 位数字验证码"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              data-testid="register-email-code"
            />
          )}

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

          <Button type="submit" fullWidth size="lg" loading={loading} disabled={!canSubmit} data-testid="register-submit">
            注册并继续
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
