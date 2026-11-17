// Scenario 4 — Cache stampede / cold start (Phase 8 Stage 2 item 24).
//
// Run immediately after a storefront restart (cold Next.js Data Cache) or
// after a mass revalidation, then ramp all tenants at once. Measures
// backend request amplification and time-to-stable p95.
//
//   # Cold start: restart the storefront, then within seconds run:
//   k6 run tests/load/04-cache-stampede.js
//
//   # Or trigger revalidation first (needs the revalidate secret):
//   REVALIDATE_SECRET=... k6 run tests/load/04-cache-stampede.js
//   (the script calls POST /api/revalidate for each tenant in setup())

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  BACKEND_URL,
  STOREFRONT_URL,
  TENANT_SLUGS,
  backendHeaders,
  tenantHost,
  vuTenant,
} from './lib/common.js';

const REVALIDATE_SECRET = __ENV.REVALIDATE_SECRET || '';
const coldP95 = new Trend('cold_start_p95_ms', true);

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    // Cold start WILL be slow; the assertion is that it stabilises.
    // Read the trend in the summary, not the threshold.
    http_req_duration: ['p(95)<8000'],
  },
};

export function setup() {
  if (!REVALIDATE_SECRET) {
    console.log(
      'No REVALIDATE_SECRET: assuming the storefront was just restarted ' +
        '(cold Data Cache). For a revalidation stampede instead, set REVALIDATE_SECRET.',
    );
    return {};
  }
  // Mass revalidation across tenants: every tenant's products tag at once.
  for (const slug of TENANT_SLUGS) {
    const res = http.post(
      `${STOREFRONT_URL}/api/revalidate`,
      JSON.stringify({ tag: `t:${slug}:products` }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${REVALIDATE_SECRET}`,
          Host: tenantHost(slug),
        },
      },
    );
    check(res, { [`revalidate ${slug} ok`]: (r) => r.status < 300 });
  }
  return {};
}

export default function () {
  const slug = vuTenant(__VU);
  const host = tenantHost(slug);
  const headers = { Host: host };

  // Same hot pages every VU hits at once: the stampede.
  const products = http.get(`${STOREFRONT_URL}/products`, { headers });
  coldP95.add(products.timings.duration);
  check(products, { 'products 200': (r) => r.status === 200 });

  const config = http.get(`${BACKEND_URL}/api/system-settings/storefront`, {
    headers: backendHeaders(host),
  });
  check(config, { 'config 200': (r) => r.status === 200 });

  sleep(0.2);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 0;
  const total = data.metrics.http_reqs?.values?.count ?? 0;
  return {
    stdout: [
      '',
      '=== Cache stampede summary ===',
      `total requests: ${total}`,
      `p95: ${p95.toFixed(0)}ms, p99: ${p99.toFixed(0)}ms`,
      'Read time-to-stable from the k6 time-series (or the /metrics',
      'http_request_duration_seconds histogram): the stampede is over when',
      'p95 returns to the baseline value from scenario 01.',
      'Backend amplification = backend request count during the stampede',
      'vs the same VU count warm (scenario 01).',
      '',
    ].join('\n'),
  };
}
