import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from './AdminAuthProvider';
import { ToastProvider } from '@/shared/ToastProvider';
import { LoadingState } from '@/shared/LoadingState';
import { AdminShell } from './components/AdminShell';
import { AdminLoginPage } from './pages/AdminLoginPage';

const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage = lazy(() => import('./pages/AdminUserDetailPage').then(m => ({ default: m.AdminUserDetailPage })));
const AdminAdminsPage = lazy(() => import('./pages/AdminAdminsPage').then(m => ({ default: m.AdminAdminsPage })));
const AdminSessionsPage = lazy(() => import('./pages/AdminSessionsPage').then(m => ({ default: m.AdminSessionsPage })));
const AdminRiskPage = lazy(() => import('./pages/AdminRiskPage').then(m => ({ default: m.AdminRiskPage })));
const AdminEmailPolicyPage = lazy(() => import('./pages/AdminEmailPolicyPage').then(m => ({ default: m.AdminEmailPolicyPage })));
const AdminApplicationsPage = lazy(() => import('./pages/AdminApplicationsPage').then(m => ({ default: m.AdminApplicationsPage })));
const AdminClientsPage = lazy(() => import('./pages/AdminClientsPage').then(m => ({ default: m.AdminClientsPage })));
const AdminSecurityPage = lazy(() => import('./pages/AdminSecurityPage').then(m => ({ default: m.AdminSecurityPage })));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })));
const AdminLogsPage = lazy(() => import('./pages/AdminLogsPage').then(m => ({ default: m.AdminLogsPage })));

function RegistrationPage() {
  return <div className="admin-page">
    <div className="admin-page-heading"><div><h1 className="admin-page-title">注册与认证</h1><p className="admin-page-lead">注册开关、密码要求和验证问题。</p></div></div>
    <AdminSettingsPage initialTab="system" standalone hideTitle />
    <section className="admin-registration-challenges"><div className="admin-section-heading"><h2>验证问题</h2><p>题目答案不回显；修改答案时输入新值即可。</p></div><AdminSecurityPage initialSection="challenges" standalone hideTitle /></section>
  </div>;
}

function PermissionDenied() {
  return <section className="admin-state"><h1>无权访问</h1><p>当前管理员角色没有查看此页面的权限。</p></section>;
}

function AdminRouter() {
  const { admin, loading, hasPermission } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  if (loading) return <div className="page--auth"><LoadingState /></div>;
  if (!admin) return <AdminLoginPage onLoginSuccess={() => navigate('/')} />;

  const protect = (permission: string, element: ReactNode) => hasPermission(permission) ? element : <PermissionDenied />;
  return <AdminShell>
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/" element={protect('dashboard.read', <AdminDashboardPage />)} />
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="/users" element={protect('users.read', <AdminUsersPage />)} />
        <Route path="/users/:id" element={protect('users.read', <AdminUserDetailPage />)} />
        <Route path="/admins" element={protect('admins.read', <AdminAdminsPage />)} />
        <Route path="/sessions" element={protect('sessions.read', <AdminSessionsPage />)} />
        <Route path="/risk" element={protect('security.read', <AdminRiskPage />)} />
        <Route path="/email-policy" element={protect('email_rules.read', <AdminEmailPolicyPage />)} />
        <Route path="/ip-rules" element={protect('ip_bans.read', <AdminSecurityPage initialSection="ip_bans" standalone />)} />
        <Route path="/applications" element={protect('developers.read', <AdminApplicationsPage />)} />
        <Route path="/clients" element={protect('clients.read', <AdminClientsPage />)} />
        <Route path="/messaging" element={protect('email_config.read', <AdminSettingsPage initialTab="email" standalone showMessagingTabs />)} />
        <Route path="/registration" element={protect('config.read', <RegistrationPage />)} />
        <Route path="/user-fields" element={protect('config.read', <AdminSecurityPage initialSection="fields" standalone />)} />
        <Route path="/appearance" element={protect('config.read', <AdminSettingsPage initialTab="appearance" standalone />)} />
        <Route path="/login-logs" element={protect('login_logs.read', <AdminLogsPage initialSection="login" standalone />)} />
        <Route path="/admin-logs" element={protect('audit_logs.read', <AdminLogsPage initialSection="audit" standalone />)} />
        <Route path="/sms-logs" element={protect('sms_audit.read', <AdminLogsPage initialSection="sms" standalone />)} />
        <Route path="/security" element={<Navigate to="/ip-rules" replace />} />
        <Route path="/settings" element={<Navigate to="/messaging" replace />} />
        <Route path="/logs" element={<Navigate to="/login-logs" replace />} />
        <Route path="*" element={<Navigate to={location.pathname.startsWith('/users/') ? '/users' : '/'} replace />} />
      </Routes>
    </Suspense>
  </AdminShell>;
}

export function AdminApp() {
  return <HashRouter><AdminAuthProvider><ToastProvider><AdminRouter /></ToastProvider></AdminAuthProvider></HashRouter>;
}
