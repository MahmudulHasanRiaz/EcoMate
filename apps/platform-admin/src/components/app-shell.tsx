import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuth } from '../auth';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/tenants', label: 'Tenants' },
  { to: '/plans', label: 'Plans' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  if (!session) return <Navigate to="/login" />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden />
          <span>
            <strong>EcoMate</strong>
            <small>SaaS console</small>
          </span>
        </Link>
        <nav className="nav" aria-label="SaaS navigation">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === '/' }}
              className="nav-link"
              activeProps={{ className: 'nav-link nav-link--active' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar" aria-hidden>
            {session.user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="identity">
            <strong>{session.user.name}</strong>
            <small>{session.user.role}</small>
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              logout();
              void navigate({ to: '/login' });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
