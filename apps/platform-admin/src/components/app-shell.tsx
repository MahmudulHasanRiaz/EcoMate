import { Link, Navigate } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Building,
  ChartColumn,
  CreditCard,
  Gauge,
  Globe,
  Images,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Puzzle,
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
 * names — Building2 / BarChart3 were removed as deprecated aliases).
 * Live StackMate behaviour: the sidebar nav is grouped under 12px muted
 * labels with thin dividers between groups (not a flat list). */
const NAV_GROUPS: {
  label: string;
  items: { to: string; label: string; icon: LucideIcon }[];
}[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Tenants',
    items: [
      { to: '/tenants', label: 'Tenants', icon: Building },
      { to: '/leads', label: 'Leads', icon: UserPlus },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/billing', label: 'Billing', icon: CreditCard },
      { to: '/plans', label: 'Plans', icon: Layers },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/domains', label: 'Domains', icon: Globe },
      { to: '/usage', label: 'Usage', icon: Gauge },
      { to: '/metrics', label: 'Metrics', icon: ChartColumn },
      { to: '/add-ons', label: 'Add-ons', icon: Puzzle },
    ],
  },
  {
    label: 'Website',
    items: [
      { to: '/landing', label: 'Landing', icon: LayoutTemplate },
      { to: '/media', label: 'Media', icon: Images },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/users', label: 'Users', icon: Users },
      { to: '/audit', label: 'Audit', icon: ScrollText },
    ],
  },
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
 * Console shell (StackMate Neon layout, EcoMate landing-indigo accent).
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
 *   it. Only an explicit toggle press persists (StackMate pin rule). The
 *   hover expansion is suppressed on these pages (data-secondary-nav):
 *   the push would shift the secondary nav's links under the pointer.
 * - Hovering the collapsed rail expands the sidebar IN FLOW — the grid
 *   column widens and the canvas shifts aside (Boss, 2026-11-18: even a
 *   hover-expand must move the canvas, never overlay it).
 * - After a toggle click the hover expansion is suppressed until the
 *   pointer leaves the sidebar (data-flyout-suppressed): without this,
 *   collapsing leaves the pointer resting over the rail, the hover
 *   re-expands at once, and the click looks like it did nothing (Boss,
 *   2026-11-18).
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
  // True right after a toggle click, until the pointer leaves the sidebar
  // (or focus moves anywhere — keyboard users). Gates the hover flyout so
  // a collapse is actually visible instead of being masked by the flyout.
  // Focus clears it at the shell level, not just inside the sidebar:
  // after a keyboard collapse + blur, the next Tab lands on the hamburger
  // (the element after the toggle in tab order), so an aside-only focus
  // handler would leave the flyout suppressed for a whole Tab cycle.
  const [flyoutSuppressed, setFlyoutSuppressed] = useState(false);

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
      data-secondary-nav={secondaryNav ? 'true' : 'false'}
      data-flyout-suppressed={flyoutSuppressed ? 'true' : 'false'}
      onFocus={() => setFlyoutSuppressed(false)}
    >
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      />
      <aside
        className="sidebar"
        onMouseLeave={() => setFlyoutSuppressed(false)}
      >
        <Link to="/" className="brand" onClick={() => setNavOpen(false)}>
          <BrandMark />
          <span className="brand-name">
            <strong>{platformName}</strong>
            <small>SaaS console</small>
          </span>
        </Link>
        <nav className="nav" aria-label="SaaS navigation">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    activeOptions={{ exact: item.to === '/' }}
                    className="nav-link"
                    activeProps={{ className: 'nav-link nav-link--active' }}
                    onClick={() => setNavOpen(false)}
                  >
                    <Icon size={16} strokeWidth={2} aria-hidden="true" />
                    <span className="nav-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <button
          type="button"
          className="nav-collapse-btn"
          aria-label={navCollapsed ? 'Expand menu' : 'Collapse menu'}
          aria-expanded={!navCollapsed}
          onClick={(event) => {
            toggleCollapsed();
            // Suppress the hover flyout until the pointer leaves the
            // sidebar: after collapsing, the pointer rests over the rail
            // and the flyout would re-open at once, making the click look
            // like it did nothing (the toggle label flips but the menu
            // still looks expanded — the next click then feels reversed).
            setFlyoutSuppressed(true);
            // The flyout opens on :focus-within, so without this the
            // button keeps focus after collapsing and the sidebar stays
            // expanded as an overlay instead of visibly collapsing to
            // the 64px rail. Blurring lets the rail actually collapse;
            // keyboard users still get the flyout by tabbing to a link.
            event.currentTarget.blur();
          }}
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
        <footer className="shell-footer">
          <span>
            {platformName} · SaaS console
          </span>
        </footer>
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
