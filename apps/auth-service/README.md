# auth-service — central Better Auth service (Phase 1)

One Better Auth instance for all of EcoMate (D1=A, dedicated service;
D2=A, dedicated `ecomate_auth` Postgres database). Tenant storefronts
(`*.faah.net` / `*.ecomate.bd`), the SaaS console
(`em.commercians.com`), and verified custom domains all authenticate
against this service. Sessions stay **per-origin** (D14=A): cookies are
host-only, no `Domain` attribute, no cross-subdomain cookies — a user
signs in separately on each host.

Plain Node `http` + `auth.handler(Request)` (no framework). The handler
is rebuilt per request in `src/server.ts` — the wrapper needs the request
body + response status for lockout accounting, `list-sessions` shaping,
and the crash guard. This is a deliberate deviation from the Phase 0
spike's `toNodeHandler` shape; behaviour was verified identical for
origin gating (see "Origin gating" below).

## Run

```sh
npm run dev      # tsx watch, src/index.ts
npm run build    # tsc + copy generated Prisma client into dist/
npm start        # node dist/index.js (listens on AUTH_PORT, default 4200)
npm test         # node --import tsx --test "tests/*.test.ts"
```

Tests need the scratch `ecomate_auth` database on the VM Postgres
cluster (port 55432) — see `~/workspace/ecomate-review/test-env-setup.sh`
(idempotent). They boot the real server in-process on ports 4311–4319
(tenant-registry tests also run a fake platform-api registry on 4335;
social-totp also uses 4318 for its strict-mode server and 4331 for its
fake IdP — pick a fresh port for any new test file).

## Configuration

Env-driven, see `.env.example`. Highlights:

- `BETTER_AUTH_SECRET` — required in production (throws at boot if
  unset); dev/test fall back to a random per-boot secret with a warning.
- `AUTH_DB_URL` — required; DSN for the dedicated `ecomate_auth` DB.
- `AUTH_PUBLIC_URL` / `AUTH_INTERNAL_URL` — prod
  `https://auth.em.commercians.com` (plan §3.1 decision A) /
  `http://auth-service:4200`; staging `auth.staging.em.commercians.com`.
- `baseURL.allowedHosts` — `faah.net`, `*.faah.net`, `em.commercians.com`,
  `ecomate.bd`, `*.ecomate.bd`, protocol `https`. **No `fallback` host is
  configured — unknown hosts fail closed (500, server stays alive).**
- `AUTH_ORG_LIMIT` (default 5, D12 — read from config, never a literal in
  the plugin options) and `AUTH_MEMBERSHIP_LIMIT` (default 100; customers
  are NOT org members, D4).

## Auth behaviour (decisions + evidence)

- **Session (D3=A):** 7-day expiry, 1-day sliding `updateAge`, 1-day
  `freshAge`, `cookieCache: { enabled: true, maxAge: 300, strategy:
  "compact" }`. `revokeSessionsOnPasswordReset: true`.
  Note: `get-session` can serve the **cached** session for up to 300 s —
  a change made by another call (e.g. `set-active-org`, TOTP enable)
  may not show in `get-session` until the cache refreshes. The durable
  state is the session row in the DB.
- **Email verification:** `requireEmailVerification: false` — preserved
  behaviour. The legacy login never checks `emailVerified`
  (`apps/backend/src/auth/auth.service.ts` login has no such gate;
  register sets `emailVerified: false` and the user signs in immediately).
  Verification-link TTL is set explicitly to 24 h (BA default is 3600 s;
  `dist/api/routes/email-verification.mjs:14`), preserving the current
  custom EMAIL_VERIFICATION OTP window.
- **Reset links (D7=B, BA native — SUPERSEDED as the UI flow by the D7
  flip, 2026-11-26; the endpoint stays as a fallback):** endpoint
  `/request-password-reset` (NOT `/forget-password`). **Q5 resolution —
  reset-token TTL is 3600 s by default and configurable** via
  `emailAndPassword.resetPasswordTokenExpiresIn`
  (`apps/backend/node_modules/better-auth/dist/api/routes/password.mjs:73`,
  `resetPasswordTokenExpiresIn || 3600`); set explicitly to **900 s
  (15 min)** to preserve the current custom OTP reset window. The token
  is a **path segment** in the emailed URL:
  `{baseURL}/reset-password/<token>?callbackURL=…`.
- **Email OTP login + OTP password reset (D7 FLIP, 2026-11-26 — Boss:
  "Ha, plugin diye OTP firiye anaw"):** `emailOTP()` plugin
  (`src/auth-options.ts`, BA 1.7.28 docs
  `better-auth.com/docs/plugins/email-otp`). Config: `otpLength: 6`,
  `expiresIn: 900` (15 min, the old reset OTP window; BA default 300),
  `allowedAttempts: 5` (the old flow consumed all OTPs at 5 failures;
  BA default 3), `storeOTP: "encrypted"` (BA default is `"plain"` —
  never ship plain), `disableSignUp: true` (MANDATORY — OTP login must
  never auto-create users; unknown emails answer `INVALID_OTP`),
  `resendStrategy: "rotate"` (every resend issues a new code; the old
  one stops working). `changeEmail` is NOT enabled.
  `overrideDefaultEmailVerification` is UNSET — email verification
  stays LINK-based; the EMAIL_VERIFICATION OTP decision is still open
  for Phase 5. Mailer: `Mailer.sendVerificationOTP(to, otp, type)`
  (`src/mailer.ts`, nodemailer SMTP, same env shape as the reset /
  verification mails; per-type subjects so a login code cannot be
  mistaken for a reset code). Client: `emailOTPClient()` in the three
  tenant frontends (`authClient.signIn.emailOtp()`,
  `authClient.emailOtp.{sendVerificationOtp,requestPasswordReset,
  resetPassword}`). Endpoints: `POST /sign-in/email-otp`,
  `POST /email-otp/send-verification-otp`,
  `POST /email-otp/request-password-reset`,
  `POST /email-otp/reset-password`. Rate limits: see the table below.
  **Password-removal gotcha (verified in BA 1.7.28 source,
  `dist/db/revoke-unproven-account-access.mjs`):** OTP sign-in on an
  `emailVerified: false` user DELETES every account row (including the
  credential/password account) and ALL sessions, then flips the user
  verified. Closed at migration time, not in the plugin: script 01
  forces `emailVerified: true` for every migrated tenant user (with a
  re-run backfill) and `POST /internal/users` defaults new users to
  verified — migrated users are existing trusted users and legacy
  login never gated on `emailVerified`. A live regression test
  (`tests/email-otp.test.ts`, "GOTCHA") pins the BA behaviour so the
  migration forcing can never silently regress. **TOTP note:** OTP
  sign-in does NOT trigger a TOTP challenge — BA's twoFactor plugin
  only gates `/sign-in/email|username|phone-number`; the mailbox OTP
  is itself the possession proof, and the same mailbox already resets
  the password without TOTP, so OTP login adds no new
  mailbox-compromise path.
- **Passwords:** dispatching `verify` — stored hashes starting with `$2`
  verify with `bcryptjs.compare` (legacy bcrypt users), everything else
  with BA's default scrypt verify; `hash` is NOT overridden, so new /
  changed passwords become scrypt and the fleet converges.
- **Two-factor (D13=B):** `twoFactor()` TOTP, `appName: "EcoMate"`
  (top-level appName sets the TOTP issuer), 6 digits / 30 s. **Q6
  resolution — backup codes are already stored encrypted by default**
  in BA 1.7.28 (`dist/plugins/two-factor/index.mjs:60`,
  `storeBackupCodes: "encrypted"`); set explicitly to `"encrypted"` so a
  future default change cannot silently switch to plaintext. Note:
  `verify-totp` returns `{ token, user }`, not `{ status: true }`
  (its OpenAPI schema claims otherwise).
- **Organizations (D11=A):** `organization()` with dynamic access
  control enabled and custom roles `owner, admin, cashier,
  packing_assistant, employee` (owner full; admin everything except org
  delete; staff roles coarse member-level gates). The backend stays
  authoritative for permissions. `allowUserToCreateOrganization: false`
  (browser org-create 403s); `membershipLimit` 100; teams OFF.
- **`platformRole` (D5):** additional user field
  (`type: "string", required: false, input: false`), landed in the
  Prisma user model; stripped from client writes by `databaseHooks`.
- **Social (D9=B):** `google`, `github`, `facebook` configured from env;
  empty id/secret = disabled. **Constraint (Phase 0): providers forbid
  wildcard redirect URIs, so social works only on a fixed host set —
  per-tenant-subdomain callbacks are not registerable; scope the later
  login UI accordingly.**
- **No impersonation endpoints, no bearer/JWT plugins in this
  phase.** Bearer/JWT are out per the Phase 0 verdict: HTTP
  `getSession` is the design. The admin plugin + D8 handoff are
  implemented below (follow-up worker, 2026-11-26).

## Admin plugin (Q7) + `/admin/*` edge gate

`admin()` is enabled with a narrow custom role map
(`src/auth-options.ts`, `dist/plugins/admin/has-permission.mjs:3`):

| BA `role` | Permissions |
| --- | --- |
| `operator` | `user: ["impersonate"]` — nothing else |
| `user` | nothing |
| `admin` (or any string not in the map) | nothing — fail-closed |

`adminUserIds` is NEVER set; `adminRoles: ["operator"]`,
`defaultRole: "user"`, `impersonationSessionDuration: 900 s`
(`IMPERSONATION_TTL_SECONDS`, clamped 60–3600). Only console
operators with `platformRole` ∈ {SUPERADMIN, SUPPORT} hold BA
`role="operator"` — set at Phase 2 migration and kept in sync by
`POST /internal/users/role-sync` (see below); everyone else is
`role="user"`.

**Raw `/admin/*` HTTP is edge-blocked** (`src/server.ts`): any
endpoint `== "/admin"` or starting `/admin/` answers **404
`{error: "not_found"}`** + audit `auth.admin_blocked`, EXCEPT
`POST /admin/stop-impersonating`, which stays reachable (the
tenant-host path for ending impersonation). In-process
`auth.api.*` calls are unaffected — the plugin is used server-side
only.

**Break-glass runbook:** there is no UI or endpoint to grant
`operator`. An operator is created by a direct DB update, by a
human, with a second human verifying:

```sql
-- 1. Confirm the person is a console SUPERADMIN or SUPPORT operator.
SELECT id, email, "platformRole", role FROM "user" WHERE email = '<op email>';
-- 2. Grant (only after the Phase 2 migration has set platformRole).
UPDATE "user" SET role = 'operator' WHERE id = '<id>' AND "platformRole" IN ('SUPERADMIN','SUPPORT');
-- 3. Revoke the same way (role = 'user'). Revoking the BA role does not
-- revoke live sessions: also DELETE FROM session WHERE "userId" = '<id>';
```

**Role-sync route** `POST /internal/users/role-sync`
(`src/internal-routes.ts`, internal-secret auth): body
`{userId, platformRole}`; maps SUPERADMIN|SUPPORT → `operator`,
BILLING|READONLY → `user`; writes BOTH `platformRole` and the
derived BA `role`. 404 unknown user, 400 invalid role, 503 if
`INTERNAL_SERVICE_SECRET` is unconfigured. Audit
`auth.role_synced`. Phase 4 calls this from platform-api whenever
a console operator's platform role changes (and at migration time).

## Impersonation handoff (D8)

Console impersonation never creates a session on the console host.
It is a two-step handoff through the tenant's own host
(design §4; the in-process `impersonateUser` + delete-throwaway-session
alternative was rejected — a session minted on the auth host cannot
carry its cookies to the tenant host).

**Issue** `POST /internal/impersonation/issue` (plain service route,
internal-secret auth, `src/impersonation-issue.ts`):

1. Verify the forwarded operator session (`auth.api.getSession`,
   DB-checked — a revoked admin session cannot issue).
2. `platformRole` ∈ {SUPERADMIN, SUPPORT}, else 403.
3. Resolve the target: earliest-created `owner` member of the org,
   else 409 `tenant_has_no_owner`.
4. `auth.api.userHasPermission` (`user: ["impersonate"]`) + the local
   target-admin predicate mirroring
   `dist/plugins/admin/routes.mjs:601-609` (operator/`admin`-role
   targets → 403 `YOU_CANNOT_IMPERSONATE_ADMINS`).
5. Rate limits: 20 issues / admin / hour, 60 / org / hour → 429 +
   `Retry-After` (in-memory; per-admin/per-org, NOT per-IP — all calls
   arrive from platform-api's IP).
6. Store the handoff row (`ImpersonationHandoff`: SHA-256 `tokenHash`,
   `adminSessionTokenEnc` = the admin's raw session token encrypted
   with the BA secret) and return
   `{url, expiresAt, expiresInSeconds: 900}` where
   `url = https://<slug>.<tenantPrimaryDomain>/api/better-auth/impersonation/consume?token=<64-hex>`
   (slug host, never a custom domain).

Correction to the design §4.3 wording ("token parsed from the
forwarded Cookie header"): the cookie's `session_token` value is
HMAC-signed (`<token>.<signature>`, verified live 2026-11-26), so the
handler takes the raw token from the DB-verified `getSession` result
instead — the same token, already authenticated.

**Consume** `GET /api/better-auth/impersonation/consume` (local BA
plugin `ecomate-impersonation-handoff`, `src/impersonation-handoff.ts`):
atomic single-use claim (`updateMany … usedAt: null,
expiresAt > now`), target/member/admin-session revalidation, host/slug
check, then a fresh 900 s session via
`internalAdapter.createSession(targetId, true,
{impersonatedBy: <admin user id>, expiresAt, activeOrganizationId}, true)`
+ session cookies + `admin_session` set, 302 to `/admin/`. **All
failures 302 to `/admin/sign-in?error=impersonation_failed`** — the
reason stays in the service log only. A failed consume still claims
the token (no retry). A sweeper purges handoff rows older than 30 days
(daily, at boot + `setInterval`).

**`imp` / `impActor` contract (Phase 3 guard):** the impersonated
session carries `session.impersonatedBy` = the **central user id** of
the console operator (NOT the operator's email — the old platform-api
contract used the email). The Phase 3 backend guard maps
`session.impersonatedBy` → `imp` (boolean: impersonation active) and
`impActor` (the central user id). Anything that today reads the
operator email from `ImpersonationSession` must read the central user
id from `impersonatedBy` instead.

**Audit events:** `auth.impersonation.issued` /
`.consumed` / `.consume_denied` / `.stopped` (stop via
`/admin/stop-impersonating`, actor id parsed from the 200 body) /
`auth.admin_blocked`.

**Platform-api contract (Phase 4, NOT built here):** platform-api
calls issue with the internal secret + the operator's forwarded
session headers, redirects the operator's browser to the returned
`url`; rewires the console Impersonate button to issue (retiring its
`ImpersonationSession` table); implements
`GET /internal/settings/organization-limit` and
`POST /internal/impersonations/consumed` (the service best-effort
POSTs the latter after a consume — 5 s timeout, never blocks the
redirect). Do not touch platform-api in this phase.

**Phase 4 operator MFA/session routes (built here):** the unified
console MFA reset and session management need service-owned routes
because BA's `list-sessions` is self-only and the operator BA role
cannot touch another operator's sessions:
`POST /internal/users/:id/mfa/reset` (deletes TwoFactor rows +
clears `twoFactorEnabled` → `{userId, reset: true, twoFactorEnabled: false}`),
`POST /internal/users/:id/sessions/revoke-all` (`{userId, revokedCount}`),
`GET /internal/users/:id/sessions` (`{data: [...]}` — token NEVER
returned, `revoked` = `expiresAt < now`, `lastUsedAt` = `updatedAt`),
`DELETE /internal/users/:id/sessions/:sessionId` (404
`session_not_found` when the session is absent or belongs to another
user). All four require the internal secret and return 404
`user_not_found` for an unknown user.

## Social sign-in TOTP gate (Q11)

`databaseHooks.session.create.before` (`src/auth-options.ts`) acts
only when `ctx.path` starts with `/callback/` (the OAuth callback):
for a TOTP-enabled user it mints the 2FA challenge exactly as the
plugin's own credential after-hook does (verification values
`2fa-<id>` / `2fa-attempts-<id>` + signed `two_factor` cookie, 600 s),
then throws `APIError FORBIDDEN {code: "TWO_FACTOR_REQUIRED"}`.
The callback 302s to `errorCallbackURL?error=TWO_FACTOR_REQUIRED`
with the challenge cookie set and NO session cookie; the login page
completes it via `verify-totp` (Phase 3 UI). Trust-device replication
is mandatory: the hook replays the plugin's HMAC check over the
signed `trust_device` cookie, and any check failure → challenge
(fail closed). Impersonation (`impersonateUser`) never triggers the
hook — operators can impersonate TOTP users.

**Kill-switch** `AUTH_SOCIAL_TOTP_STRICT` (default off): when on,
`POST /sign-in/social` with a string `loginHint` looks the user up
by email first; if that user has TOTP enabled it answers 403
`{code: "TWO_FACTOR_REQUIRED"}` before redirecting to the provider.
Limitation: without a `loginHint` the user cannot be identified
pre-callback, so the request proceeds and the callback hook remains
the gate. Users without TOTP are unaffected either way.

## Rate limiting (exact values)

| Path / rule | Value | Source |
| --- | --- | --- |
| BA `rateLimit` global | enabled, window 60 s, max 100 | `src/auth-options.ts` |
| `POST /sign-in/email` | 10 / 60 s (BA custom rule) | tenant hijack-limiter parity |
| `POST /sign-in/social` | 10 / 60 s (BA custom rule, added 2026-11-26) | parity with credential sign-in — see note below |
| `POST /sign-up/email` | 10 / 60 s (BA custom rule) | same |
| `POST /request-password-reset` | 3 / 60 s (BA custom rule) | BA built-in special rule is also 3/60 s |
| `POST /send-verification-email` | 3 / 60 s (BA custom rule) | BA built-in special rule is also 3/60 s |
| `/two-factor/*` | 3 / 10 s (BA plugin rule, NOT overridden) | `dist/plugins/two-factor/index.mjs:389-395` |
| `POST /email-otp/send-verification-otp`, `/email-otp/check-verification-otp`, `/email-otp/verify-email`, `/email-otp/request-password-reset`, `/email-otp/request-email-change`, `/email-otp/change-email`, `/forget-password/email-otp` | 3 / 60 s (emailOTP plugin rule) | `dist/plugins/email-otp/index.mjs` `rateLimit` — plugin rules override BA's default special rules (`dist/api/rate-limiter/index.mjs:254-263`); `customRules` in `src/auth-options.ts` override plugin rules |
| `POST /sign-in/email-otp`, `POST /email-otp/reset-password` | 10 / 60 s (BA custom rule, D7 flip) | plugin default is 3/60 s, which would 429 a user on their 4th guess and make `allowedAttempts: 5` unreachable; 10/60 s is parity with `/sign-in/email` |
| OTP attempts (`allowedAttempts`) | 5 wrong guesses per OTP, then 403 `TOO_MANY_ATTEMPTS` and the OTP stays consumed | `emailOTP({ allowedAttempts: 5 })` — the BA equivalent of the old flow's "5 failures consume all live OTPs" (`dist/plugins/email-otp/routes.mjs` `atomicVerifyOTP`) |
| Per-IP OTP sign-in pacing | failed OTP verifies count toward the same 10/60 s → 15-min IP block as password sign-in; success clears it | `src/server.ts` (`OTP_SIGN_IN_PATH`) — the deploy checklist's per-IP sign-in pacing covers OTP sign-in too |
| OTP account lockout | NONE — deliberately not applied | an OTP is mailbox proof; a password-failure lockout must not block this recovery path, and OTP failures must not let an attacker lock the victim out of OTP login. Guessing is bounded by `allowedAttempts` + the per-path / per-IP limits above |
| Account lockout | **4th** consecutive failed sign-in locks the account 15 min; success clears it | tenant parity — legacy code (`auth.service.ts:220-250`: `failedLoginAttempts === 3` sets `lockoutUntil = now + 15 min`; counter caps at 4). The plan's "5th attempt" comment contradicts its own code. |
| Per-IP sign-in block | 10 failed sign-ins from one IP in 60 s → that IP blocked from sign-in for 15 min | tenant hijack limiter parity (BA's rolling window cannot express the 15-min block, so the wrapper adds it) |
| Per-IP MFA-challenge cap | 10 verify attempts from one IP in 600 s | platform `/challenge` 10/10 min parity |
| TOTP account lockout | 10 failed TOTP attempts → 15-min lock | BA plugin default, set explicitly (`accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 }`) |

BA's built-in sign-in/sign-up special rule (3/10 s) is superseded by the
custom rules above for those paths. **Finding (measured 2026-11-26):**
BA's default special rule (`dist/api/rate-limiter/index.mjs:305-312`)
caps EVERY `/sign-in/*` path without a custom rule at **3 requests per
10 s** — `/sign-in/social` had no custom rule, so the second social
login inside 10 s 429'd (proven by probe: 3× 200/404 then 429 with
`X-Retry-After: 10`). The `/sign-in/social` 10/min rule above is the
fix (parity, not a relaxation). All counters above are **in-memory**
(BA default storage is also memory) — see "Scaling notes".

**Shared-bucket warning — FIXED in Phase 3 (2026-11-26):** BA logs
"Rate limiting could not determine a client IP and is falling back to
a single shared per-path bucket" whenever no IP header resolves. The
fix has two halves, both landed: (1) Caddy forwards the client IP in
`X-Forwarded-For` (its `reverse_proxy` appends the peer IP by default
— do NOT overwrite it with `{http.request.remote.host}`: Cloudflare
fronts faah.net for caching, and overwriting would mask the client IP
with the Cloudflare edge IP); (2) the service sets
`advanced.ipAddress: { ipAddressHeaders: ["x-forwarded-for"],
trustedProxies? }` (`src/auth-options.ts`, `AUTH_TRUSTED_PROXIES`
env). BA 1.7.28 `getIP` trusts a single-value header with no trusted
proxies configured (exactly what Caddy sends as the direct edge), and
walks a multi-value chain right-to-left past `trustedProxies` —
**deploy MUST set `AUTH_TRUSTED_PROXIES` to the upstream proxy's
egress ranges (Cloudflare's published ranges) when one fronts Caddy**,
or multi-value chains resolve to no IP and the shared bucket returns.
Proven by `tests/tenant-registry.test.ts` ("per-IP rate-limit
buckets…": 10 failures from one X-Forwarded-For IP 429 the 11th from
that IP while a second IP still gets 401 — a shared bucket would 429
both). The service's own `IpLimiter`/`getClientIp` (`src/server.ts`)
already read `x-forwarded-for` the same way.

## Origin gating

`trustedOrigins` is an async function (`src/auth-options.ts`) trusting
an origin iff its host is in the config allowlist
(`AUTH_TRUSTED_HOSTS`) **or** in the live platform tenant registry
(tenant subdomains + VERIFIED/ACTIVE custom domains — **Phase 3 swap,
done 2026-11-26**, `src/tenant-registry.ts`). The registry is fetched
from platform-api `GET /internal/tenants/registry` (internal-secret
auth, 60 s cache, last-good snapshot on fetch failure); with no
registry configured the allowlist alone applies. The allowlist stays
as the base layer because the console/platform hosts are not tenant
domains and never appear in the registry.

**`allowedHosts` vs custom domains — RESOLVED in Phase 3 (survey §11
open question):** `trustedOrigins`-only is NOT sufficient. BA 1.7.28's
`DynamicBaseURLConfig.allowedHosts` is a static `string[]` (no
function form), and an unmatched request host throws BEFORE
`trustedOrigins` runs (500 `auth_handler_error`). The registry
therefore ALSO syncs its hosts into the shared `allowedHosts` array
in place on every refresh (plus a 60 s background timer in
`src/server.ts`, so the array converges even with no auth traffic).
This relies on BA keeping the config object by reference and
resolving the baseURL per request (verified in
`dist/context/helpers.mjs` `resolveRequestContext`); the test
"allowedHosts sync" in `tests/tenant-registry.test.ts` proves the
post-boot mutation takes effect (unlisted custom host 500s, then
200s after a refresh) and MUST pass on any Better Auth upgrade. A
newly verified custom domain is usable for auth within one refresh
interval (60 s) of verification. Never echo the request origin
blindly.

Two BA 1.7.28 behaviours worth knowing (both verified live 2026-11-26):

1. **Test-env trap:** `skipOriginCheck` defaults to `true` whenever
   `NODE_ENV=test` (`dist/context/create-context.mjs:211`; `isTest()` =
   `NODE_ENV === "test" || TEST env`,
   `@better-auth/core/dist/env/env-impl.mjs:37`). Our smoke/test servers
   run under `NODE_ENV=test`, which silently disabled the whole origin /
   CSRF gate (evil Origin + evil callbackURL both returned 200). The
   service therefore sets `advanced.disableOriginCheck: false`
   explicitly — the check is on in every environment. Do not remove it.
2. **Missing Origin without a cookie is NOT rejected** (cookieless
   non-browser POST proceeds to the credential check — standard CSRF
   logic, nothing to forge without cookies). Missing Origin **with** a
   cookie → 403 `MISSING_OR_NULL_ORIGIN`; evil Origin (with or without a
   cookie) → 403 `INVALID_ORIGIN`; evil `callbackURL` → 403
   `INVALID_CALLBACK_URL`.

## Crash fix (Phase 0 production blocker)

An unknown Host throws inside BA's baseURL resolution. The server
wraps `auth.handler` so the request answers **500
`{error: "auth_handler_error"}`** and the process stays alive — no
`fallback` host is added. (Deviation note: the Phase 0 spike recommended
403; the brief specifies 500 — this service follows 500.) Covered by the
hammer regression test (50 unknown-Host requests, then the server must
still serve `/health` and auth).

## list-sessions contract (backend)

`list-sessions` returns raw session tokens in BA. The service **strips
`token` from every entry** before responding (counted in
`auth_service_list_sessions_tokens_stripped_total`). Tokens are never
exposed to a browser client. Consequence: **session revoke-by-id must be
resolved server-side** — the backend must call `auth.api` (revoke by
session id) rather than asking a client to present a token.

## Org provisioning — DECIDED: adapter-level creation (2026-11-26)

With a dynamic `baseURL` and no fallback, `auth.api.createOrganization`
**cannot run as a system action**: without a source it throws "Dynamic
baseURL could not be resolved for this direct auth.api call", and with
headers but no session it 401s
(`dist/plugins/organization/routes/crud-org.mjs`: `!session &&
(ctx.request || ctx.headers)`); a session-authenticated call 403s
(`allowUserToCreateOrganization: false`). Verified live in the test
suite (Q9-3: bare → 500 `/Dynamic baseURL/`, Host-only headers → 401,
own session → 403 `YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION`).

**Decision: adapter-level creation.** `POST
/internal/organizations/provision` (internal-secret auth,
`src/internal-routes.ts` → `provisionOrganization` in
`src/org-limits.ts`) creates the org + owner-member rows in one Prisma
transaction — the same rows `createOrganization` writes — with the
org-limit check applied first (it is NOT bypassed for system actions).
201 / 403 same limit code / 409 slug exists / 404 user not found /
400 missing fields. The internal-fallback-host alternative was NOT
implemented: adapter-level creation proved workable and is the smaller
surface (no extra host, no baseURL fallback to keep out of production).

**Org limit (Q9, D12):** the `organizationLimit` option is the
**function form** (`src/org-limits.ts` — shared with provisioning):
returns `true` when the limit is reached = block. The scaffold's
comment claiming the docs read inverted was WRONG — the docs are
correct (SOURCE: `dist/plugins/organization/routes/crud-org.mjs:61`).
The limit resolves from a platform setting fetched from platform-api
(`GET {AUTH_PLATFORM_API_URL}/internal/settings/organization-limit`,
60 s in-memory cache, clamped [1, 1000]) with env `AUTH_ORG_LIMIT`
(default 5) as fallback; fetch failure / 404 / non-numeric keeps the
last good value and warns. The endpoint landed in Phase 3 (platform-api
`GET /internal/settings/organization-limit`, reading the
`organization_limit` PlatformSetting row; the console settings UI for
the row lands in a later phase). Note:
`allowUserToCreateOrganization: false` fires BEFORE the limit check,
so a session-authenticated `createOrganization` 403 comes from the
allow-create gate, not the limit — the limit itself is proven via the
checker + the provisioning route.

## Observability

- Structured JSON logs (one line per request: request id, method, route,
  status, ms; audit lines for security events). No secrets/tokens in logs.
- `GET /health` — 200 `{status: "ok", db: "ok"}` (runs `SELECT 1`), else 503.
- `GET /metrics` — Prometheus text: request counts by route/status, auth
  failures, unknown-host rejects, list-sessions tokens stripped.
- Audit events from day one: sign-up, sign-in success/failure, password
  reset requested/completed, org created/set-active/provisioned, TOTP
  enabled/verified/backup-code-verified/disabled, session(s) revoked,
  sign-in blocked (locked / IP), role synced (`auth.role_synced`),
  impersonation issued / consumed / denied / stopped
  (`auth.impersonation.*`), raw `/admin/*` blocked
  (`auth.admin_blocked`).

## Prisma schema

`prisma/schema.prisma` was generated with `npx auth generate` (BA core +
org + twoFactor tables, incl. `platformRole` and the dynamic-access-control
`organizationRole` table) plus hand-added `LoginLockout` and
`ImpersonationHandoff` models, and the admin plugin's columns
(`User.role`, `banned`, `banReason`, `banExpires`;
`Session.impersonatedBy`). To regenerate after an options change:

```sh
npx auth generate --config auth-generate.config.ts --adapter prisma \
  --dialect postgresql --output prisma/schema.prisma --yes
# then re-apply the LoginLockout model (see the header comment in schema.prisma)
npx prisma validate
npx prisma migrate dev --name <change>   # scratch DB only, via AUTH_DB_URL
```

Migration `20261126042940_init_ecomate_auth` is additive only (CREATE
TABLE + indexes + FKs, no enums); a `rollback.sql` dropping all 10 tables
ships beside it. Migration `20261126052551_phase1_admin_impersonation_handoff`
adds the admin-plugin columns + the `impersonation_handoff` table
(indexes `[organizationId, createdAt]`, `[expiresAt]`); its `rollback.sql`
drops the table and the columns. Never `db push` / `migrate reset`. No enum `ADD VALUE` +
DML in one migration.

## Scaling notes

- Rate-limit + IP-limiter counters are in-memory (single-instance
  design). A multi-replica deployment must move them to shared storage
  (e.g. Redis, or BA `rateLimit.storage: "database"`).
- The service is stateless apart from Postgres; scale horizontally behind
  Caddy once the counters are shared.

## CI story

`.github/workflows/ci.yml` `unit` job has **no Postgres service
container** — backend jest there runs with `--testPathIgnorePatterns
"integration" "tenant-runtime-isolation"` and a comment saying a spec
that needs Postgres must add a `postgres:16-alpine` service container
first. This service's tests are DB-backed, so they cannot run in that
job as-is. Add a service container + a step (do NOT edit `ci.yml` in
this Phase 1 task — this is the snippet for the gates worker):

```yaml
# in the `unit` job, alongside `steps:`:
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_PASSWORD: ci-auth-only
      POSTGRES_DB: ecomate_auth
    ports:
      - 55432:5432
    options: >-
      --health-cmd="pg_isready -U postgres"
      --health-interval=2s --health-timeout=2s --health-retries=15
# and a step (after Install dependencies):
- name: Auth service tests
  working-directory: apps/auth-service
  env:
    AUTH_DB_URL: postgresql://postgres:ci-auth-only@127.0.0.1:55432/ecomate_auth
  run: |
    npx prisma migrate deploy
    npm test
```

Locally the tests run against the VM scratch cluster (`test-env-setup.sh`).

## Deploy (copy-paste for the deploy step — NOT applied in this task)

Prerequisites (once): create the database on the stack Postgres
(`migrate deploy` does not create it):

```sh
docker exec <stack>_postgres.1.<id> psql -U postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = 'ecomate_auth'" | grep -q 1 \
  || docker exec <stack>_postgres.1.<id> createdb -U postgres ecomate_auth
docker exec <auth-service container> sh -c 'cd /app && npx prisma migrate deploy'
```

`docker-compose.yml` — add beside `platform-api` (image built by
`build-service-image.yml` with `service: auth-service`):

```yaml
  auth-service:
    image: ghcr.io/${DOCKER_REGISTRY_OWNER:-mahmudulhasanriaz}/ecomate-saas-auth-service:latest
    restart: unless-stopped
    networks:
      - ecomate-network
    environment:
      NODE_ENV: production
      AUTH_PORT: ${AUTH_PORT:-4200}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET is required}
      AUTH_DB_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@postgres:5432/ecomate_auth
      AUTH_PUBLIC_URL: ${AUTH_PUBLIC_URL:-https://auth.em.commercians.com}
      AUTH_INTERNAL_URL: ${AUTH_INTERNAL_URL:-http://auth-service:4200}
      AUTH_ALLOWED_HOSTS: ${AUTH_ALLOWED_HOSTS:-faah.net,*.faah.net,em.commercians.com,ecomate.bd,*.ecomate.bd}
      AUTH_BASE_PROTOCOL: https
      AUTH_TRUSTED_HOSTS: ${AUTH_TRUSTED_HOSTS:-faah.net,em.commercians.com,ecomate.bd}
      AUTH_ORG_LIMIT: ${AUTH_ORG_LIMIT:-5}
      AUTH_PLATFORM_API_URL: ${AUTH_PLATFORM_API_URL:-http://platform-api:4100/api}
      AUTH_TRUSTED_PROXIES: ${AUTH_TRUSTED_PROXIES:-}
      INTERNAL_SERVICE_SECRET: ${INTERNAL_SERVICE_SECRET:?INTERNAL_SERVICE_SECRET is required}
      IMPERSONATION_TTL_SECONDS: ${IMPERSONATION_TTL_SECONDS:-900}
      AUTH_TENANT_PRIMARY_DOMAIN: ${AUTH_TENANT_PRIMARY_DOMAIN:-faah.net}
      AUTH_SOCIAL_TOTP_STRICT: ${AUTH_SOCIAL_TOTP_STRICT:-false}
      AUTH_SMTP_HOST: ${SMTP_HOST:-}
      AUTH_SMTP_PORT: ${SMTP_PORT:-587}
      AUTH_SMTP_SECURE: ${SMTP_SECURE:-false}
      AUTH_SMTP_USER: ${SMTP_USER:-}
      AUTH_SMTP_PASS: ${SMTP_PASS:-}
      AUTH_SMTP_FROM: ${SMTP_FROM:-EcoMate <no-reply@ecomate.bd>}
      AUTH_GOOGLE_ID: ${AUTH_GOOGLE_ID:-}
      AUTH_GOOGLE_SECRET: ${AUTH_GOOGLE_SECRET:-}
      AUTH_GITHUB_ID: ${AUTH_GITHUB_ID:-}
      AUTH_GITHUB_SECRET: ${AUTH_GITHUB_SECRET:-}
      AUTH_FACEBOOK_ID: ${AUTH_FACEBOOK_ID:-}
      AUTH_FACEBOOK_SECRET: ${AUTH_FACEBOOK_SECRET:-}
```

`portainer/Caddyfile` — new platform host block (plain automatic TLS,
like the other platform hosts; add `AUTH_HOST` to the caddy service env
in compose alongside `PLATFORM_*_HOST`):

```
{$AUTH_HOST:auth.em.commercians.com} {
	handle {
		reverse_proxy auth-service:4200
	}
}
```

Staging values: `AUTH_PUBLIC_URL=https://auth.staging.em.commercians.com`,
`AUTH_HOST=auth.staging.em.commercians.com`. No traffic routes to the
service until the Phase 3 wiring lands; the backends keep their current
auth until then.

**Phase 3 deploy notes (2026-11-26):**

- `AUTH_PLATFORM_API_URL` was corrected above to
  `http://platform-api:4100/api` — the old `http://platform-api:4000`
  was wrong on both port and path (platform-api listens on 4100 with
  the `/api` prefix). The registry client (`src/tenant-registry.ts`)
  and the org-limit resolver both read this URL; a wrong value leaves
  the registry unconfigured (allowlist-only origins, warning-accept
  consume) instead of failing loudly.
- `AUTH_TRUSTED_PROXIES`: set to the upstream proxy's egress ranges
  (Cloudflare's published ranges when Cloudflare fronts Caddy) so BA
  resolves real client IPs from multi-value `X-Forwarded-For` chains.
  Empty = Caddy is the direct edge (single-value header, no walk
  needed). Without it behind Cloudflare, rate-limit buckets fall back
  to one shared per-path bucket (safe, not wrong).
- `INTERNAL_SERVICE_SECRET` rotation invalidates in-flight
  impersonation handoff tokens by design (they are encrypted with it);
  TTL is 900 s, so rotate in a quiet window.
- The compose file in the repo root is the source of truth for the
  deployed stack; the snippet above is kept in sync with it
  (change-completeness rule).
