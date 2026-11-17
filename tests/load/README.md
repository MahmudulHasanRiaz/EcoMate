# EcoMate k6 load suite (Phase 8 Stage 2, item 24)

Six scenarios, grounded in the actual architecture (audit `02-load-observability-backup.md` §5.2):

| # | Script | What it proves |
|---|--------|----------------|
| 1 | `01-baseline.js` | Mixed storefront + backend load; p95/p99, error rate, **no cross-tenant data leak** |
| 2 | `02-noisy-neighbour.js` | One tenant hammers uncached search; neighbours' p95 must hold (rate limits, not pool exhaustion) |
| 3 | `03-pool-saturation.js` | Ramp distinct tenants 10 → 50 → 100 → 150; finds the **real tenant ceiling** (eviction churn + connection-timeout onset) |
| 4 | `04-cache-stampede.js` | Cold Data Cache / mass revalidation; backend amplification + time-to-stable p95 |
| 5 | `05-alias-fallback.js` | Alias 301, fallback routing, unknown-host 404 (never a tenant shell), proxy host-cache thundering herd |
| 6 | `06-billing-contention.js` | Billing run mid-load; platform pool (max 10) must not starve health/pricing/registry reads |

## The D6 pool math (verify before trusting the numbers)

- Per-tenant backend pool: **max 2 connections** per tenant client (`tenant-prisma.manager.ts`).
- Tenant client cache: `TENANT_PRISMA_MAX_CLIENTS` (compose sets **60**; code default 100).
- Postgres `max_connections` (compose sets **300**).
- Platform-api pool: **max 10**.

Theoretical tenant ceiling: 60 cached clients × 2 = **120 tenant connections** against 300. Past 60 warm tenants the LRU cache evicts (logged); past the Postgres ceiling, `connectionTimeoutMillis` (10s) errors begin. Scenario 3 measures both onsets — the **eviction-churn onset is the soft ceiling, connection timeouts the hard one**. Record the compose values in force for every run (CPU/memory limits too — see audit §5.3).

## Running

```bash
# Install k6 v2.4.0 (static binary; the proxy blocks some CDNs but GitHub releases work)
curl -sSL -o /tmp/k6.tar.gz \
  https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-linux-amd64.tar.gz
tar -xzf /tmp/k6.tar.gz -C /tmp
mkdir -p ~/.local/bin && cp /tmp/k6-v2.4.0-linux-amd64/k6 ~/.local/bin/k6
~/.local/bin/k6 version   # expect: k6 v2.4.0

# Against the local docker stack (preferred — the only faithful multi-tenant target)
k6 run tests/load/01-baseline.js

# Against dev servers (script validation only, NOT a baseline)
STOREFRONT_URL=http://localhost:3000 BACKEND_URL=http://localhost:4000 \
  PLATFORM_URL=http://localhost:4100 k6 run tests/load/01-baseline.js
```

## Rate limiter vs load generator (read before running)

The backend's adaptive rate limiter allows **100 req/min/IP** (UNKNOWN
tier) and auto-blocks the IP at risk score 20 (60 min, per tenant). A k6
run from a single IP trips that within a minute — the first baseline run
(2026-11-17) failed exactly this way: backend checks at 41–44% with
`Risk-score auto-block` lines in the backend log, while storefront checks
passed on ISR cache. That run measured the abuse blocker, not the system.

Fix: start the backend **and** the storefront with the same
`INTERNAL_SHARED_SECRET`, and pass it to k6 as
`INTERNAL_SHARED_SECRET`. Direct backend calls then carry
`x-internal-secret` and are exempt (the same mechanism the storefront's
SSR fetches use; the exemption also requires a private/loopback TCP
peer). Scenario 2's noisy hammer deliberately does NOT carry it —
tripping the limiter is its job — while its quiet-tenant baseline calls
do. Never set this for a public-facing run.

All scenarios are parameterized by env — see `lib/common.js` for the full list (`STOREFRONT_URL`, `BACKEND_URL`, `PLATFORM_URL`, `BASE_DOMAIN`, `TENANT_SLUGS`, `CUSTOM_HOSTS`, `ALIAS_DOMAIN`, `FALLBACK_DOMAIN`, `AUTH_TOKEN`, `PLATFORM_TOKEN`, `INTERNAL_TOKEN`, `REVALIDATE_SECRET`, `NOISY_TENANT`, `STAGES`, `STAGE_DURATION`, `DISTINCT_HOSTS`, `JOB_TRIGGER_AT_SECONDS`).

## Test data: tenants must exist first

The backend resolves hosts from its in-memory registry (refreshed every 60s from platform-api `GET /internal/tenants/registry`). Before a run, create the tenants — e.g. via the platform signup flow, or directly in the platform DB:

```sql
-- platform DB: one row per load tenant (minimal fields; the registry only
-- needs id/slug/status/domains/subscription/planVersion)
INSERT INTO "Tenant" (id, slug, name, status, "ownerEmail", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 't' || lpad(g::text, 3, '0'), 'Load tenant ' || g,
       'ACTIVE', 'load-' || g || '@example.test', now(), now()
FROM generate_series(1, 150) g;
```

Wait **60s+** after creating tenants before starting (registry refresh), or restart the backend. Purge the load tenants after the run.

## Auth tokens

- `AUTH_TOKEN` — a tenant admin JWT (login as a tenant superadmin/admin via the backend `/api/auth/login`, or mint one the same way the E2E scripts do). Without it, authed steps are skipped.
- `PLATFORM_TOKEN` — a platform SUPERADMIN/BILLING JWT (scenario 6 job trigger). Create a disposable BILLING platform user for the run; do not use the seed admin (MFA-enrolled).
- `INTERNAL_TOKEN` — `INTERNAL_SERVICE_SECRET` (scenario 6 registry check).
- `REVALIDATE_SECRET` — the storefront revalidate secret (scenario 4 mass-revalidation variant).

## Thresholds are staging-relative

The thresholds in these scripts are starting points against staging hardware. The compose resource limits (backend 1 CPU / 1536M, storefront 1 CPU / 512M, postgres 1 CPU / 1024M, redis 0.5 CPU / 256M) cap what any run can show — record the limits in force alongside every result, and re-tune thresholds per environment rather than weakening them to pass.
