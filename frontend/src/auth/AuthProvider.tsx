import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import api, { clearCsrfCache, setUnauthorizedHandler } from '@/api/client';
import type { User, LoginResponse, MeResponse } from '@/api/types';

// ─── Context shape ───────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadCurrentUser: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);

  const loadCurrentUser = useCallback(async () => {
    try {
      // /api/me returns the user fields flattened onto the response object
      const { success, ...me } = await api.get<MeResponse>('/api/me');
      setUser(success ? (me as User) : null);
      setError(null);
    } catch {
      setUser(null);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    // Register 401 handler to clear user state. Admin-only endpoints returning
    // 401 for a regular user do NOT mean the session expired — ignore those,
    // otherwise opening a page that probes an admin API logs the user out.
    setUnauthorizedHandler((path) => {
      if (path.startsWith('/api/admin')) return;
      setUser(null);
    });

    loadCurrentUser().finally(() => setLoading(false));
  }, [loadCurrentUser]);

  const login = useCallback(
    async (username: string, password: string) => {
      setError(null);
      setLoading(true);
      try {
        const res = await api.post<LoginResponse>('/api/login', {
          username,
          password,
        });
        if (!res.success) {
          throw new Error(res.message || '登录失败');
        }
        // /api/login only sets the session cookie — load the user separately
        await loadCurrentUser();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [loadCurrentUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/logout');
    } catch {
      // ignore — we clear local state regardless
    }
    setUser(null);
    clearCsrfCache();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider
      value={{ user, loading, error, login, logout, loadCurrentUser, clearError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
