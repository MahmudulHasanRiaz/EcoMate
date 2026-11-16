# Phase 6 — SaaS admin completion

The Phase 1 deliverable `apps/platform-admin` was never scaffolded, so it is a
prerequisite for every Phase 6 item. The scaffold unit is done; no Phase 6
checkbox below is ticked yet.

- [ ] 1. Tenant detail actions: change plan, extend trial, suspend/reactivate,
      reset owner password, impersonate, export, delete
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
- This unit is intentionally read-only: every Phase 6 action still requires the
  API/UI work listed above. Next up is item 1 (tenant detail actions), with
  impersonation landing in item 2.
