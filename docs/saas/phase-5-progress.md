# Phase 5 progress — signup & provisioning

Branch: `feat/saas-multitenant`
Rule: one unit at a time, tests + commit per unit. Full Phase 5 spans a new
public app, two databases and background provisioning; the slices below are
tracked separately.

- [x] 1. Landing signup wizard + email verification + CAPTCHA/rate limit
- [x] 2. Slug validation (3–30, lowercase, reserved list, uniqueness)
- [ ] 3. Provisioning job: tenant row → tenant seed → owner → subdomains →
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

### 3–7. Provisioning, bootstrap, lifecycle and abuse — NOT STARTED

These remain and are the reason Phase 5 is not complete yet:

- Provisioning needs the platform → tenant-backend contract (create owner,
  statuses, payment options, settings, warehouse, templates, legal pages) and a
  job runner with retries/rollback; it must be idempotent per tenant.
- The landing progress page/API depends on that job.
- Soft delete/export/purge needs a dependency-ordered tenant export and a
  30-day purge job.
- Trial-abuse controls need a disposable-domain list plus phone/domain dedupe
  before the first tenant is provisioned.

**Acceptance status:** a new user can sign up and verify their email today, but
is not yet provisioned into a working admin/storefront. Full Phase 5 acceptance
(“sign up → working store without manual intervention”) is therefore **not met
yet**; do not merge Phase 5 as complete until items 3–7 land.
