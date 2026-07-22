import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from './AdminAuthProvider';
import { ToastProvider } from '@/shared/ToastProvider';
import { AdminShell } from './components/AdminShell';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminClientsPage } from './pages/AdminClientsPage';
import { AdminSecurityPage } from './pages/AdminSecurityPage';
import { AdminSettingsPage } from './pages/AdminSettingsPage';
import { AdminLogsPage } from './pages/AdminLogsPage';

/**
 * Inner router component that has access to useNavigate/useLocation.
 * Manages page-based navigation within the admin shell.
 */
function AdminRouter() {
  const { admin, loading } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Map hash paths to page IDs
  const pathToPage: Record<string, string> = {
    '/': 'dashboard',
    '/dashboard': 'dashboard',
    '/users': 'users',
    '/clients': 'clients',
    '/security': 'security',
    '/settings': 'settings',
    '/logs': 'logs',
  };

  const currentPage = pathToPage[location.pathname] || 'dashboard';

  function handleNavigate(page: string) {
    navigate(`/${page === 'dashboard' ? '' : page}`);
  }

  // Show loading state
  if (loading) {
    return (
      <div className="page--auth">
        <p style={{ color: 'var(--color-text-muted)' }}>加载中...</p>
      </div>
    );
  }

  // Show login if not authenticated
  if (!admin) {
    return <AdminLoginPage onLoginSuccess={() => navigate('/dashboard')} />;
  }

  // Render admin shell with current page
  return (
    <AdminShell currentPage={currentPage} onNavigate={handleNavigate}>
      <Routes>
        <Route path="/" element={<AdminDashboardPage />} />
        <Route path="/dashboard" element={<AdminDashboardPage />} />
        <Route path="/users" element={<AdminUsersPage />} />
        <Route path="/clients" element={<AdminClientsPage />} />
        <Route path="/security" element={<AdminSecurityPage />} />
        <Route path="/settings" element={<AdminSettingsPage />} />
        <Route path="/logs" element={<AdminLogsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AdminShell>
  );
}

/**
 * Admin application root component.
 * Wraps everything in HashRouter, AdminAuthProvider, and ToastProvider.
 */
export function AdminApp() {
  return (
    <HashRouter>
      <AdminAuthProvider>
        <ToastProvider>
          <AdminRouter />
        </ToastProvider>
      </AdminAuthProvider>
    </HashRouter>
  );
}
