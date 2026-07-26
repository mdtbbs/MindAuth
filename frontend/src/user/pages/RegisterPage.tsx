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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!username.trim() || !email.trim() || !password) {
      setError('请填写所有字段');
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
      setError(msg);
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
      eyebrow={clientId ? 'OAuth 注册授权' : 'MindAuth 账户注册'}
      heroTitle={clientId ? '先创建账户，再继续应用授权。' : '创建一个可靠的统一账户入口。'}
      heroDescription={clientId
        ? '注册完成后会自动登录，并保留当前 OAuth 上下文继续返回应用。'
        : '统一入口用于管理邮箱验证、会话记录、通知与安全能力，适配社区与开发者场景。'}
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
            onChange={(e) => setUsername(e.target.value)}
            error={error}
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
            onChange={(e) => setEmail(e.target.value)}
            placeholder="请输入邮箱地址"
            autoComplete="email"
          />
          <TextField
            id="password"
            label="密码"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="至少 8 个字符，包含大小写字母和数字"
            placeholder="请输入密码"
            autoComplete="new-password"
          />

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
