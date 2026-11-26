import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// NOTE: the client MUST come from "better-auth/react", not
// "better-auth/client" — only the React client exposes `useSession()` as
// a hook. The vanilla client exposes it as a nanostores Atom, which is
// not callable from a component (and fails `tsc -b`).
//
// Same-origin by default: Caddy proxies /api/better-auth/* on the tenant
// host to the central auth service. The server-side fallback below only
// runs during prerender (no window); browser code always uses the origin.
//
// Phase 3: the client is live now (was dead code — zero imports).
// NEXT_PUBLIC_API_URL is NOT consulted for auth anymore: pointing the
// browser at the API origin would bypass the same-origin proxy.
const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(
        /\/api$/,
        "",
      );

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/better-auth",
  plugins: [
    // TOTP challenge after password sign-in (Phase 1 Q11): the service
    // answers sign-in with FORBIDDEN { code: "TWO_FACTOR_REQUIRED" } and
    // the login screen verifies the code via `twoFactor.verifyTotp`.
    // Enrolment itself lives in the admin app (D13), not in the storefront.
    twoFactorClient(),
  ],
});
