# Phase 4 progress — tenant host resolution & domains

Branch: `feat/saas-multitenant`
Rule: one unit at a time. Each unit gets acceptance tests, a commit and a
push; the checkbox is ticked in the same commit.

- [x] 1. Storefront/admin/POS host→tenant resolution + SSR tenant header
- [ ] 2. Base-domain aliases + canonical 301 + alias noindex
- [ ] 3. Custom-domain add/verify + DNS polling + Caddy on-demand TLS ask endpoint
- [ ] 4. Fallback-domain behavior + absolute URLs/health; unknown host must never route to a tenant
- [ ] 5. Tenant-scoped cache tags/revalidation + no cross-host leakage
- [ ] 6. Two-tenant browser E2E + custom-domain mock E2E

## Unit log

### 1. Host→tenant resolution + SSR tenant header — DONE

- Browser apps (storefront, admin, POS) resolve the tenant from the `Host`
  header they were served on — no client-side tenant picker, no spoofable
  header.
- `x-tenant-host` is now trusted **only** when the request also carries a
  valid `x-internal-secret` from a private peer (`isInternalRequest`), closing
  the cross-tenant RLS switch that an unconditional override allowed.
- Storefront `serverFetch` forwards `x-tenant-host` + `x-internal-secret` for
  every SSR call; outside a request scope (build/scripts) the host header is
  omitted instead of crashing. Caller headers are merged, not dropped.
- `combos/[id]`'s direct server `fetch` moved onto `serverFetch`; the unused
  module-level `lib/menu-categories.ts` cache (cross-tenant leak risk) was
  deleted.
- Acceptance: backend 6235 passed / 10 skipped / 0 failed (6 new middleware
  tests), `nest build` clean; storefront 668/668 passed (4 new header tests),
  `tsc` clean, `next build` exit 0.
