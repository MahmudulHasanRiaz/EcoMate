// Scenario 1 — Baseline mixed load (Phase 8 Stage 2 item 24).
//
// Mostly storefront reads, some backend public reads, a few authed admin
// reads when AUTH_TOKEN is set. Asserts p95/p99, error rate, and that no
// response ever carries another tenant's data.
//
//   k6 run tests/load/01-baseline.js
//   k6 run --env STOREFRONT_URL=http://localhost:3000 \
//          --env TENANT_SLUGS=acme,beta,gamma tests/load/01-baseline.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  AUTH_TOKEN,
  BACKEND_URL,
  STOREFRONT_URL,
  authHeaders,
  backendHeaders,
  checkNoTenantLeak,
  tenantHost,
  vuTenant,
} from './lib/common.js';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    'http_req_duration{scenario:storefront}': ['p(95)<2500'],
  },
};

export default function () {
  const slug = vuTenant(__VU);
  const host = tenantHost(slug);
  const headers = { Host: host };
  const apiHeaders = backendHeaders(host);

  // Storefront SSR (ISR pages; TTFB cold vs warm shows in the duration trend).
  const home = http.get(`${STOREFRONT_URL}/`, { headers, tags: { scenario: 'storefront' } });
  check(home, { 'home 200': (r) => r.status === 200 });
  checkNoTenantLeak(home, slug, 'home');

  const products = http.get(`${STOREFRONT_URL}/products`, {
    headers,
    tags: { scenario: 'storefront' },
  });
  check(products, { 'products 200': (r) => r.status === 200 });
  checkNoTenantLeak(products, slug, 'products');

  // Backend public reads (hottest: storefront config).
  const config = http.get(`${BACKEND_URL}/api/system-settings/storefront`, {
    headers: apiHeaders,
    tags: { scenario: 'backend-public' },
  });
  check(config, { 'storefront config 200': (r) => r.status === 200 });
  checkNoTenantLeak(config, slug, 'config');

  const list = http.get(`${BACKEND_URL}/api/products?limit=12`, {
    headers: apiHeaders,
    tags: { scenario: 'backend-public' },
  });
  check(list, { 'products list 200': (r) => r.status === 200 });

  // Authed admin read (skipped without a token — see README).
  if (AUTH_TOKEN) {
    const orders = http.get(`${BACKEND_URL}/api/orders?limit=10`, {
      headers: { ...apiHeaders, ...authHeaders(AUTH_TOKEN) },
      tags: { scenario: 'backend-authed' },
    });
    check(orders, { 'orders 200': (r) => r.status === 200 });
  }

  sleep(1);
}
