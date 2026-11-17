// Scenario 6 — Billing-job contention (Phase 8 Stage 2 item 24).
//
// Baseline platform load (health + public pricing + registry reads) while
// a full billing run (POST /api/jobs/all/run) executes mid-load. Billing
// jobs, signup, and the backend registry refresh share the platform-api
// pool (max 10), so the run must not starve the platform API.
//
//   PLATFORM_TOKEN=<superadmin-or-billing-jwt> k6 run tests/load/06-billing-contention.js
//
// Without PLATFORM_TOKEN the job trigger is skipped and the script is just
// a platform baseline (still useful, but not the contention test).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { PLATFORM_URL, authHeaders } from './lib/common.js';

const JOB_TRIGGER_AT_SECONDS = parseInt(
  __ENV.JOB_TRIGGER_AT_SECONDS || '60',
  10,
);

export const options = {
  scenarios: {
    platformLoad: {
      executor: 'constant-vus',
      vus: 15,
      duration: '4m',
      exec: 'platformLoad',
    },
    jobTrigger: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      exec: 'triggerJobs',
      startTime: `${JOB_TRIGGER_AT_SECONDS}s`,
    },
  },
  thresholds: {
    // Platform reads must stay responsive DURING the billing run.
    'http_req_duration{scenario:platformLoad}': ['p(95)<1500'],
    'http_req_failed{scenario:platformLoad}': ['rate<0.01'],
  },
};

export function platformLoad() {
  const health = http.get(`${PLATFORM_URL}/api/health`);
  check(health, { 'platform health 200': (r) => r.status === 200 });

  const plans = http.get(`${PLATFORM_URL}/api/public/plans`);
  check(plans, {
    'public plans 200': (r) => r.status === 200,
  });

  // Registry refresh is the backend's 60s dependency on the platform pool.
  // Guarded by x-platform-service-token (INTERNAL_SERVICE_SECRET).
  const registryHeaders = __ENV.INTERNAL_TOKEN
    ? { 'x-platform-service-token': __ENV.INTERNAL_TOKEN }
    : {};
  const registry = http.get(
    `${PLATFORM_URL}/api/internal/tenants/registry`,
    { headers: registryHeaders },
  );
  check(registry, {
    'registry reachable (200, or 401 without INTERNAL_TOKEN)': (r) =>
      r.status === 200 || r.status === 401,
  });

  sleep(1);
}

export function triggerJobs() {
  if (!__ENV.PLATFORM_TOKEN) {
    console.log(
      'No PLATFORM_TOKEN: skipping the billing-job trigger (platform ' +
        'baseline only).',
    );
    return;
  }
  const res = http.post(
    `${PLATFORM_URL}/api/jobs/all/run`,
    null,
    { headers: authHeaders(__ENV.PLATFORM_TOKEN) },
  );
  check(res, {
    'billing run accepted': (r) => r.status === 200 || r.status === 201,
  });
  console.log(
    `Billing run triggered at ${JOB_TRIGGER_AT_SECONDS}s: status ${res.status}`,
  );
}
