import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// Same-origin by default: the POS origin proxies /api/* to the backend
// (VITE_API_URL defaults to /api), so auth calls belong on this origin.
// The old localhost fallback fired whenever VITE_BETTER_AUTH_URL was not
// baked into the build — pointing staff browsers at http://localhost:4000,
// which both breaks sign-in and makes Chrome demand the Local Network
// Access permission. An explicit VITE_BETTER_AUTH_URL still wins.
//
// NOTE: the client MUST come from "better-auth/react", not
// "better-auth/client" — only the React client exposes `useSession()` as
// a hook. The vanilla client exposes it as a nanostores Atom, which is
// not callable from a component (and fails `tsc -b`).
//
// Phase 3: the client is live now (was dead code — zero imports). Caddy
// proxies /api/better-auth/* on the tenant host to the central auth
// service; VITE_BETTER_AUTH_URL must stay unset in deployed builds.
const baseURL =
  import.meta.env.VITE_BETTER_AUTH_URL ||
  (typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:4000");

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/better-auth",
  plugins: [
    // TOTP challenge after password sign-in (Phase 1 Q11): the service
    // answers sign-in with FORBIDDEN { code: "TWO_FACTOR_REQUIRED" } and
    // the login screen verifies the code via `twoFactor.verifyTotp`.
    // Enrolment itself lives in the admin app (D13), not in POS.
    twoFactorClient(),
  ],
});
