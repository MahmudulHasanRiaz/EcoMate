# Phase 2D — Tenant schema swap (WIP checkpoint)

**Date:** 2026-11-15
**Branch:** `feat/saas-tenancy-swap` (do **not** merge yet)
**Stable branch:** `feat/saas-multitenant` remains the verified-green checkpoint.

## Status

- Active backend schema is now the tenant-aware schema (203 models; 200 tenant-scoped; 3 global reference tables).
- Active migrations are `0001_saas_baseline` + `0002_rls_and_tenant_guards` (legacy migrations removed from this branch; they remain in the old branch/tag).
- Backend `nest build`: **green (0 TypeScript errors)**.
- Backend Jest: **6175 passed, 0 failed, 10 skipped** (433 suites; 432 passed, 1 skipped) against a clean migrated tenant database using a non-superuser app role (RLS enforced). The 10 skips are intentionally obsolete single-tenant migration-contract specs.

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

**Result: 6169 passed, 0 failed, 10 skipped.** The 10 skipped specs are obsolete single-tenant migration contracts whose migration files no longer exist in the tenant baseline.

### RLS proof (not superuser-bypassed)

- Test/runtime DB uses the non-superuser role `ecomate_tenant_app`; `postgres` is a superuser and bypasses RLS, so it is never used for isolation tests.
- `rls_coverage`: **200 tenant tables, 0 gaps, 3 global reference tables**.
- `RlsCoverageService` runs at boot and refuses to start when any tenant table lacks FORCE RLS, the `tenant_isolation` policy or the `tenant_id_guard` trigger.
- `tenant-runtime-isolation.spec.ts` creates the same `SystemSetting` key in two random tenants through the real proxy: each tenant sees only its row, and cross-tenant read/delete returns null/0.
- App-role runtime smoke: health 200, products 200, Better Auth get-session 200; boot log `RLS coverage verified: 200 tenant table(s), 3 global table(s)`.

Runbook: see `docs/saas/tenant-test-db.md`.

## Runtime wiring (Phase 2D)

Implemented and smoke-tested on the migrated test DB:

- `PrismaService` proxy over `TenantPrismaManager`; tenant clients carry the RLS GUC.
- `TenantMiddleware` + global `TenantGuard`; health is `@SkipTenant`; dev fallback is non-production only.
- Per-tenant Better Auth adapter (`baPrisma` resolver + Host→ALS context in the Fastify hook).
- Transitional global `FeatureFlagsModule` substitutes the removed LicenseModule provider.

### Registry feed + two-tenant host resolution (live proof)

A mock platform registry exposed two tenants (`alpha` → `alpha.ecomate.bd`,
`beta` → `beta.ecomate.bd`) on the real `/internal/tenants/registry` contract:

- backend log: `Tenant registry refreshed (2 tenants)`;
- `RlsCoverageService`: `200 tenant table(s), 3 global table(s)`;
- `GET /api/system-settings/branding` with `Host: alpha.ecomate.bd` → `Alpha Store`;
- same path with `Host: beta.ecomate.bd` → `Beta Store`;
- `Host: localhost:4010` → the default tenant's empty branding.

This exercises Host → registry → ALS → Prisma proxy → RLS end to end. Custom-domain
lookup (`kind: 'custom'` → `resolveByHost`) is covered by the tenant-host unit tests.

Smoke results (real HTTP, test DB + ephemeral Redis):

| Request | Development (`NODE_ENV=development`) | Production (`NODE_ENV=production`) |
| --- | --- | --- |
| `GET /api/health` (unknown host) | 200 healthy | 200 healthy (`@SkipTenant`) |
| `GET /api/products` (unknown host) | 200 `[]` | **403 Tenant context required** |
| `GET /api/system-settings/branding` | 200 | (tenant-guarded) |
| `GET /api/better-auth/get-session` | 200 `null` | **403 Tenant context required** |
| `GET /api/products` (`acme.ecomate.bd`, empty registry) | 200 dev fallback | **403** |

Full backend suite re-ran after this wiring: **6161 passed, 0 failed, 10 skipped**.

## Queue tenant envelope (started)

Shared tenancy job plumbing now lives in `tenancy/tenant-job.ts`:

- `TenantJobData` + `tenantJobPayload()` stamp the request tenant onto queue payloads;
- `TenantWorkerHost` validates `tenantId` and runs `handle()` inside the ALS context;
- `runPerTenant()` provides failure-isolated per-tenant sweep execution.

Converted end to end (producer + processor):

- `email` — per-tenant SMTP settings now resolve under the job's tenant;
- `courier-settlement-import` — background commit runs in the invoice's tenant;
- `media` — `process` jobs carry tenantId; the global `recover` repeatable and the
  boot/backfill scans fan out with `runPerTenant`, so every derivative job is stamped
  with the media row's tenant;
- `tracking` — the outbox relay polls per active tenant (RLS-scoped claim), dispatcher
  jobs run in `TenantWorkerHost`, DLQ mirrors carry the tenant, and the reconciler
  sweeps per tenant;
- `marketing` — webhook/on-demand jobs are tenant-stamped; the system `sync-all`
  repeatable fans out through `runPerTenant`;
- `security-events` — the emitter stamps the request tenant, the processor runs in
  `TenantWorkerHost`, and the aggregate dimension uses the tenant UUID; the formerly
  consumer-less `security-aggregate` queue now has a per-tenant consumer. Security
  retention cleanup is per tenant and the dashboard retention-policy write no longer
  hardcodes `default`;
- `import` — the stub job now carries `tenantId` and runs in `TenantWorkerHost`.

Converted interval sweeps (per-tenant, failure-isolated via `runPerTenant`):

- `blocked-entries.lazyExpire` (60 s);
- `auth` expired refresh-token cleanup (1 h + boot);
- `webhook-attempt` retention cleanup (24 h + boot);
- tracking retention (anonymize/purge/archive) and the page-view buffer
  (tenant-tagged entries, grouped ALS flushes).

The full suite is green after these changes. The shared mechanism is ready for the
remaining queues and interval sweeps.

## Remaining work before merge

1. **Platform backup queue** — intentionally global (no tenant envelope); every
   tenant-facing queue is now tenant-aware.
2. **Per-tenant marketing sync interval** — the repeatable job now fans out per
   tenant, but its cadence is still read from the default tenant's setting.

## Merge readiness

- `nest build`: 0 errors.
- Backend suite: **6175 passed, 0 failed, 10 skipped** on a clean migrated DB with
  the non-superuser RLS role.
- RLS coverage: 200 tenant tables, 0 gaps; two-tenant runtime isolation passed.
- Runtime: proxy + middleware/guard + Better Auth + registry host resolution smoke
  passed; production mode fails closed for unknown hosts.
- Tenant-facing queues and interval sweeps are converted; the platform backup queue
  remains intentionally global. The only open configuration item is the per-tenant
  marketing cadence + production deployment env/DNS.

Ready to merge into `feat/saas-multitenant` on approval.
3. Wire the registry feed into the production deployment (`PLATFORM_API_URL` +
   `INTERNAL_SERVICE_SECRET`) and add custom-domain DNS/verification coverage; the
   endpoint/refresh contract itself is verified.
4. Merge the swap branch into `feat/saas-multitenant`; then Phase 3 (entitlements/license removal).

> The stable `feat/saas-multitenant` branch (Phase 0–2C, green build + 26/20 unit suites) is unchanged. This branch is the working swap; it should stay separate until the test suite and runtime are green.
