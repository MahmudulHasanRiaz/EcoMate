# Phase 2D — Tenant schema swap (WIP checkpoint)

**Date:** 2026-11-14
**Branch:** `feat/saas-tenancy-swap` (do **not** merge yet)
**Stable branch:** `feat/saas-multitenant` remains the verified-green checkpoint.

## Status

- Active backend schema is now the tenant-aware schema (203 models; 200 tenant-scoped; 3 global reference tables).
- Active migrations are `0001_saas_baseline` + `0002_rls_and_tenant_guards` (legacy migrations removed from this branch; they remain in the old branch/tag).
- Backend `nest build`: **green (0 TypeScript errors)**.
- Backend Jest: **6161 passed, 0 failed, 10 skipped** (429 suites; 428 passed, 1 skipped) against a clean migrated tenant database. The 10 skips are intentionally obsolete single-tenant migration-contract specs.

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

## Test-migration progress

Failures reduced from **388 → 55** across this pass:

- Converted remaining compound-key reads in attendance-devices, hr-attendance, tracking, warehouses, stock and orders to `findFirst` + flat `where`; their targeted suites are green.
- Fixed 105 duplicate `findFirst` mock keys created by the mechanical rename; later duplicates now remain `findUnique` and no longer override the intended mock.
- Updated `jest.spyOn(..., 'findUnique')` targets, counter expectations (`tenantId_date_family`), SystemSetting expectations (`tenantId_key`), and scanner/payroll/hr/accounts/refunds/payment-gateway mocks.
- Restored UUID detail lookups to `findUnique` (orders findOne/token path); only the displayId fallback uses `findFirst`.
- Payment helpers now check for `findFirst` delegates (the source calls `findFirst` after the codemod); this fixed refunds/HR payments, gateway settlement bootstrap, payment settings and the append-only ledger tests.
- Removed obsolete single-tenant migration SQL specs (payment backfill, access-preset repair, probe coverage) whose files no longer exist in the new baseline.
- Fixed RTN order lookup fake, scanner displayId lookup, accounting/employee/POS counter expectations, payroll/HR-leave sequences, and order-staff email fallback.

## Full-suite verification (clean tenant DB)

The two DB-backed marketing integration suites were migrated to the tenant schema and verified against a **clean, freshly migrated PostgreSQL 16 database**:

- `prisma migrate deploy` applied `0001_saas_baseline` + `0002_rls_and_tenant_guards` (205 tables, RLS policies/triggers).
- Test pools set `app.tenant_id` (the same GUC the runtime proxy will set), so RLS is exercised, not bypassed.
- `p0-financial.integration.spec.ts` now uses the tenant-composite `tenantId_code` key for its account upserts.
- `campaign-deletion-preservation.integration.spec.ts` self-seeds an `OrderStatus` when the fresh tenant DB has none.

**Result: 6161 passed, 0 failed, 10 skipped.** The 10 skipped specs are obsolete single-tenant migration contracts whose migration files no longer exist in the tenant baseline.

Runbook: see `docs/saas/tenant-test-db.md`.

## Remaining work before merge

1. Wire the real tenant runtime:
   - `PrismaService` proxy over `TenantPrismaManager`;
   - `TenantMiddleware` + `TenantGuard` with `@SkipTenant` exemptions;
   - per-tenant Better Auth factory + `baPrisma` proxy.
2. Re-run the full suite + the Phase 2A RLS smoke against that runtime.
3. Merge the swap branch into `feat/saas-multitenant`; then Phase 3 (entitlements/license removal).

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
