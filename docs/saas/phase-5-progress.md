# Phase 5 progress — signup & provisioning

Branch: `feat/saas-multitenant`
Rule: one unit at a time, tests + commit per unit. Full Phase 5 spans a new
public app, two databases and background provisioning; the slices below are
tracked separately.

- [x] 1. Landing signup wizard + email verification + CAPTCHA/rate limit
- [x] 2. Slug validation (3–30, lowercase, reserved list, uniqueness)
- [x] 3. Provisioning job: tenant row → tenant seed → owner → subdomains →
      trial subscription → entitlement snapshot → welcome email
- [ ] 4. `TenantBootstrapService`: roles/permissions, order statuses, payment
      options, system settings, default warehouse/store, email templates, legal
      pages, sample data off by default
- [ ] 5. Idempotent retries, rollback on failure, provisioning progress API/UI
- [ ] 6. Tenant soft delete/export/purge job (30-day retention)
- [ ] 7. Trial abuse controls (disposable email, phone/domain dedupe)

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

### 4–7. Remaining bootstrap, lifecycle and abuse — NOT STARTED (4 partially done)

Core bootstrap (owner, statuses/transitions, core settings, warehouse, payment)
landed with item 3. Remaining Phase 5 work:

- Item 4 completeness: role presets/permission defaults beyond the owner,
  email templates, legal/CMS pages, and explicit sample-data-off coverage.
- Item 5: landing progress UI wired to the status endpoint, admin retry/rollback
  surface, and a stale-job sweeper.
- Item 6: soft delete/export/purge (30-day retention) with dependency-ordered
  tenant export.
- Item 7: disposable-email list plus phone/domain dedupe before provisioning.

**Acceptance status:** signup → email verification → automatic provisioning is
now real end-to-end (tenant rows + seeded tenant DB + registry resolution), so a
new user reaches a provisioned workspace without manual intervention. Phase 5 is
still **not complete** until items 4–7 land (lifecycle/export/abuse/UI).
