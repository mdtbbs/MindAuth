import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetRequestPage } from './pages/ResetRequestPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { OAuthAuthorizePage } from './pages/OAuthAuthorizePage';
import { DeviceAuthorizationPage } from './pages/DeviceAuthorizationPage';
import { PublicAppsPage } from './pages/PublicAppsPage';
import { DashboardPage } from './pages/DashboardPage';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SecurityPage } from './pages/SecurityPage';
import { SessionsPage } from './pages/SessionsPage';
import { ActivityPage } from './pages/ActivityPage';
import { AuthorizationsPage } from './pages/AuthorizationsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { DeveloperPage } from './pages/DeveloperPage';
import { QqConfirmPage } from './pages/QqConfirmPage';
import { QqRegisterPage } from './pages/QqRegisterPage';
import { ErrorPage } from './pages/ErrorPage';

/** User-facing SPA route table; providers are installed by main.tsx. */
export function UserApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/reset-request" element={<ResetRequestPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/qq/confirm" element={<QqConfirmPage />} />
        <Route path="/qq-register" element={<QqRegisterPage />} />
        <Route path="/authorize" element={<OAuthAuthorizePage />} />
        <Route path="/device" element={<DeviceAuthorizationPage />} />
        <Route path="/oauth/device" element={<DeviceAuthorizationPage />} />
        <Route path="/apps" element={<PublicAppsPage />} />
        <Route path="/apps/:clientId" element={<PublicAppsPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/authorizations" element={<AuthorizationsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/developer" element={<DeveloperPage />} />
        <Route path="/developer/:id" element={<DeveloperPage />} />
        <Route path="/account-settings" element={<AccountSettingsPage />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<ErrorPage status={404} />} />
      </Routes>
    </BrowserRouter>
  );
}
