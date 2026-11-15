# Phase 4 progress — tenant host resolution & domains

Branch: `feat/saas-multitenant`
Rule: one unit at a time. Each unit gets acceptance tests, a commit and a
push; the checkbox is ticked in the same commit.

- [x] 1. Storefront/admin/POS host→tenant resolution + SSR tenant header
- [x] 2. Base-domain aliases + canonical 301 + alias noindex
- [x] 3. Custom-domain add/verify + DNS polling + Caddy on-demand TLS ask endpoint
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

### 2. Base-domain aliases + canonical 301 + alias noindex — DONE

- Storefront resolver (`lib/tenant-host.ts`) maps `{slug}.{base}` for every
  configured base domain; a non-primary base is an alias with
  `canonicalHost = {slug}.<primary>`.
- `proxy.ts` now runs on all page paths (not just `/landing`) and 301s alias
  hosts to the canonical host with path + query preserved and
  `X-Robots-Tag: noindex`; `/api`, `/_next`, `/uploads`, `/assets` are exempt so
  integrations and API clients keep working on aliases. The 301 runs before the
  landing CSP branch; canonical landing pages keep their CSP.
- Backend `TenantMiddleware` adds `X-Robots-Tag: noindex` for alias hosts on
  every tenant response path (uploads/API included).
- Admin and POS nginx send `X-Robots-Tag: noindex` unconditionally (they are
  never index targets). Alias 301 for admin/POS is enforced by the edge proxy
  introduced with the custom-domain/Caddy unit; when `/admin` or `/pos` is
  routed through Next (prod POS rewrite, dev admin rewrite) the storefront proxy
  already 301s them too.
- Companion config: `SAAS_PRIMARY_DOMAIN`, `SAAS_BASE_DOMAINS`,
  `SAAS_FALLBACK_DOMAIN`, `SAAS_CUSTOM_DOMAIN_CNAME`,
  `SAAS_ALLOW_EXTERNAL_FALLBACK` are now passed to backend + storefront in
  `docker-compose.yml` and exposed in `portainer/portainer-stack.json`; without
  them both services silently fell back to `ecomate.bd`.
- Acceptance: backend 6236 passed / 10 skipped / 0 failed (1 new middleware
  test), `nest build` clean; storefront 679/679 passed (11 new alias/proxy
  tests), `tsc` clean, `next build` exit 0; `docker compose config` valid.
  (First backend run hit a stopped test PG cluster — rerun with the DB up was
  green; no code change was needed.)

### 3. Custom-domain add/verify + DNS polling + Caddy on-demand TLS — DONE

- API (platform control plane, same SUPERADMIN/BILLING/SUPPORT roles as tenant
  management):
  - `GET  /api/tenants/:id/domains`
  - `POST /api/tenants/:id/domains` -> domain + DNS instructions
  - `POST /api/tenants/:id/domains/:domainId/verify` (immediate check)
  - `DELETE /api/tenants/:id/domains/:domainId`
- Add validation: public hostname only (no IP/localhost/`.local`/`.internal`),
  custom hosts must be outside the platform base domains, duplicate host = 409,
  and `custom_domain` (or `*`) is required when the tenant has a plan. A missing
  `type` is inferred: the tenant's own `{slug}.<base>` becomes SUBDOMAIN, all
  other hosts CUSTOM (old subdomain callers keep working).
- DNS proof (both required): `CNAME <host> -> SAAS_CUSTOM_DOMAIN_CNAME` and
  `TXT _ecomate-verify.<host> = verificationToken` (24 random bytes). Success
  sets `VERIFIED`, `verifiedAt`, `tlsStatus=PENDING`, makes it the tenant's
  primary domain (all other domains `isPrimary=false`); failure records
  `lastCheckedAt` and returns the per-record checks, leaving it PENDING.
- Background polling (`DomainVerificationService`): checks CUSTOM PENDING/FAILED
  domains (including `lastCheckedAt = null`) once per window, 25 per batch, one
  failure never aborts the batch. `CUSTOM_DOMAIN_POLL_MS` (default 60s, min 10s)
  and `CUSTOM_DOMAIN_POLL_ENABLED=false` to disable.
- Caddy on-demand TLS: `GET /api/internal/tls/allow?domain=&token=` (token =
  `TLS_ASK_TOKEN`, fallback `INTERNAL_SERVICE_SECRET`; unset = 503 fail-closed).
  200 only for SUBDOMAIN hosts of non-deleted tenants and VERIFIED/ACTIVE CUSTOM
  domains; every other host is 404 so no certificate is issued. Reference edge
  config: `portainer/Caddyfile` (Caddy appends `domain=` to the ask URL).
- Tenant reachability: a verified custom domain enters the tenant registry via
  the existing 60s registry poll (`status=VERIFIED` domains are included).
- Acceptance: platform-api jest 54/54 passed, `nest build` clean. No tenant DB
  or tenant-app change was needed; no Prisma migration (TenantDomain fields
  already exist in the platform baseline).
- Caveat: the platform UI for adding/managing custom domains is API-only until
  the platform-admin app lands; domain verification ships without it.
