import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@/api/types';

interface AccountNavItem {
  key: string;
  label: string;
  href?: string;
}

interface AccountShellProps {
  user: User;
  title: string;
  description: string;
  navItems: AccountNavItem[];
  activeNavKey: string;
  headerActions?: ReactNode;
  heroActions?: ReactNode;
  children: ReactNode;
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'M';
}

export function AccountShell({
  user,
  title,
  description,
  navItems,
  activeNavKey,
  headerActions,
  heroActions,
  children,
}: AccountShellProps) {
  return (
    <div className="account-shell">
      <header className="account-shell__header">
        <div className="account-shell__header-inner">
          <Link to="/dashboard" className="brand-mark">
            <span className="brand-mark__logo">M</span>
            <span>
              MindAuth
              <span className="brand-mark__sub"> / 账户中心</span>
            </span>
          </Link>
          <div className="cluster cluster--end">{headerActions}</div>
        </div>
      </header>

      <main className="account-shell__main">
        <div className="account-shell__layout">
          <aside className="account-shell__sidebar">
            <div className="card card--padding-md account-sidebar">
              <div className="account-sidebar__profile">
                <div className="account-sidebar__avatar" aria-hidden="true">
                  {user.avatar_url ? <img src={user.avatar_url} alt="" /> : getInitial(user.username)}
                </div>
                <div>
                  <div className="account-sidebar__name">{user.username}</div>
                  <div className="account-sidebar__meta text-truncate">{user.email}</div>
                </div>
                <span className={`status-badge ${user.email_verified ? 'status-badge--success' : 'status-badge--warning'}`}>
                  {user.email_verified ? '邮箱已验证' : '邮箱待验证'}
                </span>
              </div>

              <nav className="account-sidebar__nav" aria-label="账户中心导航">
                {navItems.map((item) => {
                  const className = `account-sidebar__link ${item.key === activeNavKey ? 'account-sidebar__link--active' : ''}`.trim();
                  if (item.href) {
                    return (
                      <Link key={item.key} to={item.href} className={className}>
                        {item.label}
                      </Link>
                    );
                  }
                  return (
                    <span key={item.key} className={className}>
                      {item.label}
                    </span>
                  );
                })}
              </nav>
            </div>
          </aside>

          <section className="account-content">
            <div className="account-page__hero">
              <div className="account-page__hero-main">
                <h1 className="account-page__hero-title">{title}</h1>
                <p className="account-page__hero-text">{description}</p>
              </div>
              {heroActions ? <div className="account-page__hero-actions">{heroActions}</div> : null}
            </div>
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}
