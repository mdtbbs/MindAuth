import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import api from '@/api/client';
import type { AdminUser, AdminLoginResponse } from '@/api/types';

// ─── Context shape ───────────────────────────────────────────────────────────

interface AdminAuthState {
  admin: AdminUser | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadAdmin: () => Promise<void>;
  clearError: () => void;
  hasPermission: (permission: string) => boolean;
}

const AdminAuthContext = createContext<AdminAuthState | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

interface AdminAuthProviderProps {
  children: ReactNode;
}

export function AdminAuthProvider({ children }: AdminAuthProviderProps) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialised = useRef(false);

  const loadAdmin = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; admin: AdminUser }>('/api/admin/me');
      setAdmin(res.admin);
      setError(null);
    } catch {
      setAdmin(null);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    loadAdmin().finally(() => setLoading(false));
  }, [loadAdmin]);

  const login = useCallback(
    async (username: string, password: string) => {
      setError(null);
      setLoading(true);
      try {
        const res = await api.post<AdminLoginResponse>('/api/admin/login', {
          username,
          password,
        });
        if (res.success && res.user) {
          setAdmin(res.user);
        } else {
          throw new Error('Login failed');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/admin/logout');
    } catch {
      // ignore
    }
    setAdmin(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!admin) return false;
      return admin.permissions.includes('*') || admin.permissions.includes(permission);
    },
    [admin],
  );

  return (
    <AdminAuthContext.Provider
      value={{ admin, loading, error, login, logout, loadAdmin, clearError, hasPermission }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used inside <AdminAuthProvider>');
  }
  return ctx;
}
