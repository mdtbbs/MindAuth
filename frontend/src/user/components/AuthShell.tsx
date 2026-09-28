import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/client';
import { LegalFooter } from '@/user/components/LegalFooter';
import { useSearchParams } from 'react-router-dom';
import { LocaleSwitcher, useI18n } from '@/i18n/I18nProvider';

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
  const [params] = useSearchParams();
  const { t } = useI18n();
  const ecosystem = params.get('ecosystem') || '';
  const clientName = params.get('client_name') || '';
  const isClub = ecosystem === 'mindustry-club' || /mindustry\s*club/i.test(clientName);
  const brandName = isClub ? 'Mindustry Club' : clientName || 'MDTBBS';
  const backHref = isClub ? 'https://mindustry.club/' : 'https://mdtbbs.cn/';

  useEffect(() => {
    let cancelled = false;
    fetchBackgroundUrl().then((url) => {
      if (!cancelled) setBackgroundUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="auth-shell">
      <header className="auth-shell__header">
        <div className="auth-shell__header-inner">
          <Link to="/login" className="auth-brand" aria-label={`${brandName} ${t('brand.account')}`}>
            <img className="brand-mark__image" src="/account-logo.svg" alt="" aria-hidden="true" />
            <span className="auth-brand__name">{brandName}</span>
            <span className="auth-brand__divider" aria-hidden="true" />
            <span className="auth-brand__section">{t('brand.account')}</span>
          </Link>
          <div className="cluster"><LocaleSwitcher /><a className="auth-shell__back" href={backHref}>{t('brand.back')}</a></div>
        </div>
      </header>

      <div className="auth-shell__notice" role="note">
        <span className="auth-shell__notice-icon" aria-hidden="true">i</span>
        <span>{isClub && clientName ? t('auth.continue', { client: clientName }) : t('brand.powered')}</span>
      </div>

      <main className="auth-shell__main">
        <div className="auth-shell__content">
          <section className="auth-shell__panel" aria-label={title}>
            <div className="card">
              {footer ? <div className="auth-panel__footer">{footer}</div> : null}
              <div className="auth-panel__header">
                <h2 className="auth-panel__title">{title}</h2>
                <p className="auth-panel__description">{description}</p>
              </div>
              <div className="auth-panel__form">{children}</div>
            </div>
          </section>

          {isClub ? <aside className="auth-shell__promo auth-shell__promo--club"><div className="auth-promo__copy"><p className="auth-promo__eyebrow">Mindustry Club</p><h1>{t('auth.continue', { client: 'Mindustry Club' })}</h1><p className="auth-promo__description">Powered by MindAuth</p></div></aside> : <aside className={`auth-shell__promo${backgroundUrl ? ' auth-shell__promo--custom-bg' : ''}`}>
            {backgroundUrl ? <span className="auth-shell__promo-background" style={{ backgroundImage: `url(${backgroundUrl})` }} aria-hidden="true" /> : null}
            <div className="auth-promo__copy">
              <p className="auth-promo__eyebrow">MDTBBS</p>
              <h1>{t('brand.tagline')}</h1>
              <p className="auth-promo__description">{t('brand.description')}</p>
              <a className="auth-promo__link" href="https://mdtbbs.cn/">{t('brand.visit')} <span aria-hidden="true">→</span></a>
            </div>
            <svg className="auth-promo__art" viewBox="0 0 560 300" role="img" aria-label={t('brand.artAlt')}>
              <path d="M30 236 225 126l301 174-196 0Z" fill="#d6e8ff" />
              <path d="m87 236 138-80 190 110-140 0Z" fill="#9fc7fb" />
              <path d="m144 236 81-47 109 63-82 0Z" fill="#5b9bea" />
              <path d="m87 177 62-36 65 38-62 37Z" fill="#fff" stroke="#90baf0" strokeWidth="2" />
              <path d="m149 141 62 37v58l-62-37Z" fill="#dcecff" stroke="#90baf0" strokeWidth="2" />
              <path d="m87 177 62 37v58l-62-36Z" fill="#b6d5fc" stroke="#90baf0" strokeWidth="2" />
              <path d="m250 119 57-33 60 35-58 34Z" fill="#fff" stroke="#90baf0" strokeWidth="2" />
              <path d="m307 86 60 35v54l-60-35Z" fill="#dcecff" stroke="#90baf0" strokeWidth="2" />
              <path d="m250 119 57 34v54l-57-34Z" fill="#b6d5fc" stroke="#90baf0" strokeWidth="2" />
              <path d="m378 189 35-20 39 22-35 21Z" fill="#fff" stroke="#90baf0" strokeWidth="2" />
              <path d="m413 169 39 22v38l-39-22Z" fill="#dcecff" stroke="#90baf0" strokeWidth="2" />
              <path d="m378 189 35 21v38l-35-21Z" fill="#b6d5fc" stroke="#90baf0" strokeWidth="2" />
              <path d="m40 250 185-106m-139 125 189-108m-142 127 189-109" fill="none" stroke="#fff" strokeWidth="3" opacity=".8" />
            </svg>
          </aside>}
        </div>
      </main>
      <LegalFooter className="auth-shell__footer" ecosystem={isClub ? 'mindustry-club' : 'mdtbbs'} />
    </div>
  );
}
