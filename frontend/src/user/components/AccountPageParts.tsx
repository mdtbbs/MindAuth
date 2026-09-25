import type { ReactNode } from 'react';
import { Button } from '@/shared/Button';
import { SkeletonText } from '@/shared/Skeleton';

export function AccountSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="account-section" aria-labelledby={id}>
      <div className="account-section__heading">
        <div>
          <h2 id={id}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="account-section__action">{action}</div> : null}
      </div>
      <div className="account-section__body">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-row ${className}`.trim()}>
      <div className="settings-row__copy">
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="settings-row__content">{children}</div>
    </div>
  );
}

export function AccountEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="account-empty-state">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.75h14v12.5H5zM8 9h8M8 12h8M8 15h5" /></svg>
      <span>{children}</span>
    </div>
  );
}

export function AccountLoadState({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error: Error | null;
  retry: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return <div className="account-load-state" role="status" aria-label="加载中"><SkeletonText lines={2} /></div>;
  }
  if (error) {
    return (
      <div className="account-error-state" role="alert">
        <span>加载失败，请检查连接后重试。</span>
        <Button type="button" variant="secondary" size="sm" onClick={retry}>重试</Button>
      </div>
    );
  }
  return <>{children}</>;
}

export function StatusLabel({ children, needsAction = false }: { children: ReactNode; needsAction?: boolean }) {
  return <span className={`account-status${needsAction ? ' account-status--attention' : ''}`}>{children}</span>;
}

export function formatAccountDate(value?: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', withTime
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function parseUserAgent(value?: string | null) {
  if (!value) return '客户端信息未提供';
  const browser = /Edg\//.test(value) ? 'Edge'
    : /Firefox\//.test(value) ? 'Firefox'
      : /Chrome\//.test(value) && !/Edg\//.test(value) ? 'Chrome'
        : /Safari\//.test(value) && !/Chrome\//.test(value) ? 'Safari'
          : null;
  const platform = /Android/i.test(value) ? 'Android'
    : /iPhone|iPad|iPod/i.test(value) ? 'iOS'
      : /Windows NT/i.test(value) ? 'Windows'
        : /Mac OS X/i.test(value) ? 'macOS'
          : /Linux/i.test(value) ? 'Linux'
            : null;
  if (browser && platform) return `${browser} · ${platform}`;
  if (browser || platform) return browser || platform || '客户端信息未提供';
  return value.length > 96 ? `${value.slice(0, 93)}…` : value;
}
