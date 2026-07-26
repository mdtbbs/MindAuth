/**
 * Typed fetch wrapper for MindAuth API calls.
 *
 * CSRF handling:
 * 1. On first mutating request, fetch GET /api/csrf-token which sets the
 *    `csrf_token` cookie (httpOnly: false) and returns the token in JSON.
 * 2. Read the cookie value from document.cookie.
 * 3. Attach `X-CSRF-Token` header on POST/PUT/PATCH/DELETE requests.
 * 4. Cache the token in memory so we only fetch it once per session.
 */

import type { CsrfTokenResponse } from './types';

/**
 * Normalized API error. Extends Error so `err instanceof Error` in catch
 * blocks surfaces the server-provided message instead of a fallback string.
 */
export class ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, opts: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

// ─── CSRF token cache ────────────────────────────────────────────────────────

let cachedCsrfToken: string | null = null;

function readCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

async function ensureCsrfToken(): Promise<string> {
  // 1. Return cached token if available
  if (cachedCsrfToken) return cachedCsrfToken;

  // 2. Try reading from existing cookie (set by server on page load)
  const fromCookie = readCookie('csrf_token');
  if (fromCookie) {
    cachedCsrfToken = fromCookie;
    return fromCookie;
  }

  // 3. Fetch fresh token from server endpoint
  const res = await fetch('/api/csrf-token', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new ApiError('Failed to fetch CSRF token', { status: res.status });
  }

  const data = (await res.json()) as CsrfTokenResponse;
  cachedCsrfToken = data.csrf_token;
  return data.csrf_token;
}

/** Clear cached CSRF token (useful after logout) */
export function clearCsrfCache(): void {
  cachedCsrfToken = null;
}

// ─── Error normalization ─────────────────────────────────────────────────────

async function normalizeError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> | undefined;
  try {
    body = await res.json() as Record<string, unknown>;
  } catch {
    // response body is not JSON
  }

  const message =
    (body?.message as string) ||
    (body?.error as string) ||
    `Request failed with status ${res.status}`;

  return new ApiError(message, {
    status: res.status,
    code: body?.code ? (body.code as string) : undefined,
    details: body?.details,
  });
}

// ─── 401 handler ─────────────────────────────────────────────────────────────

let onUnauthorized: (() => void) | null = null;

/**
 * Register a callback that fires on 401 responses.
 * Typically used to redirect to login.
 */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function handle401(res: Response): void {
  if (res.status === 401 && onUnauthorized) {
    onUnauthorized();
  }
}

// ─── Core request function ───────────────────────────────────────────────────

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RequestOptions {
  /** AbortSignal for cancellation — pass one so stale in-flight responses can
   *  be dropped (prevents race conditions when inputs change rapidly). */
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // Attach CSRF token for mutating requests
  if (MUTATING_METHODS.has(method.toUpperCase())) {
    const token = await ensureCsrfToken();
    headers['X-CSRF-Token'] = token;
  }

  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });

  handle401(res);

  if (!res.ok) {
    throw await normalizeError(res);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}

// ─── Exported typed helpers ──────────────────────────────────────────────────

export const api = {
  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, opts);
  },

  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('POST', path, body, opts);
  },

  /** POST multipart form data (file uploads). Attaches the CSRF header like other mutating requests. */
  async postForm<T>(path: string, formData: FormData): Promise<T> {
    const token = await ensureCsrfToken();
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: formData,
    });

    handle401(res);
    if (!res.ok) throw await normalizeError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PUT', path, body);
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', path, body);
  },

  del<T>(path: string): Promise<T> {
    return request<T>('DELETE', path);
  },
};

export default api;
