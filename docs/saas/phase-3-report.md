# Phase 3 report — entitlements, subscription guard, limits, license removal

**Branch:** `feat/saas-multitenant`
**Status:** implemented on top of `0020951f` (Phase 3 slice 1)
**Scope:** `docs/saas/phase-3-handoff.md` items 1–5

## 1. Entitlement API + wiring

### Backend

| Endpoint | Auth | Payload |
|---|---|---|
| `GET /api/entitlements/me` | authenticated | `{ tenantId, planName, subscriptionStatus, accessState, features, limits, validUntil }` |
| `GET /api/entitlements/public` | `@Public` | `{ planName, features, accessState }` |
| `GET /api/entitlements/usage` | authenticated | `{ planName, accessState, limits: UsageRow[] }` |
| `POST /api/entitlements/refresh` | service token | `{ refreshed, lastRefreshAt, lastError, tenants }` |

- New `apps/backend/src/entitlements/` module, registered in `app.module.ts`.
- `SystemSettingsController.getStorefrontConfig` now injects
  `TenantEntitlementsService` (`@Optional`, so existing unit-test construction
  keeps working) and returns `planFeatures` from `getActiveFeatures()`.
- Storefront config cache is now **tenant-scoped**:
  `storefront:config:<tenantId>`; the legacy `storefront:config` key is used only
  when no tenant context exists (tests / pre-middleware boot). `set()` invalidates
  the current tenant key only. Covered by `storefront-config-tenancy.spec.ts`.

### Admin

- `features-provider.tsx` and `authenticated-layout.tsx` now read
  `/entitlements/me`; the activation redirect and the 5-minute license poll are
  gone. Plan-change toasts are unchanged.
- `index.html` prefetches `/entitlements/me` (`payload.entitlements`).
- `stores/license-store.ts` → `stores/entitlements-store.ts`
  (`useEntitlementsStore`), palette-wide rename, with a one-time fallback read of
  the old `eco_mate_features` cache key.
- License settings UI/routes deleted; replaced by **Settings → Plan & Usage**
  (`/mon/settings/plan`) backed by `/entitlements/me` + `/entitlements/usage`.
- `/license/activate` and `/license/denied` routes removed. Feature-gate
  redirects now land on `/feature-unavailable` (renamed from
  `license-denied`), whose CTA opens Plan & Usage.
- `nav-user`, settings sidebar, command palette and every `useLicenseStore`
  consumer updated to the entitlements store.

### Storefront

- `licenseFeatures` → `planFeatures`; `hasLicenseFeature` → `hasPlanFeature`
  across the config type, server loader, layout, manifest, header/mobile menu,
  PDP gates, combos, careers, wishlist and tests.
- `storefront-config-server.ts` no longer calls `/license/status`; it calls
  `/entitlements/public` and merges the returned feature list over the config
  payload (older cached configs stay correct).
- The `_licenseActive` / `_licenseMessage` layout gate is removed. Branding,
  maintenance mode and the plan feature gates remain.

## 2. Subscription/write guard

- `TenantSubscriptionGuard` + `@SkipSubscription` in
  `apps/backend/src/tenancy/`.
- `full` / `grace` → allow.
- `read_only` / `suspended` → allow `GET`/`HEAD`/`OPTIONS`, return 403 on writes
  with an actionable message.
- Registered globally **after** `TenantGuard`, before auth.
- `@SkipSubscription` on `AuthController`, `HealthController` and
  `EntitlementsController`; Better Auth still bypasses Nest guards through the
  Fastify hook in `main.ts`.
- `tenant-subscription.guard.spec.ts` covers every state, read/write and skip
  metadata.

## 3. License removal

- `packages/feature-flags` `FeatureFlagsService` rewritten without
  `LicenseEngine`, `initializeWithEngine`, `setLicense`, `getLicense` or
  `isReady`; `setFeatures` replaces the license-era setter.
- `@ecomate/license-engine` removed from `apps/backend/package.json` and
  `packages/feature-flags/package.json`; `packages/license-engine/` and
  `portainer/keygen/` deleted; backend Dockerfile and CI no longer build it;
  `package-lock.json` regenerated.
- `SkipLicenseCheck` decorator and all usages removed.
- Env rename with backward-compatible fallbacks:
  - `LICENSE_ENCRYPTION_KEY` → `APP_ENCRYPTION_KEY`
  - `LICENSE_DATA_DIR` → `APP_DATA_DIR`
  - An existing local `.license-data/` directory is still reused so a
    provisioned key is not lost.
- `packages/shared-types/src/license-types.ts` → `feature-catalogue.ts`
  (license-specific interfaces removed; `FEATURES`, `FEATURE_KEYS`,
  `DEPENDENCY_MAP` kept).
- `startup.sh`, `docker-compose.yml`, `.env.example`, `.gitignore`, CI,
  README, SAAS.md, architecture/event-flow/business docs and the onboarding
  runbook updated. `docs/keygen-setup.md` and `docs/5-SETUP/LICENSE_SETUP.md`
  deleted.
- The `license-data` compose volume name is intentionally retained: renaming it
  would create an empty volume and make existing encrypted rows unreadable. It
  now mounts at `/app/app-data`.

## 4. Limits + usage

- `@RequiresLimit(key, amount?)` + `TenantLimitGuard` (global, after the
  subscription guard) + `TenantLimitsService`.
- Limit keys:

| Key | Counter | Applied to |
|---|---|---|
| `products` | non-draft products | product create, draft publish |
| `staff_users` | `UserProfile` rows where `role != customer` | user create |
| `orders_per_month` | non-trashed orders since the start of the current **Dhaka** month | order create (storefront + staff) |
| `storage_mb` | sum of `Media.size` | image upload, bulk upload, upload-from-URL |

- **Default behaviour (documented):** a key absent from `plan.limits`, or a
  value that is not a finite non-negative number, means **unlimited** — a plan
  typo can never lock a tenant out. A `0` value blocks the first unit.
- Writes are blocked with
  `Plan limit reached for <label> (<used>/<limit>). Upgrade your plan to continue.`
- `GET /entitlements/usage` returns every counter with `used`, `limit`,
  `percent` and a `warning` flag at **≥ 80%**; the Plan & Usage page renders the
  bars, the warning text and an **Upgrade plan** CTA (enabled when
  `VITE_BILLING_URL` is configured; otherwise a disabled button explains the
  missing billing portal).
- `startOfDhakaMonth()` added to `common/utils/dhaka-time.ts`; boundary is
  covered by the limits spec.

## 5. Entitlement refresh

- `POST /api/entitlements/refresh` lets the platform control plane push an
  immediate registry refresh to a tenant instance after a plan/subscription
  change. It is `@Public` + `@SkipTenant` and authenticated by
  `PlatformServiceTokenGuard`: `x-platform-service-token` must equal
  `INTERNAL_SERVICE_SECRET` (timing-safe compare; unset secret = refused).
- The 60-second poll (`TENANT_REGISTRY_REFRESH_MS`) remains the fallback.
- `tenant-entitlements.isolation.spec.ts` proves that changing one tenant's
  snapshot changes neither the other tenant's features, limits, plan name nor
  access state, and that a change is visible immediately without a poll.

## Verification

Measured on this branch against a fresh tenant DB
(`postgresql://ecomate_tenant_app@127.0.0.1:55432/ecomate_tenant_test`,
non-superuser role, migrations `0001` + `0002`):

```
backend  jest         6229 passed / 10 skipped / 0 failed  (440 suites + 1 skipped)
backend  nest build   clean
admin    tsc          clean
admin    vitest       1671/1671 passed (185 files)
storefront tsc        clean
storefront tests      664/664 passed (89 files)
shared-types tests    9/9 passed
feature-flags tests   13/13 passed
```

The admin suite must be run from a path without spaces: the repository's
current absolute path contains spaces, and in that location Vitest Browser's
`vi.mock` resolution bypasses relative mocks in 3 pre-existing suites
(`bank-account-manager`, `orders-list-filters`, `customers`). The same
unmodified HEAD commit reproduces the 8 failures at a path with spaces and
passes at `/tmp/ecomate-base`; the changed tree passes 1671/1671 from a
space-free copy.

### Runtime smoke (compiled `dist`, tenant test DB, Redis up)

```
GET  /api/health                  200
GET  /api/entitlements/public     {"planName":null,"features":["*"],"accessState":"full"}
GET  /api/entitlements/me         401 (unauthenticated)
GET  /api/entitlements/usage      401 (unauthenticated)
POST /api/entitlements/refresh    401 (no service token)
POST /api/entitlements/refresh    {"refreshed":false,"lastError":"PLATFORM_API_URL / INTERNAL_SERVICE_SECRET not set","tenants":0}
      (with x-platform-service-token; the platform URL was deliberately unset)
POST /api/orders                 reaches DTO validation (400), i.e. the
                                  subscription + limit guards allow a dev/full tenant
```

The app booted with the new global guards (`TenantGuard` →
`TenantSubscriptionGuard` → `TenantLimitGuard`) and mapped every entitlement
route, which proves the DI graph and guard order.

## Caveats / follow-ups

- Multi-instance deployments must call `POST /entitlements/refresh` on every
  instance (or front it with a fan-out). The endpoint is deliberately
  idempotent.
- Historical design documents under `docs/superpowers/` and
  `docs/Commandcode/` still describe the pre-SaaS license flow; they are
  archival and were left untouched.
- The public storefront cannot create orders for a `read_only`/`suspended`
  tenant — that is the intended policy, not a bug.
