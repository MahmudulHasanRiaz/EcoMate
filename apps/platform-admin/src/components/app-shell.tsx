import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth';
import { useBranding } from '../lib/branding';
import {
  applyTheme,
  nextThemeChoice,
  resolveThemeChoice,
  themeChoiceLabel,
  type ThemeChoice,
} from '../lib/theme';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/tenants', label: 'Tenants' },
  { to: '/leads', label: 'Leads' },
  { to: '/billing', label: 'Billing' },
  { to: '/domains', label: 'Domains' },
  { to: '/usage', label: 'Usage' },
  { to: '/metrics', label: 'Metrics' },
  { to: '/plans', label: 'Plans' },
  { to: '/landing', label: 'Landing' },
  { to: '/settings', label: 'Settings' },
  { to: '/users', label: 'Users' },
  { to: '/audit', label: 'Audit' },
] as const;

function BrandMark() {
  const { platformName, logoUrl } = useBranding();
  if (logoUrl) {
    return (
      <img
        className="brand-logo-img"
        src={logoUrl}
        alt={`${platformName} logo`}
      />
    );
  }
  // Lettermark fallback (D2): the platform initial, never a bare square.
  return (
    <span className="brand-mark" aria-hidden>
      {platformName.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const { platformName } = useBranding();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() =>
    resolveThemeChoice(),
  );

  if (!session) return <Navigate to="/login" />;

  const toggleTheme = () => {
    const next = nextThemeChoice(themeChoice);
    setThemeChoice(next);
    applyTheme(next);
  };

  return (
    <div className="shell" data-nav-open={navOpen ? 'true' : 'false'}>
      <div className="topbar">
        <button
          type="button"
          className="hamburger"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          ☰
        </button>
        <Link to="/" className="brand" onClick={() => setNavOpen(false)}>
          <BrandMark />
          <span>
            <strong>{platformName}</strong>
            <small>SaaS console</small>
          </span>
        </Link>
      </div>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      />
      <aside className="sidebar">
        <Link to="/" className="brand" onClick={() => setNavOpen(false)}>
          <BrandMark />
          <span>
            <strong>{platformName}</strong>
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
              onClick={() => setNavOpen(false)}
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
          <Link
            to="/account"
            className="link-button"
            onClick={() => setNavOpen(false)}
          >
            Account
          </Link>
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
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Theme: ${themeChoiceLabel(themeChoice)}. Switch theme.`}
          >
            ◐ Theme: {themeChoiceLabel(themeChoice)}
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
