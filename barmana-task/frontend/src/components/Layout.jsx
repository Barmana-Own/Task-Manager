import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDuration, RoleLabel } from './UI.jsx';
import NotificationCenter from './NotificationCenter.jsx';
import BrandLogo from './BrandLogo.jsx';

const adminNav = [
  ['/', 'داشبورد', '◫'], ['/users', 'کاربران', '♙'], ['/projects', 'پروژه‌ها', '▣'],
  ['/tasks', 'تسک‌ها', '✓'], ['/time-logs', 'ریز زمان‌ها', '◷'], ['/reports', 'گزارش‌ها', '▤'],
  ['/activities', 'رویدادها', '⌁'], ['/profile', 'حساب کاربری', '⚙'],
];

const workspaceNavByRole = {
  project_manager: [
    ['/', 'خانه', '⌂'], ['/projects', 'پروژه‌های من', '▣'], ['/tasks', 'تسک‌ها', '✓'],
    ['/reviews', 'بازبینی‌ها', '◎'], ['/time-logs', 'زمان پروژه‌ها', '◷'], ['/reports', 'گزارش‌ها', '▤'],
    ['/profile', 'پنل کاربری', '♙'],
  ],
  developer: [
    ['/', 'امروز', '⌂'], ['/projects', 'پروژه‌های من', '▣'], ['/tasks', 'تسک‌های من', '✓'],
    ['/time-logs', 'زمان‌های من', '◷'], ['/reports', 'گزارش روزانه', '▤'], ['/profile', 'پنل کاربری', '♙'],
  ],
};

function useActiveTimer(user) {
  const [activeTimer, setActiveTimer] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!['developer', 'project_manager'].includes(user.role)) {
      setActiveTimer(null);
      setElapsed(0);
      return undefined;
    }

    const load = () => api.get('/timers/active').then(({ data }) => {
      const timer = data.timers[0] || null;
      setActiveTimer(timer);
      setElapsed(timer?.live_seconds || 0);
    }).catch(() => {});

    load();
    const refresh = setInterval(load, 30000);
    return () => clearInterval(refresh);
  }, [user.role]);

  useEffect(() => {
    if (!activeTimer) return undefined;
    const interval = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  return { activeTimer, setActiveTimer, elapsed };
}

function AdminLayout({ user, logout, timerState }) {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="app-shell">
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand"><BrandLogo compact light subtitle="مدیریت تیم فنی" /></div>
        <nav className="main-nav">
          {adminNav.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)}>
              <span className="nav-icon">{icon}</span><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-profile">
          <div className="avatar">{user.full_name?.slice(0, 1)}</div>
          <div><strong>{user.full_name}</strong><span><RoleLabel role={user.role} /></span></div>
          <button type="button" onClick={handleLogout} title="خروج">↪</button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)}>☰</button>
          <div className="topbar-title"><strong>بارمانا تسک</strong><span>مرکز کنترل عملیات فنی</span></div>
          <NotificationCenter />
          {timerState.activeTimer && <div className="active-timer-chip"><span className="pulse" /><div><small>{timerState.activeTimer.task_title}</small><strong dir="ltr">{formatDuration(timerState.elapsed)}</strong></div></div>}
        </header>
        <section className="page-content"><Outlet context={timerState} /></section>
      </main>
    </div>
  );
}

function WorkspaceLayout({ user, logout, timerState }) {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = workspaceNavByRole[user.role] || [];
  const isManager = user.role === 'project_manager';
  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className={`workspace-shell ${isManager ? 'manager-workspace' : 'developer-workspace'}`}>
      <header className="workspace-header">
        <div className="workspace-header-main">
          <Link to="/" className="workspace-brand" onClick={() => setMobileOpen(false)}><BrandLogo compact subtitle={isManager ? 'فضای مدیریت پروژه' : 'فضای کاری برنامه‌نویس'} /></Link>

          <div className="workspace-header-actions">
            {timerState.activeTimer && (
              <Link to={`/tasks?project=${timerState.activeTimer.project_id || ''}&task=${timerState.activeTimer.task_id}`} className="workspace-live-timer">
                <span className="pulse" />
                <div><small>{timerState.activeTimer.task_title}</small><strong dir="ltr">{formatDuration(timerState.elapsed)}</strong></div>
              </Link>
            )}
            <NotificationCenter />
            <Link to="/profile" className="workspace-user-chip">
              <div className="avatar small">{user.full_name?.slice(0, 1)}</div>
              <div><strong>{user.full_name}</strong><span><RoleLabel role={user.role} /></span></div>
            </Link>
            <button className="workspace-logout" type="button" onClick={handleLogout} title="خروج از حساب">↪</button>
            <button className="workspace-menu-button" type="button" onClick={() => setMobileOpen((value) => !value)} aria-label="نمایش منو">☰</button>
          </div>
        </div>

        <nav className={`workspace-nav ${mobileOpen ? 'is-open' : ''}`}>
          <div className="workspace-nav-inner">
            {navItems.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)}>
                <span>{icon}</span><strong>{label}</strong>
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="workspace-main">
        <section className="workspace-page-content"><Outlet context={timerState} /></section>
      </main>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const timerState = useActiveTimer(user);

  if (user.role === 'admin') {
    return <AdminLayout user={user} logout={logout} timerState={timerState} />;
  }

  return <WorkspaceLayout user={user} logout={logout} timerState={timerState} />;
}
