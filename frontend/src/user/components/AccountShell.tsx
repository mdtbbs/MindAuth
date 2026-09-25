import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useToast } from '@/shared/ToastProvider';
import { LoadingState } from '@/shared/LoadingState';

type AccountNavItem = { label: string; href: string };
type AccountNavGroup = { label?: string; items: AccountNavItem[] };

const NAV_GROUPS: AccountNavGroup[] = [
  { items: [{ label: '概览', href: '/dashboard' }] },
  { label: '账户', items: [{ label: '个人资料', href: '/profile' }] },
  {
    label: '安全',
    items: [
      { label: '登录与安全', href: '/security' },
      { label: '登录设备', href: '/sessions' },
      { label: '登录记录', href: '/activity' },
    ],
  },
  { label: '应用', items: [{ label: '授权应用', href: '/authorizations' }] },
  { label: '消息', items: [{ label: '通知', href: '/notifications' }] },
  { label: '开发者', items: [{ label: '开发者', href: '/developer' }] },
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
  const { user, loading, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const wasMobileNavOpen = useRef(false);

  useEffect(() => {
    if (!loading && !user) {
      toast('warning', '请先登录');
      navigate('/login', { replace: true });
    }
  }, [loading, user, navigate, toast]);

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
      <nav className="account-nav" aria-label="账户导航">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div className="account-nav__group" key={group.label ?? `group-${groupIndex}`}>
            {group.label ? <div className="account-nav__heading">{group.label}</div> : null}
            {group.items.map((item) => (
              <Link
                key={item.href}
                className="account-nav__link"
                to={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                onClick={onNavigate}
              >
                {item.label}
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
            aria-label={mobileNavOpen ? '关闭导航' : '打开导航'}
            aria-expanded={mobileNavOpen}
            aria-controls="account-navigation-panel"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{mobileNavOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}</svg>
          </button>
          <Link to="/dashboard" className="account-brand" aria-label="MindAuth 概览">
            <span className="brand-mark__logo" aria-hidden="true">M</span>
            <span className="account-brand__name">MindAuth</span>
          </Link>
          <div className="account-header-actions">
            <a className="account-help-link" href="/docs.html">帮助</a>
            {user ? (
              <details className="account-user-menu">
                <summary aria-label={`用户菜单：${user.username}`}>
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
                  <Link to="/profile">个人资料</Link>
                  <Link to="/security">登录与安全</Link>
                  <a href="https://mdtbbs.cn/">返回 MDTBBS</a>
                  <button type="button" onClick={handleLogout}>退出登录</button>
                </div>
              </details>
            ) : <span className="account-user-menu__loading" aria-label="正在加载账户" />}
          </div>
        </div>
      </header>

      <div className="account-shell__layout">
        <aside className="account-shell__sidebar" aria-label="账户中心侧栏">
          <div className="account-sidebar__brand">
            <span>MindAuth</span>
            <small>Identity Center</small>
          </div>
          {renderNavigation()}
        </aside>

        <>
          {mobileNavOpen ? (
            <button
              type="button"
              className="account-mobile-nav__backdrop"
              aria-label="关闭导航"
              onClick={() => setMobileNavOpen(false)}
            />
          ) : null}
          <aside
              id="account-navigation-panel"
              ref={mobileNavRef}
              className="account-mobile-nav"
              aria-label="账户中心导航"
              role="dialog"
              aria-modal="true"
              hidden={!mobileNavOpen}
            >
              <div className="account-mobile-nav__header">
                <strong>账户中心</strong>
                <button type="button" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
              </div>
              {renderNavigation(() => setMobileNavOpen(false))}
          </aside>
        </>

        <main className="account-shell__main">
          <div className="account-page-heading">
            <div>
              <p className="account-page-heading__eyebrow">MindAuth Identity Center</p>
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
