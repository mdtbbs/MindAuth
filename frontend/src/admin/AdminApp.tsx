import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from './AdminAuthProvider';
import { ToastProvider } from '@/shared/ToastProvider';
import { LoadingState } from '@/shared/LoadingState';
import { AdminShell } from './components/AdminShell';
import { AdminLoginPage } from './pages/AdminLoginPage';

// Authenticated pages are code-split — each becomes its own chunk loaded on demand
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const AdminClientsPage = lazy(() => import('./pages/AdminClientsPage').then((m) => ({ default: m.AdminClientsPage })));
const AdminSecurityPage = lazy(() => import('./pages/AdminSecurityPage').then((m) => ({ default: m.AdminSecurityPage })));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage })));
const AdminLogsPage = lazy(() => import('./pages/AdminLogsPage').then((m) => ({ default: m.AdminLogsPage })));

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
        <LoadingState />
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
      <Suspense fallback={<LoadingState />}>
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
      </Suspense>
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
