import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

/**
 * Central Better Auth client for the SaaS console (Phase 4 cutover).
 *
 * NOTE: the client MUST come from "better-auth/react", not
 * "better-auth/client" — only the React client exposes `useSession()` as
 * a hook. The vanilla client exposes it as a nanostores Atom, which is
 * not callable from a component (this exact trap broke Phase 3's first
 * admin baseline).
 *
 * Same-origin by default: Caddy proxies `/api/better-auth/*` on the
 * console host to the central auth service, so the browser never talks
 * to the service directly and no CORS is involved. `VITE_BETTER_AUTH_URL`
 * is an escape hatch for local dev only — it must stay unset in deployed
 * builds, or sign-in bypasses the same-origin proxy.
 *
 * Plugins: twoFactor ONLY (survey Q10). Operators are global (D5=A
 * `platformRole` field); they hold no org membership and never switch
 * orgs, so there is no `organizationClient()` here — it would imply an
 * org switcher that must never exist. No `adminClient()` either:
 * impersonation goes through platform-api, never through a direct admin
 * call from the console.
 */
const origin =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:5174';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL || origin,
  basePath: '/api/better-auth',
  plugins: [twoFactorClient()],
});

/**
 * The BA session user, as the console reads it. Only `id` is used
 * (the bridge resolves the canonical operator via `GET /auth/me`);
 * `platformRole` / `twoFactorEnabled` arrive as additional/plugin fields
 * and are read through this loose shape, never assumed present.
 */
export type BaSessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  /** TOTP enrolment state (twoFactor plugin). */
  twoFactorEnabled?: boolean;
  /** Console operator role (D5=A additional field). */
  platformRole?: string;
  [key: string]: unknown;
};
