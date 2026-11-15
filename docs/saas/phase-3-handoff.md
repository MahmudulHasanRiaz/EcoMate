# Phase 3 handoff — entitlements, subscription guard, license removal

**Branch:** `feat/saas-multitenant` at `0020951f` (pushed)  
**Phase 2D:** merged; backend full suite was **6180 passed, 0 failed, 10 skipped**
against a clean migrated tenant DB using the non-superuser `ecomate_tenant_app`
role. `nest build` is green. Runtime registry/RLS smoke passed.

## Already done (Phase 3 slice 1)

- Platform registry payload now feeds `TenantRegistryRecord` with
  `plan.features`, `plan.limits`, plan name, subscription status and dates
  (`apps/backend/src/tenancy/tenant-registry-sync.service.ts`).
- `TenantEntitlementsService`
  (`apps/backend/src/tenancy/tenant-entitlements.service.ts`) provides
  `canUse`, `getActiveFeatures`, `getLimits`, `getPlanName`,
  `getAccessState` (`full`/`grace`/`read_only`/`suspended`) and `getSnapshot`.
  Missing snapshots open in dev/test and fail closed in production.
- `FeatureFlagsService` is now provided by `TenantFeatureFlagsService`
  (`apps/backend/src/feature-flags/`), so every existing `@RequiresFeature`
  route checks plan entitlements instead of a license engine.

## Remaining work (do in this order)

### 1. Entitlement API + storefront/admin wiring

- Add `apps/backend/src/entitlements/`:
  - `GET /api/entitlements/me` (authenticated) → `TenantEntitlementsService.getSnapshot()`.
  - `GET /api/entitlements/public` (`@Public`) → plan name/features/access state for the storefront.
  - Import the module in `app.module.ts`.
- `SystemSettingsController.getStorefrontConfig`:
  - inject `TenantEntitlementsService` (`@Optional` if tests need it) and return
    `licenseFeatures` (or a new `features` field) from `getActiveFeatures()`.
  - **Critical:** the cache key `storefront:config` is currently global
    (`cache.get/set/getStale` and `cache.delete` around line 1097). Make it
    `storefront:config:<tenantId>` (use `getTenantContext()?.tenantId`, fallback
    to the legacy key only when no context) and update the canonical-domain test.
- Admin:
  - `apps/admin/src/context/features-provider.tsx` and
    `apps/admin/src/components/layout/authenticated-layout.tsx` still call
    `/license/status` and redirect to `/license/activate`. Switch both to
    `/entitlements/me`, feed `useLicenseStore.setFeatures(features)`, include the
    `'*'` wildcard in `hasFeature`, and remove the activation redirect/poll.
  - Replace the license settings page/routes/sidebar entry with a Plan & Usage
    page backed by `/entitlements/me`; remove `/license/activate` and
    `/license-denied` routes.
- Storefront:
  - `apps/storefront/lib/api/storefront-config.ts` `hasLicenseFeature` must read
    the tenant feature list (keep the helper name for compatibility or rename to
    `hasFeature`); remove `_licenseActive` layout gating once the backend no
    longer returns it. Existing gate call sites (combos, wishlist, careers,
    customization, mobile distribution) should work unchanged.

### 2. Subscription/write guard

- Add `TenantSubscriptionGuard` + `@SkipSubscription`:
  - use `getAccessState()`; allow `full`/`grace`;
  - allow `GET`/`HEAD`/`OPTIONS` for `read_only`/`suspended`, block writes with a
    clear 403;
  - register globally after `TenantGuard` in `app.module.ts`;
  - `@SkipSubscription` on `AuthController`, `HealthController`, and the
    entitlement controller (billing/auth must stay usable);
  - unit-test full/grace/read-only/suspended + skip metadata.
- Note: Better Auth is handled by the Fastify hook in `main.ts` and bypasses Nest
  guards; keep auth available for suspended tenants.

### 3. License removal

- `@ecomate/license-engine` is still in `apps/backend/package.json` and
  `packages/feature-flags/package.json`. Rewrite the package
  `FeatureFlagsService` to drop `LicenseEngine`/`initializeWithEngine`, remove
  the dependency, delete `packages/license-engine` and `portainer/keygen`.
- Remove `SkipLicenseCheck` and remaining license wording/env:
  - `LICENSE_ENCRYPTION_KEY` → `APP_ENCRYPTION_KEY` with a backward-compatible
    fallback (update `common/utils/encryption.ts`,
    `encryption-key-provisioner.ts`, tests, `.env.example`, compose, docs);
  - `LICENSE_DATA_DIR` → `APP_DATA_DIR` with fallback; keep the key volume.
- Admin license UI/client/routes/sidebar removal is part of step 1.
- After removal, grep for `license`, `KeyMate`, `keygen` and clean docs/env.

### 4. Limits + usage

- Add `@RequiresLimit` + a tenant limit service/guard using
  `getLimits()`; counters for products, staff, monthly orders and storage.
- Add 80% warnings and “Upgrade” CTAs in admin.
- Keep limits fail-closed in production when a key is absent only if the plan
  explicitly defines it; document default behavior.

### 5. Entitlement refresh

- Registry refresh is 60 s (`TENANT_REGISTRY_REFRESH_MS`); plan changes are
  visible on the next refresh. Add a platform→tenant cache/Redis invalidation or
  a short TTL if immediate propagation is required.
- Add a two-tenant test that changes one tenant’s plan snapshot and asserts the
  other tenant’s features/limits are unchanged.

## Verification commands

Use `docs/saas/tenant-test-db.md`; **never use the `postgres` superuser for
runtime/isolation tests** (it bypasses RLS). Use `ecomate_tenant_app`.

```bash
# from apps/backend after applying 0001 + 0002 to a fresh DB
DATABASE_URL=postgresql://ecomate_tenant_app@127.0.0.1:55432/ecomate_tenant_test \
TENANT_DATABASE_URL=postgresql://ecomate_tenant_app@127.0.0.1:55432/ecomate_tenant_test \
DEFAULT_TENANT_ID=00000000-0000-4000-8000-000000000000 \
npm test -- --runInBand
```

Baseline at handoff: **6180 passed / 0 failed / 10 skipped**; `nest build` green.
Regenerate Prisma client after schema changes. Do not merge/force-push shared
branches without approval.

## Key files

- `apps/backend/src/tenancy/tenant-entitlements.service.ts`
- `apps/backend/src/tenancy/tenant-registry-sync.service.ts`
- `apps/backend/src/feature-flags/` (compatibility provider)
- `apps/backend/src/system-settings/system-settings.controller.ts` (storefront config/cache)
- `apps/admin/src/context/features-provider.tsx`
- `apps/admin/src/components/layout/authenticated-layout.tsx`
- `apps/storefront/lib/api/storefront-config.ts`
- `apps/platform-api/src/internal/internal.controller.ts` (registry/entitlements contract)
- `docs/saas/phase-2d-wip-report.md`, `docs/saas/tenant-test-db.md`
