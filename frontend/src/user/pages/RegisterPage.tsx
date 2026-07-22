import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { Card, CardTitle } from '@/shared/Card';
import { TextField } from '@/shared/TextField';
import { Button } from '@/shared/Button';

interface ChallengeQuestion {
  id: number;
  question: string;
  csrf: string;
}

/**
 * Registration page with optional challenge question support.
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, login } = useAuth();
  const { toast } = useToast();

  // OAuth redirect params (preserve for redirect after registration)
  const redirectUri = params.get('redirect_uri') || '';
  const clientId = params.get('client_id') || '';
  const clientName = params.get('client_name') || '';
  const stateParam = params.get('state') || '';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Challenge question state
  const [challenge, setChallenge] = useState<ChallengeQuestion | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [challengeError, setChallengeError] = useState('');

  // Redirect to dashboard if already logged in
  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  // Fetch challenge question on mount
  useEffect(() => {
    api
      .get<{ success: boolean; challenge?: ChallengeQuestion }>('/api/challenge/random')
      .then((res) => {
        if (res.success && res.challenge) {
          setChallenge(res.challenge);
        }
      })
      .catch(() => {
        // Challenge not required or not available
      });
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
      // Verify challenge if present
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

      // Register
      const res = await api.post<{ success: boolean; message: string }>('/api/register', {
        username: username.trim(),
        email: email.trim(),
        password,
      });

      if (res.success) {
        toast('success', res.message || '注册成功');

        // Auto-login after registration
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
    <div className="page--auth">
      <Card padding="lg">
        <CardTitle>
          {clientId && clientName
            ? `注册 ${decodeURIComponent(clientName)}`
            : '注册 MindAuth'}
        </CardTitle>

        <form
          id="register-form"
          onSubmit={handleSubmit}
          style={{ marginTop: 'var(--space-4)' }}
          data-testid="register-form"
        >
          <div className="stack">
            <TextField
              id="username"
              label="用户名"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={error}
              placeholder="至少3个字符"
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
              hint="至少8个字符，包含大小写字母和数字"
              placeholder="请输入密码"
              autoComplete="new-password"
            />

            {challenge && (
              <TextField
                label={`验证问题: ${challenge.question}`}
                name="challenge"
                value={challengeAnswer}
                onChange={(e) => {
                  setChallengeAnswer(e.target.value);
                  setChallengeError('');
                }}
                error={challengeError}
                placeholder="请输入答案"
              />
            )}

            <Button type="submit" fullWidth loading={loading} data-testid="register-submit">
              注册
            </Button>
          </div>
        </form>

        <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--color-primary)', fontSize: 'var(--text-sm)' }}>
            已有账号？登录
          </Link>
        </div>
      </Card>
    </div>
  );
}
