// Scenario 5 — Alias / fallback routing (Phase 8 Stage 2 item 24).
//
// Alias hosts must 301 to canonical; fallback-domain hosts must route to
// the tenant; unknown hosts must 404 — never a tenant shell, never a 500.
// Also exercises the proxy host-cache thundering herd: 1,000+ distinct
// custom hosts collapse the storefront host cache (proxy.ts clears the
// whole cache at 1,000 entries), re-flooding /tenants/resolve.
//
//   ALIAS_DOMAIN=alias.example FALLBACK_DOMAIN=fallback.example \
//     k6 run tests/load/05-alias-fallback.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  ALIAS_DOMAIN,
  BACKEND_URL,
  BASE_DOMAIN,
  FALLBACK_DOMAIN,
  STOREFRONT_URL,
  TENANT_SLUGS,
  tenantHost,
} from './lib/common.js';

const DISTINCT_HOSTS = parseInt(__ENV.DISTINCT_HOSTS || '1200', 10);

export const options = {
  scenarios: {
    alias: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      exec: 'aliasCheck',
    },
    fallback: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      exec: 'fallbackCheck',
    },
    unknown: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      exec: 'unknownCheck',
    },
    herd: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'herdCheck',
      startTime: '30s',
    },
  },
  thresholds: {
    'http_req_failed{scenario:alias}': ['rate<0.01'],
    'http_req_failed{scenario:fallback}': ['rate<0.01'],
    'http_req_failed{scenario:unknown}': ['rate<0.01'],
    'http_req_failed{scenario:herd}': ['rate<0.05'],
  },
};

export function aliasCheck() {
  if (!ALIAS_DOMAIN) {
    // No alias domain configured: nothing to check.
    sleep(1);
    return;
  }
  const slug = TENANT_SLUGS[(__VU - 1) % TENANT_SLUGS.length];
  const res = http.get(`${STOREFRONT_URL}/`, {
    headers: { Host: `${slug}.${ALIAS_DOMAIN}` },
    redirects: 0,
  });
  check(res, {
    'alias 301 to canonical': (r) =>
      r.status === 301 &&
      (r.headers.Location || '').includes(`${slug}.${BASE_DOMAIN}`),
  });
  sleep(0.5);
}

export function fallbackCheck() {
  if (!FALLBACK_DOMAIN) {
    sleep(1);
    return;
  }
  const slug = TENANT_SLUGS[(__VU - 1) % TENANT_SLUGS.length];
  const res = http.get(`${STOREFRONT_URL}/`, {
    headers: { Host: `${slug}.${FALLBACK_DOMAIN}` },
  });
  check(res, {
    'fallback host serves the tenant': (r) => r.status === 200,
  });
  sleep(0.5);
}

export function unknownCheck() {
  // An unknown host must 404 — never a tenant shell, never a 500.
  const res = http.get(`${STOREFRONT_URL}/`, {
    headers: { Host: `nobody-${__VU}.unknown.example` },
  });
  check(res, {
    'unknown host 404': (r) => r.status === 404,
    'unknown host is not a tenant shell': (r) =>
      !(r.body || '').includes(TENANT_SLUGS[0]),
  });
  sleep(0.5);
}

export function herdCheck() {
  // Distinct custom hosts, cycling past the 1,000-entry proxy cache cap.
  // Each host hits the resolve endpoint path; the measure is whether the
  // cache collapse (clear at 1,000) shows up as a latency/error spike.
  const i = Math.floor(Math.random() * DISTINCT_HOSTS);
  const host = `custom-${i}.example.com`;
  const res = http.get(
    `${BACKEND_URL}/api/tenants/resolve?host=${encodeURIComponent(host)}`,
    { headers: { Host: host } },
  );
  check(res, {
    'resolve answers (200 or 404, never 500)': (r) =>
      r.status === 200 || r.status === 404,
  });
  sleep(0.2);
}
