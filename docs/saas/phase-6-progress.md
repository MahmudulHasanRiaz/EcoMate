# Phase 6 — SaaS admin completion

The Phase 1 deliverable `apps/platform-admin` was never scaffolded, so it is a
prerequisite for every Phase 6 item. The scaffold is done; items 1–2 are now
complete.

- [x] 1. Tenant detail actions: change plan, extend trial, suspend/reactivate,
      reset owner password, impersonate, export, delete
- [x] 2. Impersonation tokens + tenant exchange endpoint + audit
- [x] 3. Payment proof review queue + approve/reject + invoice/payment ledger
- [x] 4. Subscription/plan change UI, credit notes, coupons
- [ ] 5. Domain management: primary/base/fallback config, tenant domains,
      verification/TLS status, force re-check
- [ ] 6. Usage dashboards + limit overrides
- [ ] 7. Metrics dashboard (MRR/ARR/trials/past-due/churn)
- [ ] 8. Platform settings (payment methods, SMTP, trial/grace, tax, branding,
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

## Next

Item 5: domain management — primary/base/fallback config, tenant domains,
verification/TLS status, force re-check.
