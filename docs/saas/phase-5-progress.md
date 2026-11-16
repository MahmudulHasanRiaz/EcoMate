# Phase 5 progress — signup & provisioning

Branch: `feat/saas-multitenant`
Rule: one unit at a time, tests + commit per unit. Full Phase 5 spans a new
public app, two databases and background provisioning; the slices below are
tracked separately.

- [x] 1. Landing signup wizard + email verification + CAPTCHA/rate limit
- [x] 2. Slug validation (3–30, lowercase, reserved list, uniqueness)
- [x] 3. Provisioning job: tenant row → tenant seed → owner → subdomains →
      trial subscription → entitlement snapshot → welcome email
- [x] 4. `TenantBootstrapService`: roles/permissions, order statuses, payment
      options, system settings, default warehouse/store, email templates, legal
      pages, sample data off by default
- [x] 5. Idempotent retries, rollback on failure, provisioning progress API/UI
- [x] 6. Tenant soft delete/export/purge job (30-day retention)
- [x] 7. Trial abuse controls (disposable email, phone/domain dedupe)

## Unit log

### 1–2. Signup, email verification, CAPTCHA/rate limits, slug validation — DONE

- New public app `apps/landing` (Next 16, standalone): landing page, 3-step
  signup wizard (store → account → review), client-side validation, Cloudflare
  Turnstile widget when configured, `/verify-email` confirmation page, and a
  resend flow. Browser calls are same-origin `/api/*` and rewritten to the
  platform API (`PLATFORM_API_URL`), so no CORS is exposed.
- Platform API `apps/platform-api/src/signup/`:
  - `POST /api/public/signup` — validates the honeypot, CAPTCHA, slug, email
    and password, rejects existing tenant slugs/emails and pending signups,
    stores a bcrypt password hash + SHA-256 verification-token hash (24h TTL),
    sends the verification email, and never returns the token.
  - `GET /api/public/signup/verify?token=` — verifies once, is idempotent after
    success, and returns 410 for expired links.
  - `POST /api/public/signup/resend` — generic response (no account
    enumeration), new token, previous link restored if the email fails.
- Slug rules: 3–30 lowercase letters/numbers/hyphens, no leading/trailing
  hyphen, platform reserved list shared with host resolution, uniqueness across
  `Tenant` and pending/verified `SignupRequest` rows.
- Abuse controls: per-IP (5 / 10 min) and per-email (3 / hour) in-memory
  sliding windows, honeypot field, optional Turnstile (production fails closed
  without `TURNSTILE_SECRET_KEY`), and a verification-token expiry sweep.
- Mail: platform SMTP (`SMTP_*`/`PLATFORM_MAIL_FROM`); in development without
  SMTP the verification link is logged, production fails closed.
- Schema: new `SignupRequest` model + `SignupStatus` enum, migration
  `0002_signup_request`. Applied to a disposable platform DB.
- Pre-existing boot blocker fixed: platform `AuthModule` is now `@Global()`, so
  guarded modules can resolve `JwtService`/`PlatformAuthGuard` at runtime.
- Verification:
  - platform-api jest **95/95** (35 new signup tests), `nest build` clean;
  - landing **5/5** tests, `tsc` clean, `next build` exit 0;
  - migration `0001` + `0002` applied to a fresh platform DB;
  - live smoke: signup 201 → verify 200 → repeat verify 200 (idempotent) →
    duplicate slug 409 → honeypot 400 → resend 200; DB row `VERIFIED` with a
    64-char token hash.

### 3. Provisioning job + core tenant bootstrap — DONE

- `ProvisioningService` (platform API) runs after email verification:
  resolves a plan (explicit `DEFAULT_PLAN_VERSION_ID`/PlatformSetting, else the
  newest active version), creates the `Tenant` (PROVISIONING) + primary
  `TenantDomain` (ACTIVE) + TRIAL `Subscription` with an entitlement snapshot in
  one nested write, then creates a `ProvisioningJob` (unique `signupId`).
- The job calls the tenant backend's new internal endpoint
  `POST /internal/provisioning` (`x-platform-service-token`, `@SkipTenant`,
  explicit `runWithTenant`). The backend `TenantBootstrapService` seeds:
  owner `superadmin` (bcrypt hash from signup, verified), 16 order statuses with
  the runtime transition map, 10 core system settings (store identity, currency,
  delivery, search indexing off, canonical/storefront URL), the default
  `main-showroom` warehouse, the global COD payment option and a tenant cash
  gateway. All steps are find-first/create-only, so retries are idempotent.
- On success: tenant → TRIAL, job → SUCCEEDED with step `completed`, welcome
  email sent (dev logs the admin URL); a welcome-email failure is disclosed as
  `completed_without_welcome_email` without failing provisioning.
- Failures leave the tenant in PROVISIONING and record `status=FAILED`,
  `step=failed`, `error`, `attempts`; `retry(jobId)` resets and re-runs. Verify
  is idempotent and resumes a missing job if the platform restarted mid-flow.
- New public `GET /api/public/signup/status?token=` exposes signup + job
  status/step for the landing progress UI.
- Trial plan: platform seed now creates a free, non-public `trial` plan
  (version 1, features `['*']`, 14-day trial) so self-serve provisioning works
  on a fresh platform DB.
- Verification: platform **103/103** (8 new provisioning tests), backend
  **6253 passed / 10 skipped / 0 failed** (3 new bootstrap tests), both builds
  clean; migration `0003_provisioning_job_signup` applied.
- Live E2E on the real services: signup → verify → job SUCCEEDED (attempt 1) →
  platform tenant TRIAL + domain ACTIVE + TRIAL subscription snapshot; tenant DB
  owner `superadmin`, 16 statuses, 10 settings, warehouse, cash gateway;
  `store_name`/`canonical_domain`/`storefront_url` correct; welcome admin URL
  logged; after registry sync, `GET /api/tenants/resolve?host=<slug>.ecomate.bd`
  returned 200. Smoke rows were purged afterwards.

### 4. Tenant bootstrap completeness — DONE

Extended `TenantBootstrapService` in the same provisioning path:

- **Roles/permissions:** two built-in system presets per tenant — `Manager`
  (all 291 catalogue permissions) and `Staff` (the 4 employee defaults), both
  `isSystem: true` so the preset editor protects them. Employee creation now
  resolves the tenant-scoped `Manager` preset by name when the legacy fixed-id
  preset is absent (a shared PK cannot repeat per tenant).
- **Stores:** default `main-showroom` warehouse plus a `Main Store` storefront
  location (SHOWROOM, Dhaka).
- **Email templates:** tenant-neutral `Order Confirmation` and `Welcome`
  templates with `{{variable}}` placeholders.
- **Legal/template pages:** reuses `CmsPagesService.ensureTemplatePages()` after
  settings are written, creating all 13 system pages (about, contact, FAQ,
  stores, delivery areas, terms, privacy, refund, exchange, shipping, careers,
  company, download) as editable, empty, tenant-neutral rows.
- **Sample data:** never seeded — no products/categories/orders; demo data
  remains an explicit import action.
- All steps remain find-first/create-only, so retries create nothing.
- Verification: targeted **159/159**; full backend **6255 passed / 10 skipped /
  0 failed**; build clean. Live bootstrap on the real tenant DB: first call
  created 2 presets, 16 statuses, 10 settings, 1 warehouse, 1 store, 2
  templates, 13 pages (incl. privacy/terms/refund/shipping), 0 products; second
  call returned all-zero creates. Smoke rows were purged (2 tenants).

### 5. Retries, rollback and progress — DONE

- **No half-live tenants:** the primary `TenantDomain` is created `PENDING` and
  only flips to `ACTIVE` after the tenant seed, welcome-email attempt and
  `Tenant.status = TRIAL`. Until then the registry cannot route the host.
- **Rollback:** on a failed bootstrap the platform calls the new tenant-internal
  `POST /internal/provisioning/rollback`, which deletes only seed rows (pages,
  templates, presets, gateways, statuses, settings, stores, warehouse, owner).
  It refuses with 409 once the tenant has any order/product/employee, so real
  data can never be erased. Platform tenant/domain/subscription and the FAILED
  job stay for a retry.
- **Retry:** `POST /api/public/signup/retry` (token-gated, 5/hour) resumes a
  FAILED job in the background; retries reset the domain to PENDING and the
  create-only seed makes every step safe to repeat.
- **Progress API/UI:** `GET /api/public/signup/status` now returns tenant status,
  job status/step/attempts and absolute admin/storefront URLs. The landing
  verify page polls it every 2s, renders four steps (verified → workspace →
  preparing → ready), shows admin/storefront links on success and a “Try again”
  action on failure. A stale-job sweeper (`PROVISIONING_STALE_MS`, default
  10 min, 60s interval + startup pass) turns a RUNNING job orphaned by a
  platform restart into a retryable FAILED job.
- Verification: platform **108/108**; backend **6257 passed / 10 skipped /
  0 failed**; landing **10/10**, typecheck + `next build` clean. Live: bootstrap
  → rollback returned deleted 13 pages/2 templates/2 presets/1 gateway/16
  statuses/10 settings/1 store/1 warehouse/1 user and left zero rows; a second
  bootstrap recreated everything. Browser E2E **8/8**: real verify→provision
  showed four done steps + tenant admin/storefront URLs; a mocked FAILED job
  showed retry and reached ready after “Try again”. Live platform row ended
  TRIAL / ACTIVE domain / SUCCEEDED job. Smoke rows were purged.

### 6. Soft delete, export and purge — DONE

- **Soft delete/restore:** `DELETE /api/tenants/:id` sets `status=DELETED` +
  `deletedAt` and returns the 30-day `purgeAfter`; the registry and TLS ask
  already exclude DELETED tenants. `POST /api/tenants/:id/restore` works inside
  the window and returns 410 after it. Both are audited.
- **Dependency-ordered export:** the tenant backend discovers every public
  table with a `tenant_id` (200 at current schema), topologically orders them
  by FK edges, and exports parent-first via `row_to_json` (per-table cap
  `TENANT_EXPORT_MAX_ROWS`, abort rather than truncate). The platform combines
  that with its own tenant/domains/subscription/invoices/payments/audit rows and
  writes one JSON file under `TENANT_EXPORT_DIR`; `GET /api/tenants/:id/export`
  downloads it.
- **Purge job:** every `TENANT_PURGE_INTERVAL_MS` (default 6h, startup pass,
  `TENANT_PURGE_ENABLED=false` kill switch) finds DELETED tenants past
  `TENANT_RETENTION_DAYS` (default 30), exports first, calls the tenant-internal
  `POST /internal/provisioning/purge` (reverse dependency order; only
  tenant-scoped rows), then deletes the platform row. A failed export or tenant
  purge aborts and retries next sweep; the export file is kept. Audit rows
  survive with `tenantId=null`.
- Verification: platform **115/115**; backend **6260 passed / 10 skipped /
  0 failed**. Live: soft delete returned `purgeAfter` and registry stopped
  listing the host; export downloaded 33,662 bytes / 200 tables / 13 pages;
  early purge returned 400; after backdating 31 days purge returned 201 with 47
  tenant rows removed, platform tenant gone, tenant DB counts zero, and the
  `tenant.purge` audit retained. Smoke rows/export files were purged.

### 7. Trial abuse controls — DONE

- **Disposable email:** built-in provider list (mailinator, yopmail, temp-mail,
  guerrillamail, …) plus `SIGNUP_DISPOSABLE_DOMAINS` extras; exact domains and
  their subdomains are rejected at signup with a 400 before any row/email is
  written.
- **Phone dedupe:** phone variants (`+880…`, `880…`, `0…`, spacing/punctuation)
  are checked against every tenant and every PENDING/VERIFIED signup; new
  signups store a canonical `+<digits>` form so later attempts match regardless
  of formatting. A blocked phone returns 409 with a support message.
- **Domain dedupe:** `TenantDomain.host` is globally unique and `addDomain`
  maps `P2002` to a 409, so a verified/pending custom domain (or subdomain)
  cannot be claimed by another tenant; deleted tenants keep their row until the
  purge job, so the domain stays reserved through the 30-day window.
- Verification: platform **128/128** (backend unchanged **6260 passed / 10
  skipped / 0 failed**). Live: disposable `mailinator.com` → 400; first phone
  `+8801700000001` → 201; second signup with `01700000001` → 409; adding
  `shop-dedupe.example.com` to tenant A → 201, same host on tenant B → 409.
  Abuse-smoke rows/domains/admin were purged.

## Phase 5 completion notes

All seven items are done. The end-to-end acceptance now holds: signup → email
verification → provisioning job → seeded tenant DB → registry resolution →
landing progress with admin/storefront links, plus rollback/retry, lifecycle
export/purge, and trial abuse controls.

Carry these caveats into the final SaaS report:

- Entitlement refresh is periodic (60s) per platform/tenant instance plus
  request-time reads; multi-instance convergence is eventual, not instant.
- Historical repository docs (pre-SaaS license activation, legacy volume names)
  remain in the tree for reference; `SAAS.md`, `docs/saas/phase-3-report.md` and
  this progress log are the current source of truth.
- Production signup/welcome mail needs SMTP; without it signup fails closed
  (development logs the verification link instead).
- Custom domains need real DNS; the background verifier and Caddy on-demand TLS
  only admit verified hosts.
- Export files are only as durable as `TENANT_EXPORT_DIR`; mount a persistent
  volume in production.

**Acceptance status:** Phase 5 is **complete (7/7)**.
