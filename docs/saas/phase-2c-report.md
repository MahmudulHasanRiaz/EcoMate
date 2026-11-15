# Phase 2C — Platform registry sync

**Date:** 2026-11-14
**Branch:** `feat/saas-multitenant`
**Status:** Internal registry/entitlement endpoints and the tenant-runtime sync
service are implemented and tested.

## Platform API

Added under `apps/platform-api/src/internal/`:

- `GET /api/internal/tenants/registry` — tenant id/slug/status, verified hosts,
  subscription summary and plan features/limits.
- `GET /api/internal/tenants/:id/entitlements` — tenant status, plan version,
  features, limits, trial/grace/period dates.
- `InternalServiceGuard` — constant-time comparison of
  `x-platform-service-token` against `INTERNAL_SERVICE_SECRET`; fails closed
  when the secret is not configured.

## Tenant runtime

Added `apps/backend/src/tenancy/tenant-registry-sync.service.ts`:

- Fetches `/internal/tenants/registry` with the service token.
- Replaces the in-memory `TenantRegistryService` with the platform snapshot.
- Refreshes every 60s (`TENANT_REGISTRY_REFRESH_MS`); keeps the last-known-good
  snapshot if the platform API is unavailable.
- Disables itself (no polling) when `PLATFORM_API_URL` or
  `INTERNAL_SERVICE_SECRET` is not set, so the current single-tenant runtime is
  unaffected.

Environment additions documented in `.env.example`:

```bash
PLATFORM_API_URL=http://platform-api:4100/api
INTERNAL_SERVICE_SECRET=...
TENANT_REGISTRY_REFRESH_MS=60000
```

## Verification

- Platform API `nest build`: clean; **26 / 26** tests pass.
- Backend `nest build`: clean; tenancy suites **20 / 20** tests pass.
- The current single-tenant request path is still unchanged; the registry stays
  empty when no platform API is configured.

## Next

1. Swap the active schema/migrations from the staged Phase 2A artifacts.
2. Refactor `PrismaService` to the tenant proxy, remove schema healing/boot
   seeding and add the RLS coverage check.
3. Extract Better Auth into a per-tenant factory and update the guard/main
   handler.
4. Apply `TenantMiddleware`/`TenantGuard` and run the `findUnique`/queue codemods
   plus the full regression.
