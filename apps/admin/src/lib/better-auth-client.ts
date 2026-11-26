import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

/**
 * Central Better Auth client (Phase 3 tenant cutover).
 *
 * NOTE: the client MUST come from "better-auth/react", not
 * "better-auth/client" — only the React client exposes `useSession()` /
 * `useListOrganizations()` / `useActiveOrganization()` as hooks. The
 * vanilla client exposes them as nanostores Atoms, which are not callable
 * from a component (and fail `tsc -b`).
 *
 * Same-origin by default: Caddy proxies `/api/better-auth/*` on the tenant
 * host to the central auth service, so the browser never talks to the
 * service directly and no CORS is involved. `VITE_BETTER_AUTH_URL` is an
 * escape hatch for local dev only — it must stay unset in deployed builds,
 * or sign-in bypasses the same-origin proxy (and the service's
 * trustedOrigins allowlist will reject the tenant host anyway).
 */
const origin =
  typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:5173";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL || origin,
  basePath: "/api/better-auth",
  plugins: [
    // Org switching (tenant = organization; one user, many orgs).
    organizationClient(),
    // Tenant-staff TOTP enrolment + challenge (D13).
    twoFactorClient(),
    // Impersonation stop (D8): `authClient.admin.stopImpersonating()`
    // restores the operator session from the `admin_session` cookie.
    adminClient(),
  ],
});

/** The BA session user, extended with the fields the admin shell reads. */
export type BaSessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  /** TOTP enrolment state (twoFactor plugin). Absent until the first fetch. */
  twoFactorEnabled?: boolean;
  /** Central user id of the operator when this session is impersonated. */
  impersonatedBy?: string | null;
  [key: string]: unknown;
};
