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
  phone: string | null;
  phone_verified: boolean;
  muted: boolean;
  banned: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile extends User {
  authorizations?: OAuthClient[];
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  user: User;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  user: User;
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
  id: number;
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
  login_type: 'web' | 'oauth';
  created_at: string;
}

// ─── Account ─────────────────────────────────────────────────────────────────

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface ChangeEmailRequest {
  new_email: string;
  password: string;
}

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
  password: string;
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

/** Normalized error shape used by the API client */
export interface ApiError {
  code?: string;
  message: string;
  details?: unknown;
  status?: number;
}
