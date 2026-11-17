// Shared helpers for the EcoMate Phase 8 k6 load suite.
//
// All scenarios are parameterized by environment so the same scripts run
// against the local docker stack, staging, or dev servers:
//
//   STOREFRONT_URL  storefront entry point (default http://localhost:3000)
//   BACKEND_URL     backend API base, no /api suffix (default http://localhost:4000)
//   PLATFORM_URL    platform API base, no /api suffix (default http://localhost:4100)
//   BASE_DOMAIN     tenant subdomain base (default ecomate.bd)
//   TENANT_SLUGS    comma-separated tenant slugs (default: tenant-a,tenant-b,tenant-c)
//   CUSTOM_HOSTS    comma-separated custom domains (default: empty)
//   ALIAS_DOMAIN    alias base domain (default: empty — scenario 5 skips alias checks)
//   FALLBACK_DOMAIN fallback base domain (default: empty)
//   AUTH_TOKEN      tenant admin JWT for authed backend calls (optional —
//                   authed steps are skipped without it)
//   INTERNAL_SHARED_SECRET  backend x-internal-secret value. Set this when
//                   load-testing from a single IP: the backend's adaptive
//                   rate limiter allows 100 req/min/IP (UNKNOWN tier) and
//                   auto-blocks the IP at risk score 20, so a shared-IP
//                   load generator trips the abuse blocker within a minute
//                   and the run measures the limiter, not the system.
//                   With the secret, direct backend calls carry
//                   x-internal-secret and are exempt (same mechanism the
//                   storefront's SSR fetches use). The backend must be
//                   started with the same INTERNAL_SHARED_SECRET.
//                   NEVER set this for a public-facing run — it bypasses
//                   the per-IP abuse controls on purpose, for load tests
//                   only.
//   PLATFORM_TOKEN  platform SUPERADMIN/BILLING JWT for job triggers (scenario 6)
//
// Tenants must exist in the platform registry before a run (see README.md):
// the backend resolves hosts from its in-memory registry, refreshed every
// 60s from platform-api.

import { check } from 'k6';

export const STOREFRONT_URL = __ENV.STOREFRONT_URL || 'http://localhost:3000';
export const BACKEND_URL = __ENV.BACKEND_URL || 'http://localhost:4000';
export const PLATFORM_URL = __ENV.PLATFORM_URL || 'http://localhost:4100';
export const BASE_DOMAIN = __ENV.BASE_DOMAIN || 'ecomate.bd';
export const TENANT_SLUGS = (__ENV.TENANT_SLUGS || 'tenant-a,tenant-b,tenant-c')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const CUSTOM_HOSTS = (__ENV.CUSTOM_HOSTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const ALIAS_DOMAIN = __ENV.ALIAS_DOMAIN || '';
export const FALLBACK_DOMAIN = __ENV.FALLBACK_DOMAIN || '';
export const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
export const PLATFORM_TOKEN = __ENV.PLATFORM_TOKEN || '';
export const INTERNAL_SHARED_SECRET = __ENV.INTERNAL_SHARED_SECRET || '';

/**
 * Headers for DIRECT backend calls. Adds x-internal-secret when
 * INTERNAL_SHARED_SECRET is set (see the env comment above) so a
 * single-IP load generator is not auto-blocked by the per-IP abuse
 * controls. Storefront calls use a plain { Host } — the storefront is
 * the browser-facing entry point; its SSR fetches carry the secret
 * server-side when the storefront itself was started with it.
 */
export function backendHeaders(host) {
  return INTERNAL_SHARED_SECRET
    ? { Host: host, 'x-internal-secret': INTERNAL_SHARED_SECRET }
    : { Host: host };
}

/** Tenant subdomain host for a slug, e.g. tenant-a.ecomate.bd. */
export function tenantHost(slug) {
  return `${slug}.${BASE_DOMAIN}`;
}

/** Deterministic per-VU tenant pick (sticky: the same VU always hits the
 *  same tenant, which is what warms that tenant's Prisma client). */
export function vuTenant(vu, tenantCount) {
  const n = tenantCount || TENANT_SLUGS.length;
  return TENANT_SLUGS[(vu - 1) % n];
}

/**
 * Cross-tenant leak check: a response served for `slug` must never mention
 * another tenant's slug. Storefront pages and config payloads are
 * tenant-scoped; any other slug in the body is a leak (or a fixture bug —
 * check the fixture before trusting the alert).
 */
export function checkNoTenantLeak(res, slug, label) {
  const others = TENANT_SLUGS.filter((s) => s !== slug);
  const body = res.body || '';
  const leaked = others.filter((s) => body.includes(s));
  return check(res, {
    [`${label}: no cross-tenant leak`]: () => leaked.length === 0,
  });
}

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
