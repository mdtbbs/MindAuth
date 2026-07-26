import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/client';

interface AuthShellProps {
  title: string;
  description: string;
  footer?: ReactNode;
  children: ReactNode;
}

interface AuthPageConfigResponse {
  success: boolean;
  background_url: string | null;
}

// 背景配置整个 SPA 生命周期只拉一次（登录/注册间跳转不重复请求）
let backgroundPromise: Promise<string | null> | null = null;

function fetchBackgroundUrl(): Promise<string | null> {
  if (!backgroundPromise) {
    backgroundPromise = api
      .get<AuthPageConfigResponse>('/api/public/auth-page-config')
      .then((res) => res.background_url || null)
      .catch(() => null); // 失败静默回退默认网格背景
  }
  return backgroundPromise;
}

export function AuthShell({ title, description, footer, children }: AuthShellProps) {
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBackgroundUrl().then((url) => {
      if (!cancelled) setBackgroundUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const shellClass = backgroundUrl ? 'page--auth auth-shell auth-shell--custom-bg' : 'page--auth auth-shell';
  const shellStyle = backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined;

  return (
    <div className={shellClass} style={shellStyle}>
      <header className="auth-shell__header">
        <div className="auth-shell__header-inner">
          <Link to="/login" className="brand-mark">
            <span className="brand-mark__logo">M</span>
            <span>
              MindAuth
              <span className="brand-mark__sub"> / 账号中心</span>
            </span>
          </Link>
          <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
            Secure Access Platform
          </span>
        </div>
      </header>

      <main className="auth-shell__main">
        <div className="auth-shell__content">
          <section className="auth-shell__panel" aria-label={title}>
            <div className="card">
              <div className="auth-panel__header">
                <h2 className="auth-panel__title">{title}</h2>
                <p className="auth-panel__description">{description}</p>
              </div>
              <div className="auth-panel__form">{children}</div>
              {footer ? <div className="auth-panel__footer">{footer}</div> : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
