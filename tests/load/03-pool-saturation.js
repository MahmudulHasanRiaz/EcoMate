// Scenario 3 — Pool saturation ramp (Phase 8 Stage 2 item 24, decision D6).
//
// Ramps DISTINCT tenants 10 -> 50 -> 100 -> 150 with sustained concurrency
// and finds the tenant count where saturation begins.
//
// The D6 math (verify against the compose in force before trusting the
// numbers — see README): per-tenant pool max 2 conns, tenant client cache
// TENANT_PRISMA_MAX_CLIENTS=60, Postgres max_connections=300, so the
// theoretical tenant ceiling is 60 cached clients x 2 = 120 connections
// against 300. Past 60 warm tenants the LRU cache evicts (logged at
// tenant-prisma.manager.ts), and evicted tenants pay a cold-client cost;
// past the Postgres ceiling, connectionTimeoutMillis (10s) errors begin.
// This script records both: the eviction-churn onset and the error onset.
//
//   # 150 tenants must exist in the registry first (see README):
//   TENANT_SLUGS=$(python3 -c "print(','.join(f't{i:03d}' for i in range(150)))") \
//     k6 run tests/load/03-pool-saturation.js
//
//   # Shorter run for script validation (not a baseline):
//   k6 run --env STAGES=10,30 --env STAGE_DURATION=30s tests/load/03-pool-saturation.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  BACKEND_URL,
  STOREFRONT_URL,
  TENANT_SLUGS,
  backendHeaders,
  tenantHost,
} from './lib/common.js';

// Tenant counts per stage, e.g. "10,50,100,150".
const STAGE_TENANTS = (__ENV.STAGES || '10,50,100,150')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0);
const STAGE_DURATION = __ENV.STAGE_DURATION || '2m';

const timeoutErrors = new Counter('pool_timeout_errors');
const tenantLatency = new Trend('tenant_first_byte_ms', true);

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      // One VU per tenant at each stage (VU n sticks to tenant n, so the
      // number of warm tenant clients tracks the VU count).
      stages: STAGE_TENANTS.map((n) => ({
        duration: STAGE_DURATION,
        target: n,
      })).concat([{ duration: '30s', target: 0 }]),
    },
  },
  thresholds: {
    // No hard failure threshold here on purpose: the POINT of this script
    // is to find where errors begin. The summary (below) reports the
    // onset; a threshold would just abort the ramp early.
    http_req_failed: [],
  },
};

export function setup() {
  if (TENANT_SLUGS.length < Math.max(...STAGE_TENANTS)) {
    throw new Error(
      `STAGES needs ${Math.max(...STAGE_TENANTS)} tenants but TENANT_SLUGS has ${TENANT_SLUGS.length}. ` +
        'Create the tenants first (see README.md).',
    );
  }
  return { stageTenants: STAGE_TENANTS };
}

export default function () {
  // VU n always hits tenant n: at stage target T, tenants 1..T are warm.
  const slug = TENANT_SLUGS[(__VU - 1) % TENANT_SLUGS.length];
  const host = tenantHost(slug);
  const headers = { Host: host };
  const apiHeaders = backendHeaders(host);

  // A read that warms the tenant's Prisma client (RLS-scoped query).
  const config = http.get(`${BACKEND_URL}/api/system-settings/storefront`, {
    headers: apiHeaders,
    tags: { tenant: slug },
  });
  tenantLatency.add(config.timings.waiting);
  if (config.timings.duration > 10000 || config.status === 0) {
    timeoutErrors.add(1);
  }
  check(config, { 'config 200': (r) => r.status === 200 });

  const home = http.get(`${STOREFRONT_URL}/`, {
    headers,
    tags: { tenant: slug },
  });
  check(home, { 'home 200': (r) => r.status === 200 });

  sleep(0.5);
}

export function handleSummary(data) {
  const failed = data.metrics.http_req_failed?.values?.rate ?? 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const timeouts = data.metrics.pool_timeout_errors?.values?.count ?? 0;
  return {
    stdout: [
      '',
      '=== Pool saturation summary (read with the backend logs) ===',
      `stages (tenants): ${STAGE_TENANTS.join(' -> ')}`,
      `overall http_req_failed rate: ${(failed * 100).toFixed(2)}%`,
      `overall p95: ${p95.toFixed(0)}ms`,
      `slow/timeout responses (>10s or no response): ${timeouts}`,
      'Ceiling rule: the tenant count where http_req_failed first rises',
      'above 1% AND/OR timeouts appear is the real ceiling. Cross-check',
      'against the backend log for LRU eviction lines',
      '(tenant-prisma.manager.ts) — eviction churn onset is the soft',
      'ceiling, connection timeouts are the hard one.',
      '',
    ].join('\n'),
  };
}
