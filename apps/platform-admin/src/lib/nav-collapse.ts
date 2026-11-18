/**
 * Main-menu collapse state (StackMate `sm-nav-collapsed` pattern).
 *
 * The sidebar collapse is a persisted PIN: the operator's explicit
 * toggle writes it to localStorage, and it survives reloads. The
 * Settings area collapses the main menu VISUALLY on entry (see
 * AppShell) — that visual collapse must NOT overwrite the stored pin,
 * so reading and writing go through these helpers and the shell only
 * ever writes on an explicit toggle.
 */

export const NAV_COLLAPSED_KEY = 'ecomate.platform.nav-collapsed';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function globalStore(): KeyValueStore | null {
  try {
    const store = (globalThis as unknown as Record<string, unknown>)
      .localStorage;
    if (
      store &&
      typeof (store as KeyValueStore).getItem === 'function' &&
      typeof (store as KeyValueStore).setItem === 'function' &&
      typeof (store as KeyValueStore).removeItem === 'function'
    ) {
      return store as KeyValueStore;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read the persisted collapse pin. No stored value → expanded. */
export function readNavCollapsed(
  store: KeyValueStore | null = globalStore(),
): boolean {
  try {
    return store?.getItem(NAV_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the collapse pin (explicit toggles only). */
export function writeNavCollapsed(
  collapsed: boolean,
  store: KeyValueStore | null = globalStore(),
): void {
  try {
    store?.setItem(NAV_COLLAPSED_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Storage can be unavailable (private mode); the state still
    // applies for this load.
  }
}
