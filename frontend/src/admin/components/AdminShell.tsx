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

  return (
    <div className="layout--sidebar">
      <aside className="sidebar">
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
            MindAuth Admin
          </h2>
          {admin && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>
              {admin.username} ({admin.role})
            </p>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="btn btn--secondary"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{ display: 'none', width: '100%', marginBottom: 'var(--space-3)' }}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? '隐藏菜单' : '显示菜单'}
        </button>

        <nav className={mobileMenuOpen ? 'sidebar__nav--open' : ''}>
          <div className="stack stack--sm">
            {filteredNavItems.map((item) => (
              <button
                key={item.id}
                className={`sidebar__item ${currentPage === item.id ? 'sidebar__item--active' : ''}`}
                onClick={() => handleNavigate(item.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: 'var(--space-2) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: currentPage === item.id ? 'var(--color-primary-bg)' : 'transparent',
                  color: currentPage === item.id ? 'var(--color-primary)' : 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: currentPage === item.id ? 'var(--weight-semibold)' : 'var(--weight-normal)',
                }}
              >
                <span style={{ marginRight: 'var(--space-2)' }}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
          <Button variant="ghost" size="sm" fullWidth onClick={handleLogout}>
            退出登录
          </Button>
        </div>
      </aside>

      <main className="content">
        {children}
      </main>
    </div>
  );
}
