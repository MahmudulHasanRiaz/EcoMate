# Phase 6 — SaaS admin completion

The Phase 1 deliverable `apps/platform-admin` was never scaffolded, so it is a
prerequisite for every Phase 6 item. The scaffold is done; items 1–2 are now
complete.

- [x] 1. Tenant detail actions: change plan, extend trial, suspend/reactivate,
      reset owner password, impersonate, export, delete
- [x] 2. Impersonation tokens + tenant exchange endpoint + audit
- [x] 3. Payment proof review queue + approve/reject + invoice/payment ledger
- [x] 4. Subscription/plan change UI, credit notes, coupons
- [x] 5. Domain management: primary/base/fallback config, tenant domains,
      verification/TLS status, force re-check
- [x] 6. Usage dashboards + limit overrides
- [x] 7. Metrics dashboard (MRR/ARR/trials/past-due/churn)
- [x] 8. Platform settings (payment methods, SMTP, trial/grace, tax, branding,
      domain config)
- [ ] 9. Platform users/roles, audit search/export
- [ ] 10. Acceptance: full tenant lifecycle and billing operated from the SaaS
      admin

## Tenant detail actions — DONE (7/7)

The tenant detail page now has an audited Operations panel:

- **Change plan:** picks any non-archived plan version and calls
  `POST /tenants/:id/change-plan` (snapshot refresh included).
- **Extend trial:** 1–365 days via `POST /tenants/:id/extend-trial`.
- **Suspend/reactivate:** `PATCH /tenants/:id/status`; DELETED tenants get
  Restore instead.
- **Reset owner password:** new `POST /tenants/:id/reset-owner-password`
  platform endpoint → tenant-internal `owner-password-reset` → the tenant's
  existing 6-digit OTP flow. No password crosses the platform.
- **Export:** downloads the Phase 5 JSON export (platform rows + tenant tables)
  with the server filename.
- **Delete:** soft-deletes with confirmation, returns to the filtered list and
  shows the Deleted badge; routing stops immediately.
- **Impersonate:** issues a one-time 64-char token (stored only as SHA-256,
  15-minute TTL) and opens `https://<tenant>/api/auth/impersonate?token=…`.
  The tenant backend exchanges it server-to-server with the platform, which
  atomically revokes it, then sets the tenant admin access cookie and 302s to
  `/admin/`. Replays, wrong tenants, expired/revoked tokens and DELETED tenants
  are refused; create + consume are audited. The console shows a fallback link
  if the popup is blocked.

Verification: platform **135/135**, backend **6268 passed / 10 skipped / 0
failed**, platform-admin vitest **4/4**, builds clean. Live: create → exchange
302 + `eco_mate_access_token` cookie → `/auth/me` returned the owner with 291
permissions; replay redirected to sign-in; platform session revoked; both audit
actions present; console issued the link and opened the popup. Earlier live
actions **7/7** (trial date, plan, suspend/reactivate, reset, 14,732-byte
export, delete). Smoke tenant/admin were purged.

## Impersonation security contract — DONE (item 2)

- Opaque 64-hex token; only its SHA-256 is stored (`tokenJti` unique).
- Tenant-bound: consume requires the same tenant id resolved from the Host.
- One-time: `updateMany` claims `revokedAt=null` + unexpired before issuing.
- Short-lived: 900s default (`IMPERSONATION_TTL_SECONDS`, capped 3600).
- Tenant JWT carries `imp: true` and no refresh token; cookie is JS-readable
  (matching the normal admin contract) with 15-minute max-age.
- Audit: `tenant.impersonate.create` and `tenant.impersonate.consume`.

## Prerequisite — platform-admin scaffold — DONE

- `apps/platform-admin` (Vite 8 + React 19 + TanStack Router, no shared tenant
  admin bundle) with:
  - sessionStorage-backed platform session + automatic access-token refresh;
  - login page (unauth redirect), operator shell, sign out;
  - overview with total/trial/active/attention counts (server meta, not a
    client-side slice of the first page), recent tenants;
  - tenants list with search, status filter and pagination;
  - tenant detail: lifecycle, owner, plan/subscription, domains, billing counts;
  - plans read-only catalog (versions/price/trial/features).
- Same-origin `/api` by default; Vite dev/preview proxies `/api` to
  `PLATFORM_API_PROXY` (`http://localhost:4100`). No CORS surface added to the
  platform API.
- Verification: `tsc -b` clean, production build clean (285 kB JS / 91 kB gzip),
  vitest **4/4**, Playwright browser smoke **10/10** (login redirect, overview
  counts, tenants list, tenant detail, plans, sign out, 390px no overflow).
- The scaffold shipped read-only; the tenant-action panel above is the first
  Phase 6 increment on top of it.

## Payment proof review + ledger — DONE

- Platform API `/api/billing`: summary, methods, proof queue/detail,
  approve/reject, invoices/detail, payments.
- Approve is transactional and race-safe: a conditional `PENDING → APPROVED`
  claim, then a `Payment` row from the proof amount/transaction reference, then
  a payment sum. The invoice becomes `PAID` only when fully covered; a partial
  payment leaves it `OPEN`. Subscription extension is deliberately deferred to
  Phase 7.
- Reject requires a 3–500 char reason, stores `reviewedBy/At/rejectionReason`
  and never creates a payment. Both actions write platform audit rows.
- Ledger lists are tenant-aware and include tenant, invoice, method, proof and
  recorded-by context; invoice detail shows lines, payments, proofs and credit
  notes.
- Console: Billing nav with pending/open/overdue/collected metrics, Proofs /
  Invoices / Payments tabs, inline proof review (approve with confirm, reject
  with reason), invoice detail and payment ledger.
- Verification: platform **141/141**, backend unchanged **6268 passed / 10
  skipped / 0 failed**, platform-admin build + **4/4** tests. Live browser
  **8/8**: two pending proofs → approve paid `INV-BILL-1` and created the
  `1500 BDT` ledger row → reject with “Wrong transaction” → pending queue empty.
  DB ended `INV-BILL-1 PAID`, `INV-BILL-2 OPEN`, collected `1500`, both audit
  rows. Smoke rows/method/admin were purged.

## Subscriptions, credit notes and coupons — DONE

- **Subscriptions:** `/billing/subscriptions` lists tenant, plan version + plan,
  status, billing period and add-ons. The Billing → Subscriptions tab lets an
  operator pick any non-archived plan version for a tenant and applies it via
  the existing `/tenants/:id/change-plan` path (immediate snapshot refresh;
  effective-date/proration policy stays in Phase 7).
- **Credit notes:** `/billing/credit-notes` list + create. A note can be linked
  to an invoice only when the invoice belongs to the same tenant. Invoice detail
  shows its notes and has an “Issue credit note” form; the Credit notes tab
  lists all issued notes. Applying credits to balances is deliberately Phase 7.
- **Coupons:** `/billing/coupons` list + create + activate/deactivate. Codes are
  uppercased, unique, percent values capped at 100, MONTHS requires
  durationMonths, maxRedemptions cannot drop below redeemed count. Every
  create/update is audited.
- Console: six Billing tabs (Proofs / Invoices / Payments / Subscriptions /
  Credit notes / Coupons), plan selector per subscription, invoice-level credit
  form, coupon builder + enable/disable.
- Verification: platform **145/145**, backend unchanged **6268 passed / 10
  skipped / 0 failed**, platform-admin build + **4/4** tests. Live browser
  **5/5**: tenant moved Trial → Pro v1, a 100 BDT credit note was issued from
  `INV-CREDIT-1` and appeared in the credit list, `SAVE20` was created uppercase
  (20%, once, max 5) and disabled. Audit rows and DB state verified; smoke
  tenant/plan/coupon/admin were purged.

## Domain management — DONE

- **Runtime config:** `GET/PATCH /domains/config` reads/writes
  `PlatformSetting.domains` and swaps the in-memory config immediately. The
  update path enforces primary-first base domains, dedupes aliases, validates
  fallback/base rules, derives platform hosts when the primary changes, and is
  audited (`domains.config.update`).
- **Tenant domains:** `GET /domains/tenants` lists all hosts with tenant,
  type/status/TLS, verification token and last-checked timestamp (status +
  search + pagination). `POST /domains/tenants/:id/recheck` forces DNS
  verification and audits the result. Add/remove continue through the existing
  tenant-domain endpoints (global host uniqueness preserved).
- Console: Domains nav with editable primary/base/fallback/CNAME/health
  fields, add-domain form, TXT hint for pending custom hosts, TLS/status/last
  checked columns, re-check and remove actions.
- Verification: platform **149/149**, backend unchanged **6268 passed / 10
  skipped / 0 failed**, platform-admin build + **4/4** tests. Live browser
  **5/5**: config saved without deploy, custom host added PENDING with the TXT
  hint, re-check recorded a real failed DNS attempt, remove cleared it; config
  PATCH wrote `domains.config.update`. Smoke tenant/setting/admin were purged.

## Usage dashboards + limit overrides — DONE

- **One limit catalogue:** `packages/shared-types/src/limits.ts` is now the
  single source of truth (`LIMIT_KEYS`, `LIMIT_LABELS`, `isLimitKey`,
  `coerceLimit`). The tenant runtime re-exports it, and the platform merges
  the same keys, so a typo cannot make the two sides disagree. Anything that
  is not a finite non-negative number is treated as unlimited.
- **Live counters:** the tenant runtime exposes
  `GET /api/internal/usage?tenantId=&slug=` (service-token guarded, executed
  inside `runWithTenant`) returning the existing usage snapshot. The platform
  never counts tenant rows itself.
- **Dhaka-day snapshots:** `POST /usage/tenants/:id/refresh` pulls the counters
  and upserts one `UsageDaily` row per metric and Dhaka calendar day; unknown
  keys and non-numeric counters are rejected instead of silently stored. A
  failed pull writes nothing and reports `HTTP <status>` / the network error.
- **Overrides:** `TenantLimitOverride` (unique `tenantId+key`) wins over the
  plan everywhere — including keys the plan does not define. Set/clear are
  role-gated (`SUPERADMIN`/`BILLING`; reads allow `SUPPORT`), validated against
  the catalogue and audited (`tenant.limit_override.set|clear`, before/after).
  Each write then pushes `POST /entitlements/refresh` to the tenant; a failed
  push keeps the override and is disclosed — the 60s registry poll remains the
  fallback.
- **Merged entitlements:** both `/internal/tenants/registry` and
  `/internal/tenants/:id/entitlements` merge overrides into `plan.limits`, so
  the tenant registry, limit guards and the console all read the same
  effective value. Clearing restores the plan value.
- **API:** `GET /usage/overview?days=`, `GET /usage/tenants/:id?days=`,
  `POST /usage/tenants/:id/refresh`, `POST /usage/refresh` (sequential,
  per-tenant failures itemised) and the override `PUT`/`DELETE`. Windows are
  clamped to 1–90 days (default 30).
- **Console:** a `/usage` nav page (tenants, over-limit/warning/not-collected
  counters, per-metric used/limit + bars, override flags, last collected) and a
  tenant-detail **Usage & limits** table (plan / override / effective / used /
  consumption / snapshot day) with save + clear actions and push-status
  notices. The dashboard sorts over-limit tenants first and flags over-limit
  rows. Narrow screens scroll the table inside its card (`.main` gained
  `min-width: 0` so the grid track can shrink).
- **Migration:** `20261116101222_tenant_limit_overrides` (new table + unique
  index + cascade FK) with a `rollback.sql` that drops only that table.

Verification: shared-types vitest **14/14**, platform **185/185** (23 suites,
+36), backend **6271 passed / 10 skipped / 0 failed** (447 suites, +3),
platform-admin tsc clean + vitest **7/7** + production build clean, backend and
platform `nest build` clean, `prisma migrate status` 4 up-to-date. Live **API
E2E 35/35** and **browser 24/24**: overview before collection showed plan
limits with `—`, the refresh collected the real 2 products / 1 staff row, the
snapshot appeared under the Dhaka day (history read-back), an override of `1`
made the tenant runtime report limit `1`, its product create failed `403 Plan
limit reached for Products (2/1)`, raising the override to `10` made the same
call succeed `201`, a READONLY operator got `403` on read and write, clearing
restored the plan value and the three audit rows carried before/after values.
Smoke tenant counters, snapshots, overrides and audit rows were purged;
services stopped.

## Metrics dashboard — DONE

- **Server-derived only:** `apps/platform-api/src/metrics/` computes every
  figure from stored platform rows (`Subscription`, `Tenant`, `Payment`,
  `Invoice`). Nothing is estimated and no period is invented — a window with no
  data reports zeros, a rate with no base reports `null` (rendered `—`).
- **Money rules (`metrics.compute.ts`):** prices are converted to integer cents
  before any sum, so MRR never drifts. `MONTHLY` keeps the price, `YEARLY` is
  divided by twelve, `CUSTOM` is normalised to 30 days (falling back to the
  monthly value when `intervalDays` is missing). **A paying subscription** is
  `status = ACTIVE`, or a subscription still marked `TRIAL` on a tenant the
  operator activated (`tenant.status = ACTIVE`); terminal subscription states
  (`CANCELLED`/`EXPIRED`/`SUSPENDED`) always win and produce no revenue.
  `PAST_DUE` on either side is reported separately as **at-risk MRR** and is
  never counted as earned. Currencies are kept apart end to end — the payload
  carries a `byCurrency[]` plus a `primaryCurrency`, and the console never adds
  currencies together.
- **Trials:** `active` (status `TRIAL`), `endingSoon` (`trialEndsAt` within
  7 days) and `expired` (`trialEndsAt` in the past without a conversion — the
  actionable leak).
- **Churn:** window-based on `endedAt ?? canceledAt`; the rate is relative to
  the subscriptions live at window start and is `null` when that base is zero.
  Churned tenants are listed with plan, cause and timestamp.
- **Collections:** payments inside the window grouped per currency, open
  invoices split into total vs overdue (`dueAt < now`), plus a six-month series
  of `collected` (primary currency only), `newTenants`, `newSubscriptions` and
  `churned` keyed by Dhaka month.
- **Clock seam:** `METRICS_CLOCK` is an injected provider (`() => new Date()` by
  default) so window/month maths is deterministic in tests.
- **API:** `GET /metrics/overview?window=` — window clamped to 1–365 days
  (default 30); a non-numeric window falls back to the default instead of being
  forwarded raw. Read roles are `SUPERADMIN`/`BILLING`/`SUPPORT` (`READONLY`
  gets `403`).
- **Console:** `/metrics` nav page — eight KPI cards (MRR, ARR, paying subs +
  conversion, past-due at-risk, active trials, expired trials, churn rate, open
  invoices), revenue-by-currency table (headline currency flagged, paying-basis
  disclosure), subscription status distribution with share bars, collections +
  outstanding panel, six-month trend with scaled bars and per-month deltas, top
  plans by MRR, and the churn list linking into each tenant. Window presets
  (`7d/30d/90d/1y`) refetch; the layout collapses to 2 columns and then 1 at
  narrow widths with no horizontal overflow.

Verification: platform **220/220** (26 suites, +35), platform-admin tsc clean +
vitest **12/12** + production build clean, platform `nest build` clean,
backend **6271 passed / 10 skipped / 0 failed** (447 suites, unchanged),
storefront **699/699**, shared-types **14/14**, `prisma migrate status`
4 up-to-date (no schema change in this item). Live **API E2E 48/48**: three
plans created through `POST /plans` and seven tenants through `POST /tenants`
(real TRIAL subscriptions), then subscription/tenant lifecycle states, a
backdated signup history, a payment method, two open invoices and four payments
were set up, asserting `MRR 5,500 / ARR 66,000` in BDT (2 subscription-based +
1 operator-activated tenant), `atRiskMrr 1,500`, status counts
(2/3/1/0/0/1), `trials {3,1,1}`, `churn {1,7,14%}`, conversion `3/7 = 43%`,
collections `BDT 2,000 (2) + $20 (1)`, outstanding `5,000 open / 2,000
overdue`, the six-month series (`700` Sep, `500` Oct, `1,500` Nov; `+5` subs
Jul, `+2` Oct; `−1` churn Nov) and top plans `3,000 / 1,500 / 1,000` (the
yearly plan correctly shown as its monthly equivalent). Window edges
(`0 → 1`, `9999 → 365`, `abc → 30`) and the role boundary (`READONLY → 403`,
anonymous `401`) were checked. Live **browser 39/39** on `/metrics`
(sidebar entry, all cards, both tables, status bars, six scaled series bars,
churn list, preset refetch `window=90`, no horizontal overflow at 390px — no
page errors). The live run caught a real bug: Prisma hands a price back as a
`Decimal` object, which the cents helper silently read as free (MRR showed `0`
with 3 paying subscriptions); prices are now coerced through their string form
(fixed + unit-tested). All smoke tenants, plans, invoices, payments, method and
the READONLY account were purged; services stopped.

## Platform settings — DONE

- **Settings service (`apps/platform-api/src/settings/settings.service.ts`):**
  five typed sections over the generic `PlatformSetting` key-value store —
  `smtp`, `trial_defaults`, `tax`, `branding`, `maintenance` — following the
  item-5 `domains` precedent (env bootstrap, DB override, in-memory cache
  swapped immediately on update). No migration: new keys need none.
- **Payment methods:** `POST/PATCH/DELETE /billing/methods`
  (`SUPERADMIN`/`BILLING`; the existing `GET` stays open to all roles).
  Delete is refused with `409` while proofs or payments reference the method
  (deactivate instead); the DB relation is `Restrict` as a backstop. Every
  write is audited with before/after.
- **SMTP:** the mail service is now lazy — the transporter is built on first
  use from the *effective* config and dropped by `refresh()` after a settings
  change. Precedence is env-wins (same rule as `DEFAULT_PLAN_VERSION_ID`):
  `SMTP_HOST` set means env, otherwise the stored setting, otherwise
  unconfigured. `POST /settings/smtp/test` sends a real test email. The
  password is never returned by any read endpoint. Dev log fallback and the
  production fail-closed behaviour are unchanged.
- **Trial/grace defaults:** `trialDays` (0–365) and `graceDays` (0–90) wired
  into plan creation, plan-version creation and tenant creation, in that
  order: explicit DTO value → plan version value → global setting → hardcoded
  14/7 fallback. Provisioning already reads the plan version's value, so it
  needed no change. The grace *workflow* (expiry enforcement, dunning) is
  Phase 7, not this item.
- **Tax:** stored + validated + audited (`ratePercent` 0–100, label,
  inclusive flag). It has no consumer yet — it takes effect when invoice
  generation lands in Phase 7.
- **Branding:** `platformName` (default `EcoMate`), `supportEmail`, `logoUrl`.
  Consumers in this item are the platform emails only: the from display name
  uses the platform name and the support address becomes the reply-to.
  `logoUrl` is stored for later use in the console/landing.
- **Domain config:** not rebuilt — done under item 5. The settings page links
  to `/domains` instead of duplicating the form.
- **Maintenance:** a global `MaintenanceGuard` (registered via `APP_GUARD`).
  While enabled, non-GET requests get `503` with the operator's message,
  except auth, health, internal registry/entitlement endpoints, and settings
  itself (so SUPERADMIN can turn it off). Reads always pass. This is
  platform-plane maintenance only; tenant storefront maintenance is separate.
- **API:** `GET /settings` (one payload, SMTP without the password),
  `PATCH /settings/smtp|trial|tax|branding|maintenance` (`SUPERADMIN` only),
  `POST /settings/smtp/test` (`SUPERADMIN`). Reads are
  `SUPERADMIN`/`BILLING`/`SUPPORT`. Every write is audited
  (`settings.<section>.update`, entity `PlatformSetting`).
- **Console:** `/settings` nav page — payment-method table + add/edit form
  (type, name, account, instructions, QR URL, sort order, activate/deactivate,
  delete with the 409 surfaced), SMTP form + configured badge + source label
  (env vs setting) + test-email sender, trial/grace, tax, branding and
  maintenance cards, plus a Domains link card. A banner warns while
  maintenance is on.
- **Empty-string trap (found by the browser smoke):** class-validator's
  `@IsOptional` does not skip `''`, so optional `@IsEmail`/`@IsUrl` fields
  400'd when the console sent an empty string. The optional email/URL fields
  now use `@ValidateIf((o) => o.field !== '')`, so `''` clears the value and
  a non-empty value is validated. Locked by live E2E checks.
- **Known limits:** there is no UI affordance to *unset* SMTP once stored
  (host is required on save); clearing it needs a DB edit. Tax has no
  consumer until Phase 7. `logoUrl` has no renderer yet.

Verification: platform **260/260** (31 suites, +40: settings service 13,
settings controller 4, maintenance guard 5, billing methods 7, mail service 6,
plans trial-defaults 3, tenants trial-defaults 2), platform `nest build`
clean, platform-admin tsc clean + vitest **15/15** + production build clean,
backend **6271 passed / 10 skipped / 0 failed** (447 suites, unchanged),
storefront **699/699**, shared-types **14/14**, `prisma migrate status`
4 up-to-date (no schema change in this item). Live **API E2E 32/32**: login,
anonymous `401`, defaults `14/7` + SMTP unconfigured, trial defaults changed
to `21/5` and a new plan version inheriting them, payment-method create/list/
update/deactivate + invalid type `400` + empty-URL clear, SMTP pointed at a
local catcher with a test email received (branding name + support reply-to
verified in the raw message), tax save + rate `150 → 400`, maintenance on
(write `503` with the message, reads pass, settings escape hatch works),
writes working again after off, both methods deleted, second delete `404`.
Live **browser 16/16** on `/settings` (login, nav entry, all seven sections,
trial save + persist after reload, method add/list/delete through the UI,
trial restored). All smoke plans, methods, settings keys and audit rows were
purged; services stopped.

## Next

Item 9: platform users/roles, audit search/export.
