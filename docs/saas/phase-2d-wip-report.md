# Phase 2D — Tenant schema swap (WIP checkpoint)

**Date:** 2026-11-14
**Branch:** `feat/saas-tenancy-swap` (do **not** merge yet)
**Stable branch:** `feat/saas-multitenant` remains the verified-green checkpoint.

## Status

- Active backend schema is now the tenant-aware schema (203 models; 200 tenant-scoped; 3 global reference tables).
- Active migrations are `0001_saas_baseline` + `0002_rls_and_tenant_guards` (legacy migrations removed from this branch; they remain in the old branch/tag).
- Backend `nest build`: **green (0 TypeScript errors)**.
- Backend Jest: **5781 passed, 388 failed, 4 skipped** (431 suites). The failures are test-migration work, not build failures.

## Applied changes

- `tenantId` mapped to `tenant_id` on 200 models; composite uniques/indexes from the Phase 2A transformation.
- `Order.idempotencyKey`, counters, settings and other converted unique keys are tenant-composite.
- Reads converted from `findUnique` to `findFirst` (RLS scopes the tenant); writes whose unique keys are tenant-composite use `tenantCompound({ ... })`.
- Calls that still use a valid compound unique key (e.g. `warehouseId_code`, `orderItemId_cycleId`) were reverted to `findUnique` where needed.
- `PrismaService` is a transitional default-tenant client:
  - connection uses `TENANT_DATABASE_URL` (or `DATABASE_URL`) with `-c app.tenant_id=${DEFAULT_TENANT_ID}`;
  - schema healing/boot seeding removed;
  - `isRestoreWriteBlocked` is a platform-only no-op;
  - `rawQuery` retained for maintenance/health callers.
- Legacy `src/license` module and `LicenseGuard` removed; the old license models are not in the active schema.
- Prisma seed/scripts excluded from `nest build` (`tsconfig.build.json`) because they still target the old single-tenant data model and will be replaced by tenant bootstrap/provisioning.

## Remaining test work

The 388 failures are concentrated in:

1. **Mock alignment for compound-key reads** — tests define `findFirst` mocks while the source still calls `findUnique` for still-valid compound keys (`tx.physicalReservation`, `attendanceDay`, `deviceEmployeeMapping`, `trackingDispatch`, `binLocation`). A shared dual-method mock helper or source-level flatten is required.
2. **Changed `where` shapes** — assertions/mocks for reads that moved to `findFirst` and writes that now use `tenantCompound`.
3. **DB-backed integration suites** — marketing P0/campaign integration specs require a seeded local Postgres (same environmental failures as before).
4. **Old migration-safety specs** — they still assert the removed legacy migration files/probes; they need to be rewritten for the new baseline/RLS gate.

## Next steps

1. Finish mock alignment (prefer a shared `findFirst`/`findUnique` mock alias helper) and re-run the backend suite.
2. Add the tenant Jest context harness (`DEFAULT_TENANT_ID` + ALS) and the two-tenant isolation suite.
3. Wire the real tenant runtime:
   - `PrismaService` proxy over `TenantPrismaManager`;
   - `TenantMiddleware` + `TenantGuard` with `@SkipTenant` exemptions;
   - per-tenant Better Auth factory and `baPrisma` proxy.
4. Re-run the Phase 2A RLS smoke test against the active migration set.
5. Only then merge the swap branch into `feat/saas-multitenant` and proceed to Phase 3 (entitlements/license removal).

> The stable `feat/saas-multitenant` branch (Phase 0–2C, green build + 26/20 unit suites) is unchanged. This branch is the working swap; it should stay separate until the test suite and runtime are green.
