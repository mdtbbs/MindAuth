import { type ReactNode, useState } from 'react';
import { useAdminAuth } from '../AdminAuthProvider';
import { Button } from '@/shared/Button';

interface AdminShellProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: string;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: '仪表盘', icon: '📊' },
  { id: 'users', label: '用户管理', icon: '👥', permission: 'users.read' },
  { id: 'clients', label: 'OAuth 客户端', icon: '🔗', permission: 'clients.read' },
  { id: 'security', label: '安全设置', icon: '🔒', permission: 'ip_bans.read' },
  { id: 'settings', label: '系统配置', icon: '⚙️', permission: 'config.read' },
  { id: 'logs', label: '日志查看', icon: '📝', permission: 'audit_logs.read' },
];

export function AdminShell({ children, currentPage, onNavigate }: AdminShellProps) {
  const { admin, logout, hasPermission } = useAdminAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const filteredNavItems = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(item.permission),
  );

  async function handleLogout() {
    await logout();
  }

  function handleNavigate(page: string) {
    onNavigate(page);
    setMobileMenuOpen(false);
  }

  const openClass = mobileMenuOpen ? ' is-open' : '';

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand">
          <span className="admin-sidebar__brand-title">MindAuth Admin</span>
          {admin && (
            <span className="admin-sidebar__brand-meta">
              {admin.username}（{admin.role}）
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn btn--secondary admin-sidebar__toggle"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-expanded={mobileMenuOpen}
          aria-controls="admin-nav"
        >
          {mobileMenuOpen ? '隐藏菜单' : '显示菜单'}
        </button>

        <nav id="admin-nav" className={`admin-sidebar__nav${openClass}`} aria-label="管理导航">
          {filteredNavItems.map((item) => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className="admin-sidebar__item"
                aria-current={active ? 'page' : undefined}
                onClick={() => handleNavigate(item.id)}
              >
                <span className="admin-sidebar__item-icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className={`admin-sidebar__footer${openClass}`}>
          <Button variant="ghost" size="sm" fullWidth onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </aside>

      <main className="admin-content">{children}</main>
    </div>
  );
}
