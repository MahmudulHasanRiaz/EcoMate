# Phase 2A — Tenant schema + RLS design (staged)

**Date:** 2026-11-14
**Branch:** `feat/saas-multitenant`
**Status:** Design and verification complete; the active schema/migrations are **not swapped yet**.

## What was generated

| Artifact | Purpose |
|---|---|
| `scripts/saas/analyze_schema.py` | Classifies every model/unique/primary key before transformation |
| `scripts/saas/transform_schema.py` | Generates the proposed tenant-aware schema |
| `scripts/saas/generate_rls.py` | Generates RLS policies, triggers and the coverage view |
| `scripts/saas/check_rls.sql` | CI/deployment gate query (must return zero rows) |
| `scripts/saas/rls_smoke_test.sql` | Two-tenant isolation smoke test |
| `apps/backend/prisma/schema.tenant.prisma` | Proposed tenant schema (not active) |
| `apps/backend/prisma/migrations-saas/0001_saas_baseline/migration.sql` | Baseline DDL for the proposed schema |
| `apps/backend/prisma/migrations-saas/0002_rls_and_tenant_guards/migration.sql` | RLS policies/triggers/coverage view |

## Schema transformation

- 203 models in the source schema.
- 2 license models removed (`LicenseActivation`, `LicenseActivationHistory`).
- 2 tenant-runtime models added (`UsageCounter`, `TenantEntitlementCache`).
- **200 tenant-scoped models** get `tenantId UUID` mapped to **`tenant_id`**.
- 3 intentional **global reference** tables: `SourcePlatform`, `MarketingPlatform`, `PaymentOption`.
  - `PaymentOption` is a catalog referenced by `PaymentGateway` via `type`; keeping it global avoids breaking the existing relation.
- 63 field-level uniques converted to `[tenantId, field]`.
- 12 composite `@@unique` constraints prefixed with `tenantId`.
- 5 primary keys rewritten:
  - `SystemSetting` → `[tenantId, key]`
  - `CourierAuthToken` → `[tenantId, courier]`
  - `OrderCounter` → `[tenantId, date, family]`
  - `ReturnCounter` → `[tenantId, date]`
  - `PurchaseCounter` → `[tenantId, date]`
- 401 indexes prefixed with `tenantId`; 39 standalone tenant indexes added.
- 7 specialized GIN/trgm indexes kept as-is, with a separate tenant index where needed.
- `Order.idempotencyKey` and other global idempotency keys are tenant-composite.
- Prisma validation: **valid** (`prisma validate` on the proposed schema).

## Baseline and RLS verification

Applied to a disposable PostgreSQL 16 instance:

- Baseline DDL applied successfully.
- **203 tables** created (200 tenant-scoped + 3 global reference).
- **69 enum types** created.
- RLS migration applied successfully:
  - **200 policies**
  - **200 triggers**
  - **0 coverage gaps** in `rls_coverage`
  - 200 tenant tables; 3 non-tenant tables.
- `tenant_id` columns: **200**; no `tenantId` column remains in SQL.

## Two-tenant smoke test — PASS

`scripts/saas/rls_smoke_test.sql` passed against the disposable database:

- Tenant A and Tenant B each see only their own `SystemSetting` row.
- A raw cross-tenant predicate returns zero rows.
- A cross-tenant update cannot change the other tenant's row.
- An explicit foreign `tenant_id` on insert is coerced to the current tenant.
- `UsageCounter` allows the same `(metric, periodStart)` in two tenants.
- `TenantEntitlementCache` foreign-tenant input is coerced to the current tenant.
- Global reference tables remain readable by the app role.
- With no tenant context:
  - reads return zero rows;
  - inserts fail closed (`tenant context missing`).

### Important fix found during the test

`RESET app.tenant_id` leaves the setting as an empty string, not NULL. A raw
`current_setting(...)::uuid` then raised `invalid input syntax for type uuid`.
The schema default, RLS policy and trigger now use:

```sql
NULLIF(current_setting('app.tenant_id', true), '')
```

This makes an unset/empty context fail closed instead of erroring in a way that
could be mistaken for an application bug.

## What is still pending

1. **Swap the active schema/migrations.**
   - Replace `apps/backend/prisma/schema.prisma` with the proposed schema.
   - Move `migrations-saas` into the active `prisma/migrations` path.
   - Archive/remove the 129 legacy migrations (they remain in the old repo and the `single-tenant-baseline` tag).
2. **Tenancy runtime.**
   - `TenantContext` (AsyncLocalStorage), host/base-domain resolver, tenant guard.
   - `TenantPrismaManager` with per-tenant pools and `app.tenant_id`.
   - `PrismaService` proxy and `baPrisma` proxy.
   - Per-tenant Better Auth factory and email adapter shim.
3. **Code migration.**
   - `findUnique`/`upsert` changes for the 75 converted uniques.
   - Queue/interval tenant fan-out.
   - Redis key prefixing, media tenant prefixes, CORS/rate-limit ordering.
4. **Test migration.**
   - Global Jest tenant context.
   - Full backend suite.
   - Two-tenant isolation suite wired into CI.
5. **RLS coverage in startup/CI.**
   - `RlsCoverageService` fail-fast check.
   - `check_rls.sql` gate.

The active schema remains unchanged so the current backend build is not broken
while the runtime work lands.
