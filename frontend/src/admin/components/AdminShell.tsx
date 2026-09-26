import { type ReactNode, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAdminAuth } from '../AdminAuthProvider';
import { Button } from '@/shared/Button';

interface AdminShellProps { children: ReactNode }
interface NavItem { id: string; label: string; permission: string; icon: string }
interface NavGroup { label: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  { label: '概览', items: [{ id: 'dashboard', label: '总览', permission: 'dashboard.read', icon: 'grid' }] },
  { label: '账号', items: [
    { id: 'users', label: '用户', permission: 'users.read', icon: 'users' },
    { id: 'admins', label: '管理员', permission: 'admins.read', icon: 'shield' },
    { id: 'sessions', label: '会话与授权', permission: 'sessions.read', icon: 'devices' },
  ] },
  { label: '安全', items: [
    { id: 'risk', label: '风控中心', permission: 'security.read', icon: 'activity' },
    { id: 'email-policy', label: '邮箱策略', permission: 'email_rules.read', icon: 'mail' },
    { id: 'ip-rules', label: 'IP 规则', permission: 'ip_bans.read', icon: 'network' },
  ] },
  { label: '开放平台', items: [
    { id: 'applications', label: '应用申请', permission: 'developers.read', icon: 'inbox' },
    { id: 'clients', label: 'OAuth 应用', permission: 'clients.read', icon: 'key' },
  ] },
  { label: '系统', items: [
    { id: 'messaging', label: '邮件与短信', permission: 'email_config.read', icon: 'send' },
    { id: 'registration', label: '注册与认证', permission: 'config.read', icon: 'sliders' },
    { id: 'user-fields', label: '用户资料字段', permission: 'config.read', icon: 'list' },
    { id: 'appearance', label: '登录页外观', permission: 'config.read', icon: 'image' },
  ] },
  { label: '记录', items: [
    { id: 'login-logs', label: '登录记录', permission: 'login_logs.read', icon: 'clock' },
    { id: 'admin-logs', label: '管理日志', permission: 'audit_logs.read', icon: 'file' },
    { id: 'sms-logs', label: '短信记录', permission: 'sms_audit.read', icon: 'message' },
  ] },
];

const ICON_PATHS: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
  devices: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /><rect x="16" y="8" width="5" height="10" rx="1" /></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  network: <><circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.48m-8.48 0a6 6 0 0 1 0-8.48M19.07 4.93a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" /></>,
  inbox: <><path d="M4 4h16l1 11h-6l-2 3h-2l-2-3H3L4 4Z" /><path d="M3 15h5m8 0h5" /></>,
  key: <><circle cx="8" cy="15" r="5" /><path d="m21 2-9.6 9.6M15.5 7.5l3 3L21 8l-3-3" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  sliders: <><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3" /><path d="M2 14h4m4-6h4m4 8h4" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8m-8 4h8" /></>,
  message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></>,
};

function Icon({ name }: { name: string }) {
  return <svg aria-hidden="true" className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS[name]}</svg>;
}

export function AdminShell({ children }: AdminShellProps) {
  const { admin, logout, hasPermission } = useAdminAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const groups = useMemo(() => GROUPS.map(group => ({ ...group, items: group.items.filter(item => hasPermission(item.permission)) })).filter(group => group.items.length), [hasPermission]);

  async function handleLogout() { await logout(); }

  return (
    <div className="admin-shell">
      {mobileMenuOpen && <button className="admin-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`admin-sidebar${mobileMenuOpen ? ' is-open' : ''}`} aria-label="管理后台侧栏">
        <div className="admin-sidebar__brand"><span className="admin-brand-mark">M</span><span><strong>MindAuth</strong><small>管理后台</small></span></div>
        <nav id="admin-nav" className="admin-sidebar__nav" aria-label="管理导航">
          {groups.map(group => <section className="admin-nav-group" key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map(item => <NavLink key={item.id} to={item.id === 'dashboard' ? '/' : `/${item.id}`} end={item.id === 'dashboard'} className={({ isActive }) => `admin-sidebar__item${isActive ? ' is-active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </NavLink>)}
          </section>)}
        </nav>
        <div className="admin-sidebar__footer">
          <div className="admin-profile"><span className="admin-profile__avatar">{admin?.username?.slice(0, 1).toUpperCase() || 'A'}</span><span className="admin-profile__meta"><strong>{admin?.username}</strong><small>{admin?.role}</small></span></div>
          <Button variant="ghost" size="sm" fullWidth onClick={handleLogout}>退出登录</Button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-mobile-header"><button type="button" className="admin-menu-button" onClick={() => setMobileMenuOpen(true)} aria-expanded={mobileMenuOpen} aria-controls="admin-nav"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg><span>菜单</span></button><span>MindAuth 管理</span></header>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
