# Phase 6 — SaaS admin completion

The Phase 1 deliverable `apps/platform-admin` was never scaffolded, so it is a
prerequisite for every Phase 6 item. The scaffold unit is done; no Phase 6
checkbox below is ticked yet.

- [ ] 1. Tenant detail actions: change plan, extend trial, suspend/reactivate,
      reset owner password, impersonate, export, delete
      — **6/7 done**; impersonation waits for item 2 (exchange flow).
- [ ] 2. Impersonation tokens + tenant exchange endpoint + audit
- [ ] 3. Payment proof review queue + approve/reject + invoice/payment ledger
- [ ] 4. Subscription/plan change UI, credit notes, coupons
- [ ] 5. Domain management: primary/base/fallback config, tenant domains,
      verification/TLS status, force re-check
- [ ] 6. Usage dashboards + limit overrides
- [ ] 7. Metrics dashboard (MRR/ARR/trials/past-due/churn)
- [ ] 8. Platform settings (payment methods, SMTP, trial/grace, tax, branding,
      domain config)
- [ ] 9. Platform users/roles, audit search/export
- [ ] 10. Acceptance: full tenant lifecycle and billing operated from the SaaS
      admin

## Tenant detail actions — PARTIAL (6/7)

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
- **Impersonate is not wired yet** — it belongs to item 2 (one-time token +
  tenant exchange + audit). Until that lands, item 1 cannot be ticked.

Verification: platform **130/130**, backend **6262 passed / 10 skipped / 0
failed**, platform-admin vitest **4/4**, builds clean. Live browser **7/7**:
extend-trial changed the date, change-plan succeeded, suspend/reactivate badges
updated, reset code triggered, export downloaded 14,732 bytes of platform +
tenant data, and soft-delete returned the list with a Deleted badge. Smoke
tenants/admin were purged.

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

## Next

Item 2 (impersonation tokens + tenant exchange + audit) completes the last
tenant action; after it, item 1 can be ticked.
