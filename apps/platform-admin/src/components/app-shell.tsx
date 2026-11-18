import { Link, Navigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Building,
  ChartColumn,
  CreditCard,
  Gauge,
  Globe,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  ScrollText,
  Search as SearchIcon,
  Settings as SettingsIcon,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { useBranding } from '../lib/branding';
import { readNavCollapsed, writeNavCollapsed } from '../lib/nav-collapse';
import { AccountMenu } from './account-menu';
import { SearchPalette } from './search-palette';

/* Nav icons (lucide-react 1.x: Building / ChartColumn are the current
 * names — Building2 / BarChart3 were removed as deprecated aliases). */
const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/tenants', label: 'Tenants', icon: Building },
  { to: '/leads', label: 'Leads', icon: UserPlus },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/domains', label: 'Domains', icon: Globe },
  { to: '/usage', label: 'Usage', icon: Gauge },
  { to: '/metrics', label: 'Metrics', icon: ChartColumn },
  { to: '/plans', label: 'Plans', icon: Layers },
  { to: '/landing', label: 'Landing', icon: LayoutTemplate },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/audit', label: 'Audit', icon: ScrollText },
];

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

/* StackMate collapse/expand icons, verbatim paths (panel + arrow). */
function SidebarExpandIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="12" y1="12" x2="17" y2="12" />
      <polyline points="14,9 17,12 14,15" />
    </svg>
  );
}

function SidebarCollapseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="12" y1="12" x2="17" y2="12" />
      <polyline points="15,9 12,12 15,15" />
    </svg>
  );
}

/**
 * Console shell (StackMate Neon layout, EcoMate blue accent).
 *
 * - Topbar (48px, sticky, all widths): mobile hamburger + brand (mobile
 *   only), the global search button (desktop, centered), and the account
 *   menu at the right end. The account widget moved here from the sidebar
 *   bottom — it is no longer in the sidebar at all.
 * - Sidebar: brand, nav (icon + label), and the collapse/extend toggle
 *   in the bottom corner — the spot the account widget vacated. Collapsing
 *   turns the sidebar into a 64px icon rail (desktop only; mobile keeps
 *   the drawer). The state persists in localStorage.
 * - secondaryNav: an optional second nav column beside the content (used
 *   by Settings). Entering a page with a secondary nav collapses the main
 *   menu VISUALLY ONLY — the stored pin is untouched, so leaving restores
 *   it. Only an explicit toggle press persists (StackMate pin rule).
 */
export function AppShell({
  children,
  secondaryNav,
}: {
  children: ReactNode;
  secondaryNav?: ReactNode;
}) {
  const { session } = useAuth();
  const { platformName } = useBranding();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() =>
    secondaryNav ? true : readNavCollapsed(),
  );

  // Cmd/Ctrl+K opens the search palette from anywhere in the console.
  // Skipped while typing in a text field, so it never hijacks input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k'
      ) {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!session) return <Navigate to="/login" />;

  const toggleCollapsed = () => {
    setNavCollapsed((current) => {
      const next = !current;
      writeNavCollapsed(next);
      return next;
    });
  };

  return (
    <div
      className="shell"
      data-nav-open={navOpen ? 'true' : 'false'}
      data-nav-collapsed={navCollapsed ? 'true' : 'false'}
    >
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      />
      <aside className="sidebar">
        <Link to="/" className="brand" onClick={() => setNavOpen(false)}>
          <BrandMark />
          <span className="brand-name">
            <strong>{platformName}</strong>
            <small>SaaS console</small>
          </span>
        </Link>
        <nav className="nav" aria-label="SaaS navigation">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === '/' }}
                className="nav-link"
                activeProps={{ className: 'nav-link nav-link--active' }}
                title={item.label}
                onClick={() => setNavOpen(false)}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                <span className="nav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          className="nav-collapse-btn"
          aria-label={navCollapsed ? 'Expand menu' : 'Collapse menu'}
          aria-expanded={!navCollapsed}
          onClick={toggleCollapsed}
        >
          {navCollapsed ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
          <span className="nav-label">
            {navCollapsed ? 'Expand menu' : 'Collapse menu'}
          </span>
        </button>
      </aside>
      <div className="shell-main">
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
          <Link
            to="/"
            className="brand brand--topbar"
            onClick={() => setNavOpen(false)}
          >
            <BrandMark />
            <span>
              <strong>{platformName}</strong>
              <small>SaaS console</small>
            </span>
          </Link>
          <div className="topbar-search">
            <button
              type="button"
              className="search-trigger"
              aria-label="Search the console"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon size={16} strokeWidth={2} aria-hidden="true" />
              <span className="search-trigger-label">Search…</span>
              <kbd className="search-trigger-kbd">⌘K</kbd>
            </button>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="search-trigger search-trigger--icon"
              aria-label="Search the console"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <AccountMenu />
          </div>
        </div>
        {secondaryNav ? (
          <div className="shell-body">
            {secondaryNav}
            <main className="main">{children}</main>
          </div>
        ) : (
          <main className="main">{children}</main>
        )}
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
