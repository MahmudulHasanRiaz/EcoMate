# Phase 2D — Tenant schema swap (WIP checkpoint)

**Date:** 2026-11-14
**Branch:** `feat/saas-tenancy-swap` (do **not** merge yet)
**Stable branch:** `feat/saas-multitenant` remains the verified-green checkpoint.

## Status

- Active backend schema is now the tenant-aware schema (203 models; 200 tenant-scoped; 3 global reference tables).
- Active migrations are `0001_saas_baseline` + `0002_rls_and_tenant_guards` (legacy migrations removed from this branch; they remain in the old branch/tag).
- Backend `nest build`: **green (0 TypeScript errors)**.
- Backend Jest: **6149 passed, 12 failed, 10 skipped** (429 suites; 2 failing suites). The only remaining failures are the two pre-existing DB-backed marketing integration suites (P0 Financial / Campaign Deletion), which need a migrated + seeded Postgres.

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

## Remaining test work

The remaining 12 failures are **only** the two DB-backed marketing integration suites:

1. `marketing/__tests__/p0-financial.integration.spec.ts`
2. `marketing/__tests__/campaign-deletion-preservation.integration.spec.ts`

They need a Postgres database with the tenant baseline + RLS migrations applied and the marketing fixtures seeded. All 426 other suites (6149 tests) pass, including the tenancy suites.

The next verification step is to run those two suites against a dedicated migrated/seeded database; then wire the real tenant runtime (Prisma proxy, Better Auth, middleware) and merge.

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
