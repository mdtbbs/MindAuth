/** Shared TypeScript types for MindAuth API responses */

// ─── User ────────────────────────────────────────────────────────────────────

export type UserRole = 'user' | 'admin';

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  banner_url: string | null;
  email_verified: boolean;
  phone_masked: string | null;
  phone_verified: boolean;
  phone_verified_at: string | null;
  created_at: string;
}

/** GET /api/me returns user fields flattened onto the response object */
export type MeResponse = User & { success: boolean };

export interface UserProfile extends User {
  authorizations?: OAuthClient[];
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
}

/** POST /api/login returns only { success } — fetch the user via GET /api/me afterwards */
export interface LoginResponse {
  success: boolean;
  message?: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  email_code: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
}

export interface SendRegistrationCodeRequest {
  email: string;
}

export interface SendRegistrationCodeResponse {
  success: boolean;
  message: string;
  /** 6-digit code, only present in dev/test mode */
  code?: string;
}

// ─── OAuth / Clients ─────────────────────────────────────────────────────────

export interface OAuthClient {
  id: number;
  name: string;
  client_id: string;
  redirect_uri: string;
  description?: string;
  icon_url?: string;
  created_at: string;
}

export interface Authorization {
  id: number;
  client_id: string;
  client_name: string;
  scope: string;
  last_used_at: string | null;
  created_at: string;
}

// ─── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  id: number | string;
  session_type?: 'web' | 'native';
  client_id?: string;
  ip_address: string;
  device_info: string;
  last_active_at: string;
  created_at: string;
  is_current: boolean;
}

// ─── Notification ────────────────────────────────────────────────────────────

export type NotificationType =
  | 'info'
  | 'warning'
  | 'success'
  | 'error'
  | 'security';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface UnreadCount {
  count: number;
}

// ─── Login Log ───────────────────────────────────────────────────────────────

export interface LoginLog {
  id: number;
  ip: string;
  device: string;
  login_type: string;
  created_at: string;
}

// ─── Account ─────────────────────────────────────────────────────────────────

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

export interface ChangeUsernameRequest {
  new_username: string;
}

export interface ChangeEmailRequest {
  new_email: string;
  password: string;
}

// ─── QQ OAuth social login ───────────────────────────────────────────────────

export interface SocialBinding {
  id: number;
  provider: string;
  provider_user_id: string;
  nickname?: string | null;
  avatar_url?: string | null;
  created_at?: string;
  last_login_at?: string;
}

export interface SocialBindingsResponse {
  success: boolean;
  bindings: SocialBinding[];
}

export interface SocialUnbindResponse {
  success: boolean;
}

export interface QqRegistrationRequest {
  state: string;
  username: string;
  email: string;
  email_code: string;
  password: string;
}

export interface QqRegistrationResponse {
  success: boolean;
  redirect: string;
  message?: string;
}

// ─── Privacy Settings ────────────────────────────────────────────────────────

export interface PrivacySettings {
  profile_public: boolean;
  email_public: boolean;
  show_activity: boolean;
}

// ─── CSRF ────────────────────────────────────────────────────────────────────

export interface CsrfTokenResponse {
  success: boolean;
  csrf_token: string;
}

// ─── Password Reset ──────────────────────────────────────────────────────────

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  token: string;
  new_password: string;
}

// ─── Email Verification ──────────────────────────────────────────────────────

export interface EmailVerificationStatus {
  verified: boolean;
  email: string;
}

// ─── Generic API ─────────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
  details?: unknown;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// The normalized API error is the `ApiError` class exported from './client'
// (it extends Error so `err instanceof Error` narrows correctly in catch blocks).

// ─── Admin Types ─────────────────────────────────────────────────────────────

export type AdminRole = 'super_admin' | 'user_admin' | 'security_admin' | 'config_admin' | 'readonly_admin';

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: AdminRole;
  permissions: string[];
}

export interface AdminLoginResponse {
  success: boolean;
  user: AdminUser;
}

export interface AdminStatsData {
  users: {
    total: number;
    today: number;
    week: number;
    month: number;
    verified: number;
    active: number;
  };
  logins: {
    today: number;
    week: number;
    web: number;
    oauth: number;
  };
  oauth: {
    clients: number;
    authorizations: number;
  };
  trends: {
    userGrowth: Array<{ date: string; count: number }>;
    loginTrend: Array<{ date: string; count: number }>;
  };
}

export interface AdminUserListItem {
  id: number;
  username: string;
  email: string;
  email_verified: number | boolean;
  role: string;
  phone: string | null;
  phone_verified: number | boolean;
  ban_status: string;
  lock_level: number;
  created_at: string;
}

export interface AdminUserDetail {
  id: number;
  username: string;
  email: string;
  email_verified: number | boolean;
  role: string;
  avatar_url: string | null;
  banner_url: string | null;
  phone: string | null;
  phone_verified: number | boolean;
  ban_status: string;
  ban_reason: string | null;
  banned_by: number | null;
  ban_expires_at: string | null;
  lock_level: number;
  locked_until: string | null;
  created_at: string;
}

export interface AdminOAuthClient {
  id: number;
  name: string;
  client_id: string;
  redirect_uri: string;
  require_pkce?: boolean;
  description?: string;
  icon_url?: string;
  created_at: string;
}

export interface AdminCreatedClient {
  success: boolean;
  client_id: string;
  client_secret: string;
}

export interface IpBan {
  id: number;
  ip_address: string;
  cidr_prefix: number | null;
  reason: string | null;
  banned_by: number | null;
  created_at: string;
  expires_at: string | null;
}

export interface Challenge {
  id: number;
  question: string;
  enabled: number | boolean;
  created_at: string;
}

export interface UserField {
  id: number;
  field_key: string;
  field_label: string;
  field_type: string;
  is_required: number | boolean;
  is_public: number | boolean;
  options: string | null;
  sort_order: number;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  admin_id: number;
  action: string;
  target_type: string;
  target_id: number | null;
  details: string | null;
  ip_address: string;
  created_at: string;
}

export interface SmsAuditLogEntry {
  id: number;
  user_id: number;
  username: string;
  action: string;
  phone_masked: string;
  success: boolean;
  code: string | null;
  ip_address: string;
  user_agent: string | null;
  created_at: string;
}

export interface AdminLoginLogEntry {
  id: number;
  user_id: number;
  username: string;
  ip: string;
  device: string;
  login_type: string;
  created_at: string;
}

export interface EmailConfigData {
  host: string;
  port: number;
  user: string;
  from: string;
  secure: number | boolean;
  hasPassword: boolean;
  updated_at: string;
}

export interface SmsConfigData {
  enabled: number | boolean;
  access_key_id: string;
  sign_name: string;
  template_code: string;
  has_access_key_secret: boolean;
  updated_at: string;
}

export interface SystemConfigItem {
  key: string;
  value: string;
  description: string | null;
}

export interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
