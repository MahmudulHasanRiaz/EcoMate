# Phase 9 port record — central-commerce (multi-tenant first)

Ported 2026-11-22 by Builder A (backend core) from the single-tenant
upstream branch `feature/central-commerce-p0` at commit `a7ea95f5`
(149 added + 50 modified files) onto the SaaS branch
`feat/saas-multitenant` (HEAD `0c9f38fb` at port time).

## Sync boundary

The upstream branch is the source **only until this port is verified**;
after that the SaaS repo is the source of truth. If upstream evolves while
the port is in progress, use `git range-diff`/cherry-pick and re-run the
verification checklist; do not let the two forks drift. The 7 upstream
migrations were NOT ported — the SaaS side has its own 6 additive
migrations on the SaaS baseline (below).

## What was ported

- **Schema + migrations** (`apps/backend/prisma/`): 14 enums + 18 models,
  every table with `tenant_id` + tenant-first indexes + RLS policy/trigger
  in its first migration; Order gains 7 cross-cutting columns (P6
  provenance + P8 canonical). Migrations:
  `20261122150000_central_commerce_enums` (DDL-only),
  `20261122150100_central_commerce_stores`,
  `20261122150200_central_commerce_assignments`,
  `20261122150300_central_commerce_sync`,
  `20261122150400_central_commerce_mappings`,
  `20261122150500_central_commerce_order_fields`. Each ships with
  `rollback.sql`. `scripts/resolve-failed-migrations.sh` gained a probe
  case per migration.
- **Whole `src/stores/` tree** (providers, webhooks, bridge/install,
  sync services, queues, schedulers) + `src/orders/channels/` (resolver +
  flags, NO backfill service) + `src/products/seo-meta.accessor.ts` +
  `src/stock/stock-race.spec.ts` (spec only — the fix is in the baseline).
- **Integration touchpoints** in orders, products, stock, inventory,
  import, business-analytics, tracking, checkout-leads, POS, rate-limit.
- **Docs:** only `BRIDGE-V1-PROTOCOL.md` in this directory (updated for
  the `:storeKey` callback URL) + this record.

## SaaS adaptations (the required refactors, §3.3)

- **ExternalStoreResolver** (`src/external-stores/`): tenant resolution
  for webhooks/install/bridge goes Redis (`extstore:` keys, never purged)
  → platform-api binding resolve (`x-platform-service-token`). Fail closed
  on platform outage + cache miss; generic 401, no oracle. NEVER a global
  Prisma query.
- **Platform binding** (§3.4): connect claims the store on platform-api
  (PENDING → ACTIVE); disconnect marks DISCONNECTED and RETAINS the row
  (ruling D9); purge deletes bindings platform-side, the backend only
  invalidates resolver cache entries. Sync runs report `lastSyncAt` /
  `lastError` to platform-api (§6.2).
- **ProviderUrlGuard** (§3.7, NEW): https-only, DNS-resolve + reject
  private/reserved targets, re-validate on redirect (max 5, GET/HEAD
  only). Wraps the adapters' injectable `fetchFn`.
- **Credentials** (§3.6): ported onto `EncryptionService`
  (`APP_ENCRYPTION_KEY`); `keyFingerprint` label is `app-key`.
- **Queues** (§3.5): 6 queues, every job carries `tenantId`; processors
  extend `TenantWorkerHost`; worker-level flag check added (G-4 — upstream
  lacks it); reconcile-tick + retention-purge fan out per tenant;
  per-store serialization via Redis locks; circuit breaker is Redis-backed
  (upstream's was an in-memory Map despite its docstring).
- **Feature enforcement** (§5.1): `@RequiresFeature` on sync triggers +
  entitlement check in `SyncQueuesService.enqueue` and
  `notifyStockChanged`. FeatureGuard's dependency handling NOT changed
  (ruling D11) — the gap is documented where enforcement lands.
- **Kill switches** (§3.8): all 10 flags OFF by default at launch
  (explicit `false` in compose/`.env.example`/Portainer template — the
  code defaults ON). Effective gate = kill switch AND tenant entitlement.
- **Caddy** (ruling D1): on the api host, `/api/webhooks/stores/*`,
  `/store-install` (rewritten to `/api/store-install`), and
  `/api/store-bridge/*` route to `backend:4000`.
- **P13 deviations adopted** (ruling D7): ERP 1–5 pushes ACTUAL
  quantities, Shopify quantized-capped, ERP-zero ingest items REJECTED
  (`ZERO_STOCK_REJECT`).
- **Limits**: `external_stores` usage counter (non-NATIVE,
  non-DISCONNECTED) + `assertWithinLimit` before the platform claim on
  connect; `@RequiresLimit('external_stores')` on the connect endpoint.
- **NATIVE row**: lazy ensure in `StoresService.list()`.
- **Export/purge**: the 18 tables are auto-discovered by the
  `tenant_id` catalog scan (no manifest entry needed); purge invalidates
  resolver cache entries for the tenant's stores.

## Deliberately NOT ported

- `channel-backfill.service.ts` (no-backfill contract, §3.12).
- The 7 upstream migrations (replaced by the 6 SaaS migrations above).
- `STORE_ALLOW_HTTP_LOOPBACK` in `.env.example` (lane restricts env
  files to kill-switch vars; documented in the guard instead).

## Known gaps (documented, not fixed here)

- **D11:** method-level `@RequiresFeature` REPLACES the class-level key
  (no AND), and the guard ignores decorator `dependencies`. Mitigated by
  the enqueue entitlement check + add-on bundling; see the comments on
  `StoresController.triggerSync` and `SyncOpsController`.
- **Operator tenant-create does not call `validateSlug`** (pre-existing
  gap, out of lane).
- **Circuit-breaker half-open probe claim is read-modify-write, not
  atomic** (documented weakening, harmless — a duplicate probe is just
  one extra provider call).
- **ProviderUrlGuard cannot pin IPs** (the fetch seam can't pin cheaply)
  — residual TOCTOU/DNS-rebinding risk, documented in the guard.

## Live-probe findings (2026-11-22, test env — fixed in this slice)

- **413 under Nest:** the oversized-body error was a plain `Error` with
  `statusCode = 413`, which raw Fastify honours but Nest's exception
  filter does not — live it returned 500. Fixed with
  `payloadTooLargeError()` (`src/stores/raw-body-capture.ts`): a Nest
  `PayloadTooLargeException` that ALSO carries numeric `statusCode`,
  so both hosts return 413. Verified live (oversized webhook → 413).
- **Scheduler entitlement gates:** the hourly reconcile tick and the
  stock audit created SyncRuns for downgraded tenants (the enqueue
  check refused the jobs, but the run rows were already minted and
  stayed RUNNING forever). Both now check the entitlement BEFORE
  minting a run: `tickHourly()` skips tenants lacking
  `store_order_sync`; `runAudit()` skips tenants lacking
  `store_stock_sync`. The enqueue check remains as the second layer.
- **Webhook POST returns 201, not 200:** Nest POST defaults to 201 and
  the upstream controller has no `@HttpCode(200)` — faithful port
  behaviour; webhook senders accept any 2xx. The protocol doc's "200"
  means success, not the literal status.
- **Sync-report end-to-end:** a finished ingest run populated the
  platform binding's `lastSyncAt`, and a specific
  `UNMATCHED_SKU` issue message survived as `lastError` (the
  count-based message did not clobber it — the 10-minute guard works).
- **Test-env note:** BullMQ warns the local Redis eviction policy is
  `allkeys-lru`; production/staging Redis should use `noeviction`
  (deploy-time config, not a code change).
