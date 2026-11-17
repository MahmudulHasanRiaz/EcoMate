# Phase 8 E2E harness

Live end-to-end scenarios E1–E5, E7–E9, E11 (report `04-e2e-launch-runbooks.md` §1f).
E6/E10 need staging + real DNS and are **not** part of this harness.

| Scenario | What it proves |
| --- | --- |
| E1 `e1-signup.mjs` | Landing signup in Chrome: wizard validation, inbox panel, resend, verify link, provisioning progress, ready state |
| E2 `e2-provisioning-failure.mjs` | Backend stopped mid-provisioning → failed state + retry → success after restart |
| E3 `e3-admin-shop-setup.mjs` | Owner signs in to tenant admin, creates a product with an image; active product visible on the storefront, draft not visible |
| E4 `e4-live-order.mjs` | Guest COD order on tenant A; A's product page and A's order (id + view token) are NOT readable from tenant B's host |
| E5 `e5-suspended-grace.mjs` | Checkout succeeds (TRIAL) → fails (SUSPENDED) → succeeds after restore → succeeds (PAST_DUE grace) |
| E7 `e7-custom-domain-negative.mjs` | Unresolvable host: DNS verify fails, TLS-ask denies, storefront does not serve it; duplicate/malformed/internal hosts rejected |
| E8 `e8-alias-fallback.mjs` | Canonical subdomain serves; alias base 301s to canonical; reserved hosts and unknown slugs are not tenants |
| E9 `e9-fallback-outage.mjs` | `SAAS_PRIMARY_UNHEALTHY=true`: aliases redirect to the fallback and the fallback host is served; flag restored afterwards |
| E11 `e11-phase4-rerun.mjs` | Re-runs `scripts/saas/phase4-host-e2e.mjs` as-is |

## Running

```bash
# Stack must be UP first (docker compose or dev servers).
PLATFORM_EMAIL=ops@example.com \
PLATFORM_PASSWORD='…' \
PLATFORM_TOTP=123456 \            # only if the operator has MFA enrolled
  node scripts/saas/phase8-e2e/run.mjs

# A subset:
node scripts/saas/phase8-e2e/run.mjs --only E1,E3
```

The operator must be a **SUPERADMIN** platform user (E7/E8/E9 need domain
config + status changes). The harness starts a local SMTP catcher on port
1025 (override: `SMTP_CATCHER_PORT`) and points the platform SMTP settings
at it — **if the deployment sets SMTP env vars, those win** (env-wins) and
E1 will fail with a "no email arrived" diagnostic. The catcher must be
reachable from the platform-api container: `SMTP_CATCHER_HOST`
(default `host.docker.internal`).

**Sandbox / VM runs:** set `SMTP_CATCHER_HOST=127.0.0.1` — the default
`host.docker.internal` is blocked by the sandbox egress proxy (raw TCP to
non-localhost hosts is intercepted), so verification mail never arrives.
Also point Chrome's profiles at real disk — `/tmp` is a small tmpfs and
Chrome crashes when it fills:

```bash
TMPDIR=$HOME/workspace/ecomate-review/.tmp-chrome node scripts/saas/phase8-e2e/run.mjs --only E3
```

**Storefront build for the harness:** the storefront must be a production
build (the proxy's host resolution only runs when `NODE_ENV=production`),
built with same-origin browser API calls so the `/api` rewrite proxies
them to the local backend (the production Caddy shape):

```bash
cd apps/storefront
API_URL=http://localhost:4000 NEXT_PUBLIC_API_URL=/api npm run build
```

Without this, `NEXT_PUBLIC_API_URL` defaults to `http://localhost:4000/api`
(direct cross-origin calls with no tenant Host — guest checkout cannot
work) and the rewrite destination defaults to `http://backend:4000`.

**Signup rate limit between runs:** the limiter is 5 signups/IP/10min and
browser-based scenarios (E1/E2) do not retry 429s. Clear the key before
each run (Redis port is the harness stack's):

```bash
redis-cli -p 6380 --scan --pattern 'rl:platform:signup:ip:*' \
  | xargs -r redis-cli -p 6380 del
```

All tenants the run creates are soft-deleted at the end (best-effort).
Test data is otherwise left for the retention purge; nothing is hard-deleted
by the harness.

## Configuration

| Env | Default | Notes |
| --- | --- | --- |
| `LANDING_URL` | `http://localhost:3002` | |
| `PLATFORM_API_URL` | `http://localhost:4100/api` | Base includes the global `/api` prefix (appended automatically if missing) |
| `BACKEND_URL` | `http://localhost:4000` | |
| `STOREFRONT_URL` | `http://localhost:3000` | |
| `ADMIN_URL` | `http://localhost:5173` | Admin base; per-tenant URLs come from the provisioning status response |
| `PRIMARY_DOMAIN` | `ecomate.bd` | |
| `ALIAS_BASE_DOMAIN` | (from platform domain config) | E8/E9 alias base override |
| `SMTP_CATCHER_PORT` | `1025` | |
| `SMTP_CATCHER_HOST` | `host.docker.internal` | Host the platform-api container uses to reach the catcher |
| `COMPOSE_FILE` | `docker-compose.yml` | Used by E2/E9 fault injection (docker mode) |
| `BACKEND_SERVICE` / `PLATFORM_API_SERVICE` / `STOREFRONT_SERVICE` | `backend` / `platform-api` / `storefront` | Compose service names (docker mode) |
| `HARNESS_FAULT_MODE` | `docker` | `docker` or `process` — see below |
| `HARNESS_BACKEND_PID_FILE` / `HARNESS_BACKEND_START` | | Process mode: backend PID file + start command (launcher script) |
| `HARNESS_PLATFORM_API_PID_FILE` / `HARNESS_PLATFORM_API_START` | | Process mode: platform-api PID file + start command |
| `HARNESS_STOREFRONT_PID_FILE` / `HARNESS_STOREFRONT_START` | | Process mode: storefront PID file + start command |
| `TLS_ASK_TOKEN` / `INTERNAL_SERVICE_SECRET` | | E7 TLS-ask token |
| `CHROME_PATH` | `~/.cache/ms-playwright/chrome-linux64/chrome` | Chrome for Testing |
| `HEADLESS` | `true` | Set `false` to watch the browser |
| `RUN_ID` | random | Slugs/emails are suffixed with it, so reruns never collide |

## Notes

- **Signup rate limit is 5/IP/10min.** The harness provisions up to 7
  tenants; `provisionTenant` retries 429s with a 60s backoff (up to ~12
  attempts), so a full run may take a few extra minutes.
- **Registry refresh is 60s.** E5 waits 75s after each tenant-status change
  before checking checkout behaviour.
- **E2/E9 fault injection has two modes.** `HARNESS_FAULT_MODE=docker`
  (default) shells out to `docker compose`: E2 stops/starts the backend
  service; E9 restarts storefront + platform-api with
  `SAAS_PRIMARY_UNHEALTHY=true` and restores them in a `finally` block.
  The compose file must pass `SAAS_PRIMARY_UNHEALTHY` through to those
  services for E9's flip to take effect.
  `HARNESS_FAULT_MODE=process` is for dev-server stacks (or sandboxes
  where docker cannot start containers): E2/E9 stop/start plain
  processes via the `HARNESS_<SERVICE>_PID_FILE` /
  `HARNESS_<SERVICE>_START` env vars. Each `*_START` command must start
  the service detached and `exec` the server (so the PID the harness
  records is the server itself); it must NOT hard-set
  `SAAS_PRIMARY_UNHEALTHY` (the harness passes the flip through env).
- **E9 skips cleanly** when the stack has no fallback domain or no alias
  base configured (a deployment-config gap, reported as SKIPPED, not a
  failure). E8's alias-redirect check likewise skips when no alias base is
  configured.
- **Turnstile must be off** in the test stack (no site key configured), or
  E1's wizard submit will be blocked by the captcha.
- Browser hosts are resolved via `--host-resolver-rules` (the VM's
  `/etc/hosts` is read-only); the browser never touches real DNS for
  `*.ecomate.bd`.
- **Secure context.** Plain HTTP on a non-localhost host is not a secure
  context, so `crypto.randomUUID()` is undefined there — and the
  storefront's PageViewTracker calls it on every page (checkout crashes,
  the PDP buy box intermittently never mounts). Production/staging are
  HTTPS; `launchBrowser` passes one
  `--unsafely-treat-insecure-origin-as-secure` flag with a
  comma-separated origin list (repeating the flag keeps only the last
  value) so the harness matches the production secure context.
- **"No page errors" diagnostics** (`attachDiagnostics` / `diagFailures`)
  record console errors (except "Failed to load resource", which
  duplicates the response entries), uncaught exceptions, failed requests,
  and every HTTP >= 400 with its URL. A small benign list filters
  expected noise: Google Fonts (blocked by the sandbox egress proxy),
  the admin's boot-time session probes (`/auth/refresh`, `/auth/me`,
  `/entitlements/me` 401s before login), `/hr/my/profile` 404s (the
  designed "viewer is not an employee" signal), and `ERR_ABORTED`
  (navigation-cancelled requests). HTTP entries carry the method:
  E5 filters `http 403 POST:` (the subscription guard blocks ALL
  writes while SUSPENDED) but a GET 403 would still fail, and E7
  filters the expected 404 on the unverified host. Everything else
  fails the check.
