import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  LogOut,
  Settings as SettingsIcon,
  SunMoon,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { fetchApiHealth } from '../lib/api-status';
import { userAvatarUrl } from '../lib/media';
import {
  applyTheme,
  resolveThemeChoice,
  type ThemeChoice,
} from '../lib/theme';
import { roleLabel } from '../lib/users';
import { Avatar } from './avatar';
import { ChangePasswordDialog, ProfileDialog } from './account-dialogs';

/* ------------------------------------------------------------------ */
/* Menu — dropdown (StackMate primitives pattern). Outside click + Esc  */
/* close, arrow keys cycle items, focus returns to the trigger on      */
/* close. Any MenuItem click closes the menu after its action runs.    */
/* ------------------------------------------------------------------ */

const MenuContext = createContext<{ close: () => void }>({
  close: () => undefined,
});

export function Menu({
  trigger,
  triggerLabel,
  triggerClassName,
  children,
}: {
  trigger: ReactNode;
  triggerLabel: string;
  triggerClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const menuItems = useCallback(
    () =>
      Array.from(
        wrapRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemradio"]',
        ) ?? [],
      ),
    [],
  );

  const focusItem = useCallback(
    (index: number) => {
      const items = menuItems();
      if (items.length === 0) return;
      const next = items[(index + items.length) % items.length];
      next?.focus();
    },
    [menuItems],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  const onWrapKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = menuItems();
      const activeIdx = items.findIndex((el) => el === document.activeElement);
      if (activeIdx === -1) {
        focusItem(e.key === 'ArrowDown' ? 0 : items.length - 1);
      } else {
        focusItem(activeIdx + (e.key === 'ArrowDown' ? 1 : -1));
      }
    }
  };

  return (
    <div className="menu-wrap" ref={wrapRef} onKeyDown={onWrapKeyDown}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open ? (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div className="menu" role="menu" aria-label={triggerLabel}>
            {children}
          </div>
        </MenuContext.Provider>
      ) : null}
    </div>
  );
}

export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="menu-header">{children}</div>;
}

export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return <div className="menu-section-label">{children}</div>;
}

export function MenuDivider() {
  return <div className="menu-divider" role="separator" />;
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
  checked,
  role = 'menuitem',
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  checked?: boolean;
  role?: 'menuitem' | 'menuitemradio';
}) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitemradio' ? (checked ?? false) : undefined}
      data-danger={danger || undefined}
      className="menu-item"
      onClick={() => {
        onClick?.();
        close();
      }}
    >
      {Icon ? <Icon size={16} strokeWidth={2} /> : null}
      <span className="menu-item-label">{children}</span>
      {checked ? (
        <span className="menu-item-check" aria-hidden="true">
          <Check size={16} strokeWidth={2} />
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* MenuSub — a submenu row inside a Menu (account menu "Theme"). The   */
/* fly-out opens to the LEFT of the menu (the account menu sits at the */
/* right edge). Hover opens it; click/Enter toggles; ArrowRight opens, */
/* ArrowLeft closes. A 150ms close delay bridges the 4px gap between   */
/* the trigger row and the panel so the pointer can travel across it   */
/* without the submenu vanishing.                                      */
/* ------------------------------------------------------------------ */

export function MenuSub({
  icon: Icon,
  label,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  }, [cancelClose]);
  const openSub = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
      }
    },
    [],
  );

  return (
    <div
      className="menu-sub-wrap"
      onMouseEnter={openSub}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        ref={triggerRef}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="menu-item"
        onClick={() => (open ? scheduleClose() : openSub())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openSub();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        {Icon ? <Icon size={16} strokeWidth={2} /> : null}
        <span className="menu-item-label">{label}</span>
        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="menu-sub"
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Account menu — StackMate Neon, landing-indigo accent. ONE button    */
/* (avatar + name + chevron) in the topbar opens a ~320px dark menu:   */
/* header (avatar, name, email, role), "Manage" (Profile, Change      */
/* password, Settings, Theme submenu), a live API Status row, then     */
/* Sign out. The theme choice lives ONLY here — there is no           */
/* standalone theme toggle anywhere else in the console.               */
/*                                                                     */
/* Profile and Change password open CENTRED MODAL DIALOGS (live        */
/* StackMate) — they do not navigate. MFA setup + recovery codes live  */
/* on /account, reached from the Profile dialog's 2FA row. Settings    */
/* goes to /settings; Theme switches the console theme; Status reads   */
/* GET /api/health once per session.                                   */
/* ------------------------------------------------------------------ */

const THEME_CHOICES: { key: ThemeChoice; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'dark', label: 'Dark' },
  { key: 'light', label: 'Light' },
];

type ApiStatus = 'checking' | 'ok' | 'down';

function useApiStatus(): ApiStatus {
  const { api } = useAuth();
  const [status, setStatus] = useState<ApiStatus>('checking');
  useEffect(() => {
    let alive = true;
    void fetchApiHealth(() =>
      api('/health')
        .then((r) => r.ok)
        .catch(() => false),
    ).then((ok) => {
      if (alive) setStatus(ok ? 'ok' : 'down');
    });
    return () => {
      alive = false;
    };
  }, [api]);
  return status;
}

export function AccountMenu() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() =>
    resolveThemeChoice(),
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const apiStatus = useApiStatus();

  if (!session) return null;
  const { user } = session;

  const chooseTheme = (choice: ThemeChoice) => {
    setThemeChoice(choice);
    applyTheme(choice);
  };

  return (
    <>
      <Menu
        triggerLabel="Account menu"
        triggerClassName="account-btn"
        trigger={
          <>
            <Avatar
              name={user.name}
              email={user.email}
              avatarUrl={userAvatarUrl(user)}
            />
            <span className="account-name">{user.name}</span>
            <ChevronDown
              size={14}
              strokeWidth={2}
              className="account-chevron"
            />
          </>
        }
      >
      <MenuHeader>
        <Avatar
          name={user.name}
          email={user.email}
          avatarUrl={userAvatarUrl(user)}
          size="lg"
        />
        <div className="menu-header-body">
          <div className="menu-header-name">{user.name}</div>
          <div className="menu-header-sub">{user.email}</div>
          <div className="menu-header-roles">
            <span className="badge badge--muted">{roleLabel(user.role)}</span>
          </div>
        </div>
      </MenuHeader>
      <MenuDivider />
      <MenuItem icon={User} onClick={() => setProfileOpen(true)}>
        Profile
      </MenuItem>
      <MenuItem icon={KeyRound} onClick={() => setPasswordOpen(true)}>
        Change password
      </MenuItem>
      <MenuItem
        icon={SettingsIcon}
        onClick={() => void navigate({ to: '/settings' })}
      >
        Settings
      </MenuItem>
      <MenuSub icon={SunMoon} label="Theme">
        {THEME_CHOICES.map((choice) => (
          <MenuItem
            key={choice.key}
            role="menuitemradio"
            checked={themeChoice === choice.key}
            onClick={() => chooseTheme(choice.key)}
          >
            {choice.label}
          </MenuItem>
        ))}
      </MenuSub>
      <div className="menu-status-row" role="status">
        <span className="menu-item-label">Status</span>
        {apiStatus === 'ok' ? (
          <span className="badge badge--accent">All OK</span>
        ) : apiStatus === 'down' ? (
          <span className="badge badge--danger">Unavailable</span>
        ) : (
          <span className="badge badge--muted">Checking…</span>
        )}
      </div>
      <MenuDivider />
      <MenuItem
        icon={LogOut}
        danger
        onClick={() => {
          logout();
          void navigate({ to: '/login' });
        }}
      >
        Sign out
      </MenuItem>
      </Menu>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
    </>
  );
}
