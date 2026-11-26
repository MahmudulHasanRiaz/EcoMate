import type { Session } from '../types';

/**
 * Console session persistence (R-SESSION) — CUSTOM-JWT MODE ONLY.
 *
 * Phase 4 keeps this file for the legacy branch: `custom-jwt` mode
 * still stores `{ accessToken, refreshToken, user }` here. In
 * `central-ba` mode nothing is stored (BA cookie session); AuthProvider
 * clears this key on first central-ba boot and never reads it again.
 * Phase 5 deletes this file together with the legacy mode.
 *
 * The session lives in localStorage, mirroring the tenant admin: the admin
 * keeps its access token in a persistent cookie (`eco_mate_access_token`,
 * 7-day max-age) plus the cached user in localStorage, so its session
 * survives tab closes and browser restarts. The console previously used
 * sessionStorage, so closing the tab signed the operator out.
 *
 * Security reasoning (why localStorage is safe here — same posture as
 * sessionStorage, no new exposure):
 *
 * - XSS exposure is IDENTICAL for localStorage and sessionStorage: both
 *   are readable by any script running on the console origin. Moving the
 *   store changes persistence, not the attack surface. The console serves
 *   no third-party scripts and uses no `dangerouslySetInnerHTML`, which
 *   keeps script injection out of the threat model either way.
 * - The access token is short-lived; the refresh token ROTATES on every
 *   refresh (same family id) and the API revokes the whole family when a
 *   rotated token is replayed outside a short grace window. A stolen
 *   refresh token is therefore useful only until the next legitimate
 *   refresh, and its reuse is detected server-side.
 * - Logout clears this store AND revokes the refresh token server-side
 *   (`POST /auth/logout`), so a logged-out session cannot be replayed
 *   from a copied token.
 * - Cross-tab sync (the `storage` listener in AuthProvider) keeps every
 *   tab on the same rotated tokens. Without it, two tabs could hold
 *   divergent refresh tokens and the stale one would trip the reuse
 *   detector and revoke the family — logging the operator out everywhere.
 */
export const SESSION_STORAGE_KEY = 'ecomate.platform.session';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function globalStore(name: 'localStorage' | 'sessionStorage'): KeyValueStore | null {
  try {
    const store = (globalThis as unknown as Record<string, unknown>)[name];
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

function parseSession(raw: string | null | undefined): Session | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Session;
    if (!value?.accessToken || !value?.refreshToken || !value?.user) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Read the console session. Prefers localStorage; a session left in
 * sessionStorage by a pre-fix build is migrated to localStorage on first
 * read so a logged-in operator is not bounced by the redeploy.
 */
export function readSession(
  primary: KeyValueStore | null = globalStore('localStorage'),
  legacy: KeyValueStore | null = globalStore('sessionStorage'),
): Session | null {
  const current = parseSession(primary?.getItem(SESSION_STORAGE_KEY));
  if (current) return current;
  const migrated = parseSession(legacy?.getItem(SESSION_STORAGE_KEY));
  if (!migrated) return null;
  try {
    primary?.setItem(SESSION_STORAGE_KEY, JSON.stringify(migrated));
  } catch {
    // Storage can be unavailable (private mode); the in-memory session
    // still works for this tab.
  }
  try {
    legacy?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore — the legacy copy is inert once localStorage holds the session.
  }
  return migrated;
}

/**
 * Persist (or clear) the console session. Always drops any legacy
 * sessionStorage copy so the two stores can never diverge.
 */
export function writeSession(
  session: Session | null,
  primary: KeyValueStore | null = globalStore('localStorage'),
  legacy: KeyValueStore | null = globalStore('sessionStorage'),
): void {
  try {
    if (session) primary?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else primary?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the in-memory session still works.
  }
  try {
    legacy?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore — a stale legacy copy is only read when localStorage is empty.
  }
}
