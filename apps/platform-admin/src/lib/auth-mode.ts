/**
 * Runtime auth-mode reader (Phase 4 console cutover).
 *
 * The console is dual-mode: `custom-jwt` behaves exactly as today
 * (localStorage tokens, `POST /auth/login`), `central-ba` uses the
 * Better Auth client. The mode is read at RUNTIME from platform-api's
 * public endpoint — a build-time `VITE_*` flag cannot roll back without
 * a redeploy, which defeats the rollback.
 *
 * Anything that cannot be read (endpoint missing because the
 * platform-api half has not landed yet, network error, malformed body)
 * resolves to `custom-jwt`: the console keeps working exactly as today
 * until the flag endpoint exists and reports `central-ba`.
 */

export type AuthMode = 'custom-jwt' | 'central-ba';

const API_BASE = (import.meta.env.VITE_PLATFORM_API_URL || '/api').replace(
  /\/+$/,
  '',
);

let cachedPromise: Promise<AuthMode> | null = null;

export function isAuthMode(value: unknown): value is AuthMode {
  return value === 'custom-jwt' || value === 'central-ba';
}

/** Fetch (once, cached) the console auth mode from platform-api. */
export function getAuthMode(
  fetchImpl: typeof fetch = fetch,
): Promise<AuthMode> {
  if (!cachedPromise) {
    cachedPromise = fetchImpl(`${API_BASE}/public/auth-mode`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) return 'custom-jwt' as AuthMode;
        const body: unknown = await response.json().catch(() => null);
        if (
          body &&
          typeof body === 'object' &&
          isAuthMode((body as { mode?: unknown }).mode)
        ) {
          return (body as { mode: AuthMode }).mode;
        }
        return 'custom-jwt' as AuthMode;
      })
      .catch(() => 'custom-jwt' as AuthMode);
  }
  return cachedPromise;
}

/** Test-only: drop the cached mode so the next call re-fetches. */
export function resetAuthModeForTests(): void {
  cachedPromise = null;
}
