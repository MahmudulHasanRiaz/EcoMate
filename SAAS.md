# EcoMate SaaS — Platform Notes

**Status:** Phase 0 (repo split + guardrails) complete; multi-tenant conversion in progress on `feat/saas-multitenant`.

## Scope

- **Initial conversion:** the current `main` codebase only. It becomes the multi-tenant SaaS product.
- **Central commerce / multi-store:** deferred. The upstream `feat/central-commerce` branch is still in development; it will be ported later as additive migrations with `tenant_id` + RLS from its first migration.
- **No existing client data:** the SaaS starts with a fresh baseline; there is no backfill.
- **License server:** KeyMate/Keygen is being removed. Plans and features come from the platform control plane.

## Target architecture

```
Landing / SaaS admin / platform API  ->  ecomate_platform DB
Tenant hosts (subdomain / custom)    ->  backend + storefront + admin/POS
                                         ->  ecomate DB (shared, tenant_id + RLS)
```

- One pooled backend serves all tenants; tenant context comes from `Host` and lives in `AsyncLocalStorage`.
- Every tenant table has `tenant_id`; PostgreSQL RLS is the hard isolation boundary.
- Platform API/admin/landing are separate apps (Phase 1).
- Storefront is host-aware and uses tenant-scoped cache tags.

## Domains

| Item | Default / rule |
|---|---|
| Primary domain | `ecomate.bd` |
| Tenant subdomain | `{slug}.ecomate.bd` |
| Additional base domains | `SAAS_BASE_DOMAINS` (ordered; first must equal primary); can be added at runtime |
| Fallback domain | `SAAS_FALLBACK_DOMAIN`; a separate registered domain is recommended; must be in the base list unless `SAAS_ALLOW_EXTERNAL_FALLBACK=true` |
| Custom-domain CNAME | `cname.ecomate.bd` (`SAAS_CUSTOM_DOMAIN_CNAME`) |
| Platform hosts | `www.ecomate.bd` (landing), `saas.ecomate.bd` (platform admin), `api.ecomate.bd` (platform API/webhooks) |
| Reserved slugs | `www`, `api`, `saas`, `admin`, `app`, `status`, `docs`, `mail`, `webhooks`, `cname` |

Canonical host preference: a verified custom domain (when the tenant's plan includes `custom_domain`) → `{slug}.ecomate.bd`. Alias hosts 301 to the canonical host for storefront/admin/POS; `/api` answers on aliases. Unknown hosts never fall back to another tenant.

The bootstrap values live in `.env.example`; runtime values live in the platform DB `PlatformSetting.domains` and are editable from the SaaS admin.

## Important environment variables

```bash
SAAS_PRIMARY_DOMAIN=ecomate.bd
SAAS_BASE_DOMAINS=ecomate.bd
SAAS_FALLBACK_DOMAIN=
SAAS_CUSTOM_DOMAIN_CNAME=cname.ecomate.bd
SAAS_ALLOW_EXTERNAL_FALLBACK=false

PLATFORM_DATABASE_URL=postgresql://.../ecomate_platform
TENANT_DATABASE_URL=postgresql://.../ecomate
TENANT_MIGRATION_DATABASE_URL=postgresql://.../ecomate
PLATFORM_JWT_SECRET=
PLATFORM_JWT_REFRESH_SECRET=
INTERNAL_SERVICE_SECRET=
APP_ENCRYPTION_KEY=          # replaces LICENSE_ENCRYPTION_KEY
```

## Phase 0 — done

- Pushed the current `main` to `https://github.com/MahmudulHasanRiaz/EcoMate.git`.
- Tagged the baseline `single-tenant-baseline`.
- New CI image names are `ecomate-saas-*` so they cannot overwrite the archived per-client images.
- The manual deploy workflow is SaaS-only and guarded by the repository and `SAAS_DEPLOY_ENABLED`.
- Added ADR 007 and this runbook.

## Runbook skeleton

### Domain / fallback outage

1. Check DNS for the primary domain and the fallback domain.
2. Verify TLS certificates and the ingress `on_demand_tls` ask endpoint.
3. Confirm the tenant's canonical host in the platform admin.
4. If the primary is unhealthy, set the fallback for new links and verify tenant aliases still resolve.
5. Never route an unknown host to a tenant; return 404 or the landing page.

### Platform DB migration

1. Run the platform Prisma migrations before the tenant DB migration.
2. Verify `PlatformSetting.domains` is valid after deployment.
3. Run the SaaS smoke checks (platform login, tenant list, public plans).

### Tenant DB migration

1. Run the single shared migration against `ecomate`; there is no per-tenant fan-out.
2. Run the RLS coverage check; fail the deploy if any tenant table lacks RLS/policy/trigger.
3. Run the two-tenant isolation suite.

### Tenant isolation incident

1. Treat any cross-tenant read/write as a security incident.
2. Disable the affected route/feature, preserve logs, and audit the tenant IDs involved.
3. Fix the query/raw SQL, add a regression test to the isolation suite, and verify RLS coverage.

### Central Commerce port (future)

1. Wait until the upstream branch is final and verified.
2. Port it as additive migrations with `tenant_id` + RLS from the first migration.
3. Implement the store→tenant binding and external webhook/install/bridge resolution before enabling the feature.
4. Keep the feature keys out of plans until the store isolation tests pass.

## References

- `docs/2-ARCHITECTURE/ADR/007-shared-schema-multi-tenancy.md`
- `docs/Commandcode/EcoMate SaaS — Multi-Tenant Conversion Plan`
- `~/.commandcode/plans/saas-multi-tenant-platform.md`


## Platform API (Phase 1 foundation)

`apps/platform-api` is the control-plane NestJS service with its own **`ecomate_platform`** database. The baseline migration is `apps/platform-api/prisma/migrations/0001_platform_baseline`.

```bash
npm run platform:generate
npm run platform:migrate     # PLATFORM_DATABASE_URL must point at ecomate_platform
npm run platform:dev         # port 4100
npm run platform:build
```

Current endpoints: `GET /api/health` and `GET /api/public/plans`. Platform auth, tenant CRUD, plan editing and billing are the next Phase 1 increments.


## Phase 2A — tenant schema + RLS (staged)

The tenant-aware schema is generated and verified but **not active yet**:

- `apps/backend/prisma/schema.tenant.prisma` — proposed schema (203 models; 200 tenant-scoped; 3 global reference).
- `apps/backend/prisma/migrations-saas/0001_saas_baseline` — baseline DDL.
- `apps/backend/prisma/migrations-saas/0002_rls_and_tenant_guards` — 200 RLS policies/triggers + `rls_coverage`.
- `scripts/saas/analyze_schema.py`, `transform_schema.py`, `generate_rls.py` — repeatable tooling.
- `scripts/saas/check_rls.sql` — gate query; must return zero rows.
- `scripts/saas/rls_smoke_test.sql` — two-tenant isolation test.

Verified on a disposable PostgreSQL 16: baseline + RLS apply cleanly, 0 coverage gaps, and the two-tenant read/write/raw-SQL smoke test passes. The active schema is intentionally not swapped until the tenancy runtime and `findUnique`/queue migrations land, so the backend build stays green.

See `docs/saas/phase-2a-report.md` and `docs/saas/schema-transform-report.md`.


## Phase 2B — tenancy runtime primitives (staged)

Implemented under `apps/backend/src/tenancy/`:

- ALS `TenantContext` (`runWithTenant`, `requireTenant`).
- Host/base-domain resolver (`tenant-host.ts`) with reserved slugs and canonical hosts.
- In-memory tenant registry (slug/host lookup).
- Bounded per-tenant Prisma manager with `app.tenant_id` connection options, LRU eviction and idle pruning.
- Tenant Prisma proxy (fails closed outside a tenant context).
- `TenantMiddleware`, `TenantGuard`, `@SkipTenant()` and `TenancyModule`.

`TenancyModule` is imported, but the middleware/guard are not applied globally yet; the current single-tenant routes remain unchanged. Tenancy tests: **17/17**; backend `nest build` clean.

The next steps are registry sync from the platform API, the real `PrismaService` proxy/RLS coverage check, per-tenant Better Auth, the active schema/migration swap and the `findUnique`/queue codemods.


## Phase 2C — platform registry sync

- Platform API internal endpoints (service-token guarded):
  - `GET /api/internal/tenants/registry`
  - `GET /api/internal/tenants/:id/entitlements`
- Tenant runtime `TenantRegistrySyncService` fetches the registry, replaces the
  in-memory tenant map, refreshes every 60s and keeps last-known-good on failure.
- It stays disabled when `PLATFORM_API_URL` / `INTERNAL_SERVICE_SECRET` are not
  set, so the current single-tenant runtime is unaffected.
- Environment: `PLATFORM_API_URL`, `INTERNAL_SERVICE_SECRET`,
  `TENANT_REGISTRY_REFRESH_MS`.

Verification: platform API **26/26** tests and backend tenancy **20/20** tests
pass; both builds are clean. See `docs/saas/phase-2c-report.md`.


## Phase 2D — tenant schema swap (WIP branch)

The active tenant schema/migration swap is on `feat/saas-tenancy-swap`:

- Tenant registry sync and Host→tenant runtime are verified end to end (two tenants, separate branding, RLS 200/3).

- Active schema: 203 models (200 tenant-scoped, 3 global reference); RLS baseline + guards.
- Backend `nest build`: green; full Jest suite: 6173 passed, 0 failed, 10 skipped against a clean migrated tenant DB using a non-superuser RLS role.
- Shared tenant job envelope + tenant-aware email/courier-settlement/media queues and per-tenant interval sweeps (blocked entries, refresh tokens, webhook attempts) are wired; remaining queues/interval sweeps are tracked in the Phase 2D report.
- `PrismaService` is a request-scoped proxy over `TenantPrismaManager`; TenantMiddleware/TenantGuard, per-tenant Better Auth, RLS coverage startup gate and the transitional FeatureFlags provider are wired. Dev has a default-tenant fallback; production fails closed without a resolved tenant. Two-tenant runtime isolation is proven with a non-superuser DB role.
- Legacy license module removed from this branch; seed/scripts excluded from `nest build` pending tenant bootstrap.
- **Do not merge this branch yet.** The verified Phase 0–2C branch is `feat/saas-multitenant`.

See `docs/saas/phase-2d-wip-report.md`.
