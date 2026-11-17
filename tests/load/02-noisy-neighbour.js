// Scenario 2 — Noisy neighbour (Phase 8 Stage 2 item 24).
//
// One tenant hammers an uncached endpoint (product search) while the rest
// run the baseline. The neighbours' p95 must not degrade beyond threshold;
// the noisy tenant should hit rate limits, not pool exhaustion for others.
//
//   k6 run tests/load/02-noisy-neighbour.js
//   NOISY_TENANT=tenant-b k6 run tests/load/02-noisy-neighbour.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BACKEND_URL,
  STOREFRONT_URL,
  TENANT_SLUGS,
  backendHeaders,
  checkNoTenantLeak,
  tenantHost,
} from './lib/common.js';

const NOISY_TENANT = __ENV.NOISY_TENANT || TENANT_SLUGS[TENANT_SLUGS.length - 1];
const QUIET_TENANTS = TENANT_SLUGS.filter((s) => s !== NOISY_TENANT);

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 20,
      duration: '4m',
      exec: 'baseline',
    },
    noisy: {
      executor: 'constant-vus',
      vus: 10,
      duration: '4m',
      exec: 'noisy',
      startTime: '30s',
    },
  },
  thresholds: {
    // The neighbours are the assertion: their p95 must hold while the
    // noisy tenant is hammering.
    'http_req_duration{scenario:baseline}': ['p(95)<2500'],
    'http_req_failed{scenario:baseline}': ['rate<0.01'],
    // The noisy tenant may be rate-limited (429) — that is the GOOD
    // outcome; what must not happen is 500s / timeouts from pool
    // exhaustion. k6's failed-rate counts 429s too, so keep this loose
    // and read the status breakdown in the summary instead.
    'http_req_failed{scenario:noisy}': ['rate<0.5'],
  },
};

export function baseline() {
  const slug = QUIET_TENANTS[(__VU - 1) % QUIET_TENANTS.length];
  const host = tenantHost(slug);
  const headers = { Host: host };
  const home = http.get(`${STOREFRONT_URL}/`, { headers });
  check(home, { 'baseline home 200': (r) => r.status === 200 });
  checkNoTenantLeak(home, slug, 'baseline home');
  // Quiet tenants carry the internal secret (when set): they measure
  // neighbour impact, not the rate limiter. The noisy hammer below
  // deliberately does NOT — tripping the limiter is its job.
  const config = http.get(`${BACKEND_URL}/api/system-settings/storefront`, {
    headers: backendHeaders(host),
  });
  check(config, { 'baseline config 200': (r) => r.status === 200 });
  sleep(1);
}

export function noisy() {
  const host = tenantHost(NOISY_TENANT);
  const headers = { Host: host };
  // Uncached search with a rotating query (defeats the 60s cache windows).
  const q = `load-${__VU}-${Date.now()}`;
  const res = http.get(
    `${BACKEND_URL}/api/products/search?q=${encodeURIComponent(q)}`,
    { headers },
  );
  check(res, {
    'noisy search answered (200 or 429, never 500)': (r) =>
      r.status === 200 || r.status === 429,
  });
  // No sleep: this VU is the hammer.
}
