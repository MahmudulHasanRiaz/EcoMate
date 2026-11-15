# Phase 2D — Tenant schema swap (WIP checkpoint)

**Date:** 2026-11-15
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
- `PrismaService` is now a request-scoped **proxy** over `TenantPrismaManager`:
  - delegates and `$transaction` resolve the tenant client from the ALS context;
  - every pooled connection carries `-c app.tenant_id=<tenant>`;
  - `DEFAULT_TENANT_ID` is a dev/maintenance fallback only;
  - schema healing/boot seeding removed; `isRestoreWriteBlocked` is a platform-only no-op.
- Tenant runtime:
  - global `TenantMiddleware` resolves tenant/custom/platform hosts before other middleware;
  - global `TenantGuard` fails closed when no tenant context exists (`@SkipTenant` on health);
  - development-only default-tenant fallback keeps localhost/dev tooling usable; production has no fallback;
  - Better Auth's `baPrisma` proxy follows the same ALS context, and the `/api/better-auth/*` Fastify hook resolves the Host before handing the request to `auth.handler`.
- Transitional `FeatureFlagsModule` provides the `FeatureFlagsService` globally (the old LicenseModule provided it); dev/test opens `*`, production stays closed until entitlements replace it.
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

## Runtime wiring (Phase 2D)

Implemented and smoke-tested on the migrated test DB:

- `PrismaService` proxy over `TenantPrismaManager`; tenant clients carry the RLS GUC.
- `TenantMiddleware` + global `TenantGuard`; health is `@SkipTenant`; dev fallback is non-production only.
- Per-tenant Better Auth adapter (`baPrisma` resolver + Host→ALS context in the Fastify hook).
- Transitional global `FeatureFlagsModule` substitutes the removed LicenseModule provider.

Smoke results (real HTTP, test DB + ephemeral Redis):

| Request | Development (`NODE_ENV=development`) | Production (`NODE_ENV=production`) |
| --- | --- | --- |
| `GET /api/health` (unknown host) | 200 healthy | 200 healthy (`@SkipTenant`) |
| `GET /api/products` (unknown host) | 200 `[]` | **403 Tenant context required** |
| `GET /api/system-settings/branding` | 200 | (tenant-guarded) |
| `GET /api/better-auth/get-session` | 200 `null` | **403 Tenant context required** |
| `GET /api/products` (`acme.ecomate.bd`, empty registry) | 200 dev fallback | **403** |

Full backend suite re-ran after this wiring: **6161 passed, 0 failed, 10 skipped**.

## Remaining work before merge

1. Feed the production tenant registry (`PLATFORM_API_URL` + `INTERNAL_SERVICE_SECRET` / Redis pub-sub) and add a two-tenant runtime isolation test.
2. Tenant fan-out for queue workers/interval jobs (currently they use the default-tenant bridge).
3. Add the RLS coverage startup gate (`rls_coverage` view) and carry it into the deployment check.
4. Merge the swap branch into `feat/saas-multitenant`; then Phase 3 (entitlements/license removal).

> The stable `feat/saas-multitenant` branch (Phase 0–2C, green build + 26/20 unit suites) is unchanged. This branch is the working swap; it should stay separate until the test suite and runtime are green.
