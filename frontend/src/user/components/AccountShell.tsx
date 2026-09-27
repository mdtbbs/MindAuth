import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { LoadingState } from '@/shared/LoadingState';
import { LocaleSwitcher, useI18n } from '@/i18n/I18nProvider';

type AccountNavItem = { key: string; href: string };
type AccountNavGroup = { labelKey?: string; items: AccountNavItem[] };

const NAV_GROUPS: AccountNavGroup[] = [
  { items: [{ key: 'nav.dashboard', href: '/dashboard' }] },
  { labelKey: 'nav.account', items: [{ key: 'nav.profile', href: '/profile' }] },
  {
    labelKey: 'nav.securityGroup',
    items: [
      { key: 'nav.security', href: '/security' },
      { key: 'nav.sessions', href: '/sessions' },
      { key: 'nav.activity', href: '/activity' },
    ],
  },
  { labelKey: 'nav.apps', items: [{ key: 'nav.authorizations', href: '/authorizations' }] },
  { labelKey: 'nav.messagesGroup', items: [{ key: 'nav.notifications', href: '/notifications' }] },
  { labelKey: 'nav.developer', items: [{ key: 'nav.developerApps', href: '/developer' }] },
];

interface AccountShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'M';
}

export function AccountShell({ title, description, children }: AccountShellProps) {
  const { t } = useI18n();
  const { user, loading, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const ecosystem = searchParams.get('ecosystem') || '';
  const clientName = searchParams.get('client_name') || '';
  const isClub = ecosystem === 'mindustry-club' || /mindustry\s*club/i.test(clientName);
  const communityName = isClub ? 'Mindustry Club' : 'MindAuth';
  const communityUrl = isClub ? 'https://mindustry.club/' : 'https://mdtbbs.cn/';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const wasMobileNavOpen = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      toast('warning', t('shell.loginRequired'));
      navigate('/login', { replace: true });
    }
  }, [loading, user, navigate, toast, t]);

  useEffect(() => {
    if (!mobileNavOpen) {
      if (wasMobileNavOpen.current) menuToggleRef.current?.focus();
      wasMobileNavOpen.current = false;
      return;
    }

    wasMobileNavOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => mobileNavRef.current?.querySelector<HTMLElement>('button, a')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = mobileNavRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileNavOpen]);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function renderNavigation(onNavigate?: () => void) {
    return (
      <nav className="account-nav" aria-label={t('nav.account')}>
        {NAV_GROUPS.map((group, groupIndex) => (
          <div className="account-nav__group" key={group.labelKey ?? `group-${groupIndex}`}>
            {group.labelKey ? <div className="account-nav__heading">{t(group.labelKey)}</div> : null}
            {group.items.map((item) => (
              <Link
                key={item.href}
                className="account-nav__link"
                to={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                onClick={onNavigate}
              >
                {t(item.key)}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <div className="account-shell">
      <header className="account-shell__header">
        <div className="account-shell__header-inner">
          <button
            type="button"
            ref={menuToggleRef}
            className="account-menu-toggle"
            aria-label={mobileNavOpen ? t('shell.menuClose') : t('shell.menuOpen')}
            aria-expanded={mobileNavOpen}
            aria-controls="account-navigation-panel"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{mobileNavOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}</svg>
          </button>
          <Link to="/dashboard" className="account-brand" aria-label={t('shell.brandOverview')}>
            <img className="brand-mark__image" src="/account-logo.svg" alt="" aria-hidden="true" />
            <span className="account-brand__name">{communityName}</span>
            <span className="account-brand__divider" aria-hidden="true" />
            <span className="account-brand__section">{t('brand.account')}</span>
          </Link>
          <div className="account-header-actions">
            <LocaleSwitcher />
            <a className="account-help-link" href="/docs.html">{t('shell.help')}</a>
            {user ? (
              <details className="account-user-menu">
                <summary aria-label={t('shell.userMenu', { username: user.username })}>
                  <span className="account-user-menu__avatar" aria-hidden="true">
                    {user.avatar_url ? <img src={user.avatar_url} alt="" /> : getInitial(user.username)}
                  </span>
                  <span className="account-user-menu__name">{user.username}</span>
                  <span className="account-user-menu__chevron" aria-hidden="true">⌄</span>
                </summary>
                <div className="account-user-menu__panel">
                  <div className="account-user-menu__identity">
                    <strong>{user.username}</strong>
                    <span>{user.email}</span>
                  </div>
                  <Link to="/profile">{t('nav.profile')}</Link>
                  <Link to="/security">{t('nav.security')}</Link>
                  <a href={communityUrl}>{isClub ? t('shell.homeClub') : t('shell.home')}</a>
                  <button type="button" onClick={handleLogout}>{t('shell.logout')}</button>
                </div>
              </details>
            ) : <span className="account-user-menu__loading" aria-label={t('shell.loadingAccount')} />}
          </div>
        </div>
      </header>

      <div className="account-shell__layout">
        <aside className="account-shell__sidebar" aria-label={t('shell.sidebar')}>
          <div className="account-sidebar__brand">
            <span>{communityName}</span>
            <small>{t('brand.account')}</small>
          </div>
          {renderNavigation()}
        </aside>

        <>
          {mobileNavOpen ? (
            <button
              type="button"
              className="account-mobile-nav__backdrop"
              aria-label={t('shell.menuClose')}
              onClick={() => setMobileNavOpen(false)}
            />
          ) : null}
          <aside
              id="account-navigation-panel"
              ref={mobileNavRef}
              className="account-mobile-nav"
              aria-label={t('shell.navigation')}
              role="dialog"
              aria-modal="true"
              hidden={!mobileNavOpen}
            >
              <div className="account-mobile-nav__header">
                <strong>{t('shell.mobileTitle')}</strong>
                <button type="button" aria-label={t('shell.menuClose')} onClick={() => setMobileNavOpen(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
              </div>
              {renderNavigation(() => setMobileNavOpen(false))}
          </aside>
        </>

        <main className="account-shell__main">
          <div className="account-page-heading">
            <div>
              <p className="account-page-heading__eyebrow">{t('shell.eyebrow')}</p>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
          </div>
          <div className="account-page-content">
            {loading ? <LoadingState /> : user ? children : null}
          </div>
        </main>
      </div>
    </div>
  );
}
