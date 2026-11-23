/**
 * Phase 9 G-14 — per-tenant in-flight fairness (TenantFairnessLimiter).
 *
 * One tenant's burst must not starve other tenants on the shared
 * ingest queue: a Redis counter per (queue, tenant) caps concurrent
 * jobs (default 2). Jobs over the cap WAIT (delayed, never failed —
 * see tenant-job-fairness.spec.ts for the worker side).
 *
 * These specs run the limiter against its in-memory fallback
 * (REDIS_URL points at a dead port): same acquire/release semantics
 * as the Redis Lua path, deterministic without a server.
 */
import {
  FAIRNESS_DEFAULT_CAP,
  TenantFairnessLimiter,
  ingestPerTenantCap,
} from './tenant-fairness';

const DEAD_REDIS_ENV = {
  REDIS_URL: 'redis://127.0.0.1:6399',
  STORE_INGEST_PER_TENANT_CONCURRENCY: undefined,
};

describe('ingestPerTenantCap', () => {
  it('defaults to 2', () => {
    expect(FAIRNESS_DEFAULT_CAP).toBe(2);
    expect(ingestPerTenantCap({})).toBe(2);
    expect(ingestPerTenantCap({ STORE_INGEST_PER_TENANT_CONCURRENCY: '' })).toBe(2);
  });

  it('reads the env override', () => {
    expect(ingestPerTenantCap({ STORE_INGEST_PER_TENANT_CONCURRENCY: '5' })).toBe(5);
    expect(ingestPerTenantCap({ STORE_INGEST_PER_TENANT_CONCURRENCY: '3.9' })).toBe(3);
  });

  it('treats 0 / negative as "cap disabled"', () => {
    expect(ingestPerTenantCap({ STORE_INGEST_PER_TENANT_CONCURRENCY: '0' })).toBe(0);
    expect(ingestPerTenantCap({ STORE_INGEST_PER_TENANT_CONCURRENCY: '-1' })).toBe(-1);
  });

  it('falls back to the default on non-numeric env', () => {
    expect(ingestPerTenantCap({ STORE_INGEST_PER_TENANT_CONCURRENCY: 'abc' })).toBe(2);
  });
});

describe('TenantFairnessLimiter (in-memory path)', () => {
  let limiter: TenantFairnessLimiter;

  beforeEach(() => {
    limiter = new TenantFairnessLimiter('test-fairness', { ...DEAD_REDIS_ENV });
  });

  afterEach(() => {
    limiter.destroy();
  });

  it('holds the cap under a simulated burst: 2 run, the rest wait', async () => {
    const tenant = 'tenant-burst';
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(await limiter.tryAcquire('store-order-ingest', tenant));
    }
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(results.filter((r) => !r)).toHaveLength(8);
    expect(await limiter.inFlight('store-order-ingest', tenant)).toBe(2);
  });

  it('releases slots so waiting jobs can proceed', async () => {
    const tenant = 'tenant-release';
    expect(await limiter.tryAcquire('store-order-ingest', tenant)).toBe(true);
    expect(await limiter.tryAcquire('store-order-ingest', tenant)).toBe(true);
    expect(await limiter.tryAcquire('store-order-ingest', tenant)).toBe(false);
    await limiter.release('store-order-ingest', tenant);
    expect(await limiter.tryAcquire('store-order-ingest', tenant)).toBe(true);
    expect(await limiter.inFlight('store-order-ingest', tenant)).toBe(2);
  });

  it('isolates tenants: one tenant at cap does not block another', async () => {
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-a')).toBe(true);
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-a')).toBe(true);
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-a')).toBe(false);
    // Tenant B is unaffected by A's burst.
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-b')).toBe(true);
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-b')).toBe(true);
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-b')).toBe(false);
  });

  it('isolates queues: the ingest cap does not touch other queues', async () => {
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-q')).toBe(true);
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-q')).toBe(true);
    expect(await limiter.tryAcquire('store-reconcile', 'tenant-q')).toBe(true);
    expect(await limiter.tryAcquire('store-reconcile', 'tenant-q')).toBe(true);
  });

  it('disables the cap entirely when env is 0 (single-tenant escape hatch)', async () => {
    const unlimited = new TenantFairnessLimiter('test-fairness', {
      ...DEAD_REDIS_ENV,
      STORE_INGEST_PER_TENANT_CONCURRENCY: '0',
    });
    try {
      const results: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        results.push(await unlimited.tryAcquire('store-order-ingest', 'tenant-free'));
      }
      expect(results.every(Boolean)).toBe(true);
    } finally {
      unlimited.destroy();
    }
  });

  it('honours a raised env cap', async () => {
    const wide = new TenantFairnessLimiter('test-fairness', {
      ...DEAD_REDIS_ENV,
      STORE_INGEST_PER_TENANT_CONCURRENCY: '4',
    });
    try {
      const results: boolean[] = [];
      for (let i = 0; i < 6; i++) {
        results.push(await wide.tryAcquire('store-order-ingest', 'tenant-wide'));
      }
      expect(results.filter(Boolean)).toHaveLength(4);
    } finally {
      wide.destroy();
    }
  });

  it('release without acquire is safe (no negative counts)', async () => {
    await limiter.release('store-order-ingest', 'tenant-ghost');
    expect(await limiter.inFlight('store-order-ingest', 'tenant-ghost')).toBe(0);
    expect(await limiter.tryAcquire('store-order-ingest', 'tenant-ghost')).toBe(true);
  });
});
