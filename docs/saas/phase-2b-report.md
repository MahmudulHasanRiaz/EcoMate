# Phase 2B — Tenancy runtime primitives

**Date:** 2026-11-14
**Branch:** `feat/saas-multitenant`
**Status:** Runtime primitives implemented and tested; the active schema and the
current single-tenant request path are intentionally unchanged.

## Implemented

| File | Purpose |
|---|---|
| `apps/backend/src/tenancy/tenant-context.ts` | `AsyncLocalStorage` tenant context; `runWithTenant`, `requireTenant`, `requireTenantId` |
| `apps/backend/src/tenancy/tenant-host.ts` | Primary/alias/fallback host config; canonical tenant host; reserved slugs |
| `apps/backend/src/tenancy/tenant-registry.service.ts` | In-memory slug/host registry with replace/upsert/remove |
| `apps/backend/src/tenancy/tenant-prisma.manager.ts` | Bounded LRU of per-tenant Prisma clients; `app.tenant_id` connection option; idle prune |
| `apps/backend/src/tenancy/tenant-prisma.proxy.ts` | Routes model access to the current tenant client; fail-closed outside a tenant |
| `apps/backend/src/tenancy/tenant.middleware.ts` | Resolves host → tenant and opens the ALS scope |
| `apps/backend/src/tenancy/tenant.guard.ts` | Rejects routes without tenant context; `@SkipTenant()` escape |
| `apps/backend/src/tenancy/tenancy.module.ts` | Wires the providers/exports |

`TenancyModule` is imported by `AppModule`. The middleware and guard are **not**
applied globally yet, so the current single-tenant routes keep working while the
remaining runtime work lands.

## Verification

```bash
npm test --workspace=backend -- --runInBand
npm run build --workspace=backend
```

- Tenancy unit suites: **5 / 5**, **17 / 17** tests (context, host resolution, registry, LRU manager, proxy).
- Backend `nest build`: clean.
- Full backend Jest run: **6217 passed**. The only failures are 12 tests in two DB-backed marketing integration suites (`p0-financial.integration.spec.ts` and `campaign-deletion-preservation.integration.spec.ts`) because this environment has no seeded local PostgreSQL; they are unrelated to the tenancy changes.
- No active schema or migration swap in this phase.

## Key behaviour

- An empty/missing tenant context fails closed (`ForbiddenException` from
  `requireTenant`, zero rows / write rejection at the database once RLS is active).
- The manager supports `TENANT_DATABASE_URL` with `DATABASE_URL` as the local
  fallback; each pool carries `-c app.tenant_id=<uuid>`.
- The manager cap defaults to 100 clients and idle prune to 10 minutes.
- The proxy keeps the existing `PrismaService` shape available while the real
  `PrismaService` refactor is pending.

## Next steps

1. **Tenant registry sync.** Replace the empty in-memory registry with the
   platform API registry + Redis pub/sub invalidation, including base-domain
   aliases and custom domains.
2. **PrismaService refactor.** Replace the current schema-healing/seed client with
   the tenant proxy, remove boot-time auto-heal, and add the startup RLS coverage
   check.
3. **Better Auth.** Extract the config into a per-tenant factory, route
   `/api/better-auth/*` by host, and add the per-tenant email adapter shim.
4. **Apply middleware/guard.** Add `TenantMiddleware` to the Nest consumer and
   apply `TenantGuard` to tenant routes with `@SkipTenant()` exemptions.
5. **Swap the active schema/migrations.** Move the staged Phase 2A artifacts into
   `apps/backend/prisma`, then run the `findUnique`/`upsert` codemods and the
   queue/interval tenant fan-out.
6. **Full regression.** Run the backend suite with the tenant test harness,
   then the storefront/admin suites.
