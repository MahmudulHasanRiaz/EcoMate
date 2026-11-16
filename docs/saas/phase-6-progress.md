# Phase 6 — SaaS admin completion

The Phase 1 deliverable `apps/platform-admin` was never scaffolded, so it is a
prerequisite for every Phase 6 item. The scaffold is done; items 1–2 are now
complete.

- [x] 1. Tenant detail actions: change plan, extend trial, suspend/reactivate,
      reset owner password, impersonate, export, delete
- [x] 2. Impersonation tokens + tenant exchange endpoint + audit
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

## Next

Item 3: payment proof review queue + approve/reject + invoice/payment ledger.
