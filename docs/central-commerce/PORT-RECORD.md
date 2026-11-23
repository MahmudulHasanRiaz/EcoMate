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

## Worker split (WORKER_MODE) — webhook fix, workstream E

One backend image, two processes (takes effect at the next deploy):

- `backend` (`WORKER_MODE=api`): HTTP + schedulers; queue processors NOT
  registered. Still enqueues from HTTP handlers (queue producers stay).
- `worker` (`WORKER_MODE=worker`, NEW service in `docker-compose.yml`):
  queue processors only; no HTTP port, schedulers NOT registered. Same
  image, same env (YAML anchor `&backend-env` merged, `WORKER_MODE`
  overridden), same DB/Redis deps, volumes `uploads-data`,
  `backup-data`, `license-data` (no `mobile-builds-data` — the worker
  never builds mobile apps). Never runs `startup.sh` (no migrations,
  seeds, or role provisioning — `backend` owns those); entrypoint is
  `node dist/src/worker.main` as the nestjs user, heap
  `WORKER_MAX_OLD_SPACE_SIZE` (default 1536M, container limit 2048M).
  Healthcheck is a process-liveness probe (`kill -0 1`) — the image's
  HTTP healthcheck would fail forever on a process with no HTTP server.
- `WORKER_MODE=all` (default): everything, as today — used by tests and
  local dev. An unknown value falls back to `all` with a warning.

Mechanics (`apps/backend/src/common/worker-mode.ts`): the mode gates
REGISTRATION. Processor classes are left out of their module's providers
in `api` mode, so @nestjs/bullmq never creates a Worker; scheduler
bootstrap hooks (BullMQ repeatable registration, poll loops) early-return
in `worker` mode. There is no `@nestjs/schedule` in this codebase — the
"schedulers" are repeatable registrars + `setInterval` loops; the
repeatables are Redis-owned and idempotent by key, so a registration
attempt from both processes still yields exactly one tick.
`main.ts` refuses `WORKER_MODE=worker` and `worker.main.ts` refuses
`WORKER_MODE=api` (fail fast on a swapped entrypoint).

First-boot note: the api + worker boot at the same time and share the
`license-data` volume. The encryption-key provisioner now writes the key
with exclusive create (`'wx'`): the loser of a first-boot race adopts the
winner's key instead of overwriting it (two different keys would make
rows encrypted by one process unreadable by the other).

Stores-module note: the 8 stores processors + 4 stores schedulers (incl.
the `stock-audit` repeatable in `StockStatusSyncService`) are gated by the
identical mechanism — but the edit is NOT applied yet: `stores.module.ts`
is owned by Builders A/D, so the patch waits on the coordinator (patch
text: `webhook-build-verify/E-worker/stores-module-patch.md` in the
workspace). Until it lands, the split is incomplete in exactly that one
place (see the patch file §5 for what E already gated).

## Webhook lifecycle (2026-11-23, Phase 9 fix — Builder A)

Closes G-01–G-07 (analysis §5). Previously webhooks were never
auto-created, no secret was ever agreed, and nothing healed duplicates
or disabled hooks — on live staging the connected store had zero EcoMate
webhooks registered in Woo.

- **`PUBLIC_API_BASE_URL` (G-04):** required https webhook callback base
  — delivery URLs are `{PUBLIC_API_BASE_URL}/api/webhooks/stores/<slug>/<storeId>`
  (the API host; Caddy routes `/api/webhooks/stores/*` to the backend
  only there). Set in `.env.example` + `docker-compose.yml` backend env
  (from `${PUBLIC_API_BASE_URL:-}`, no hardcoded URL — the worker service
  inherits it via the `*backend-env` anchor) + the Portainer template.
  The VALUES are set at deploy (staging uses its own API host).
  `resolveWebhookCallbackBase()` (`src/stores/webhooks/webhook-callback-base.ts`)
  still fails loudly when unset or non-https.
- **Secret agreement (G-02/G-03):** on connect (and reconnect/rotation)
  a WooCommerce store with no `webhookSecret` gets one server-generated
  (`crypto.randomBytes(32).hex`), persisted encrypted in the store
  secrets blob (merged into the latest credential row — never a bare row
  that would drop the connection credentials). Rotations preserve the
  stored secret when the incoming credentials omit it. `ensureWebhooks`
  sends `secret` in the Woo create payload. Per-provider matrix:
  Shopify NEVER gets a generated secret (HMAC uses the app secret —
  generating one would break verification); Custom NEVER gets one (the
  bridge secret is configured out-of-band on the bridge; a generated
  secret the bridge was never told is unverifiable).
- **Auto-create on connect (G-01):** best-effort ensure after successful
  `connect()` (with secret generation) and after a successful
  `testConnection()` against stored credentials (no secret generation —
  a probe never writes a credential row). An ensure failure NEVER fails
  connect/test: it is logged + an OPEN `WEBHOOK_ENSURE_FAILED` issue row
  is recorded + the outcome is persisted into
  `settings.webhookEnsure` (surfaced by store detail, no schema change).
- **ensureWebhooks rewrite (J-02):** full pagination (Woo per_page=100 up
  to 10 pages; Shopify `since_id`, limit=250, up to 10 pages); match by
  delivery URL + topic + status active; duplicates (>1/topic) → delete
  ALL + recreate one; mismatched URL or non-active → delete + recreate;
  valid → skip. Topics: Woo `order.created/order.updated/order.deleted/
  product.updated`; Shopify `orders/create/orders/updated/orders/delete/
  products/update`. Ownership scope: a hook is OURS only when its URL
  ends with this store's intake path — another integration's hooks are
  never touched. Shopify has no per-hook secret and no hook status
  (documented differences); the bridge protocol §6 has no DELETE/status
  and no `order.deleted` topic (stale/duplicate bridge hooks are
  reported in the result reason for operator action bridge-side).
- **Disabled-hook detection + heal (G-05/G-06/G-07):** hourly
  `webhook-health-tick` (repeatable on `store-maintenance`, :15
  Asia/Dhaka) fans out per tenant via `StoreMaintenanceProcessor` and
  re-runs the ensure per CONNECTED store; heals are logged + recorded
  as a RESOLVED `WEBHOOK_HEALED` issue row. `WebhookHealService`
  (`src/stores/webhooks/webhook-heal.service.ts`) heals on signature
  failure: `maybeHealOnSignatureFailure(storeId, reason)` — secret
  rotation + force-recreate, gated by a 10-minute per-(store, reason)
  cooldown (Redis `webhook:heal:cooldown:<storeId>:<reason>` + in-memory
  fallback); builder B wires the intake call site.

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

## Webhook rate limiting + fairness (G-13/G-14, P2) — webhook fix, workstream D

- **Verified webhooks are NEVER 429'd (hard ceiling).** The
  `store_webhook` policy is now a burst-tolerant TOKEN BUCKET per
  (store, source IP): 600/min sustained refill + 200-token burst,
  env-overridable (`STORE_WEBHOOK_RATE_LIMIT_PER_MIN`,
  `STORE_WEBHOOK_RATE_BURST`). A request carrying a webhook signature
  header (`x-wc-webhook-signature`, `x-shopify-hmac-sha256`,
  `x-ecomate-signature`) bypasses volume limiting at the edge
  entirely — the signature is verified downstream by intake, so a
  signed, VERIFIED delivery can never be 429'd for volume. Excess
  verified traffic is accepted and queued (backpressure at the
  queue, not rejection at the edge). 429 is reserved for UNSIGNED
  floods. Why: Woo never retries a failed delivery and DISABLES the
  webhook after 7 consecutive failures — the old 60/min limit turned
  a flash-sale burst into permanent order loss + a silently dead
  webhook. Trade-off (documented in the guard): a flood of
  FAKE-signature requests also bypasses the edge limiter — each costs
  a resolver-cache lookup + HMAC verify and dies with 401 + a failure
  row. Bounded and cheap; the alternative (a ceiling on signed
  traffic) could 429 a genuine verified delivery, which the pricing
  hard ceiling forbids.
- **Auto-block boundary.** Webhook intake paths never feed the 24h IP
  auto-block except for SCANNER PROBES: the guard calls
  `recordViolation` for `store_webhook` traffic only when the request
  carries NO webhook headers at all. An unsigned request WITH webhook
  headers is a (possibly misconfigured) store — healed, never
  blocked. Verified traffic never reaches the risk scorer.
- **`windowMs` bug — FIXED (was real).** `risk-score.service.ts`
  computed the score-accumulation window with a dead ternary
  (`policy.limits[... ? 'unknown' : 'unknown']` — always the UNKNOWN
  tier, always truthy → always 60000) and then `Math.max(..., 300000)`
  forced EVERY policy to a 5-minute window. The window now scales
  with the policy's own threshold (N violations to block → N minutes
  to accumulate them), floored at 1 min and capped at the old 5-min
  effective ceiling — no policy's window grows past what it was in
  practice.
- **BullMQ priorities (J-04).** `WEBHOOK_PRIORITY = { manual-retry:
  1, webhook: 5, reconciliation: 10 }` (lower = sooner). Queue
  defaults: ingest = 5, reconcile = 10; a manual retry MUST pass 1
  explicitly at its enqueue site (Builder B's replay). Ingest queue:
  attempts 3 + exponential backoff `{ type: 'exponential', delay:
  5000 }` (per Builder B's spec). Every queue using priorities MUST
  set a `defaultJobOptions.priority` — unprioritized (0) jobs go to
  the plain wait list, which BullMQ drains BEFORE the prioritized
  set. Jobs enqueued before this deploy (priority 0) jump the queue
  once, then the queue is clean.
- **Per-tenant in-flight cap (ingest).** Redis counter per tenant,
  default 2 (`STORE_INGEST_PER_TENANT_CONCURRENCY`, 0 disables).
  Jobs over the cap are DELAYED ~1s (BullMQ `moveToDelayed` +
  `DelayedError` — no attempt consumed, priority intact, worker slot
  yielded so another tenant's job runs). Fail-open: limiter trouble
  never blocks a job. **PROVISIONAL: the cap (2) and the ingest
  worker concurrency (5) / limiter (20/s) are provisional pending
  the k6 load test measuring `ordersService.create` cost — do not
  tune from intuition.**
- **Reconcile cap: 5,000 orders/store/run** (50 pages × 100, was 20 ×
  50 = 1,000). Page size 100 is the Woo `per_page` maximum. Runs
  segment: a progress item lands every 10 pages (1,000 orders), and
  a run that hits the cap with more pages remaining enqueues ONE
  continuation run resuming from the exact page/cursor with the
  original window frozen (run metadata `reconcileResume`) — recovery
  drains across bounded runs instead of truncating. Continuations
  queue at priority 10 (behind live webhooks).
- **Redis `noeviction`.** `docker-compose.yml` redis service now
  runs with `--maxmemory-policy noeviction` (covers fresh deploys).
  LIVE instances (staging/prod) need `CONFIG SET maxmemory-policy
  noeviction` applied at deploy + persisted to the Redis config —
  that change is deploy-time, not this commit. With noeviction,
  writes fail loudly when memory is full instead of silently
  evicting BullMQ job data / resolver cache / store locks.
- **Failure-rate alerting (J-12).** `GET /stores/:id/webhooks/health`
  (operator read, `@RequiresFeature('admin_stores')`): delivery
  counts (1h/24h), last verified delivery, ingest failure rate over
  the last hour, open webhook/ingest issues, hook-status heuristic.
  When the rate exceeds `STORE_WEBHOOK_FAILURE_RATE_ALERT_THRESHOLD`
  (default 10%) with at least
  `STORE_WEBHOOK_FAILURE_RATE_MIN_VOLUME` (default 10) items in the
  window, a structured warning log + ONE `WEBHOOK_FAILURE_RATE_HIGH`
  issue row is written (fired on every health read, fire-and-forget;
  Builder A's webhook-health scheduler should also call
  `StoreWebhookHealthService.evaluateAndAlert` per store on its
  hourly tick). Hook status is a heuristic until A's scheduler lands
  (only a live provider poll can know `disabled`). Intake rejections
  are NOT in these counts yet — they land in Builder B's
  `StoreWebhookFailure` table, which this summary should read once
  it exists (follow-up).
