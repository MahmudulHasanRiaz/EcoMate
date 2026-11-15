import {
  CacheService,
  isProtectedRedisKey,
} from '../cache.service';
import { runWithTenant } from '../../tenancy/tenant-context';

/**
 * CacheService.clearAll tests (P0 stale-bundle round, 2026-11-12).
 *
 * Real gap this closes: the old `clear()` only emptied the in-memory
 * mirror — Redis entries (the shared cache the whole backend reads)
 * survived a "clear". `clearAll()` clears both.
 *
 * The shared Redis also holds NON-cache state that a purge must NEVER
 * delete: BullMQ job keys (`bull:`), the rate-limit counters (`rl:`)
 * and the login/order brute-force counters (`ratelimit:`). Those
 * prefixes are protected by construction, never by FLUSHDB.
 */
describe('CacheService.clearAll', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env['REDIS_URL'];
    delete process.env['REDIS_HOST'];
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('never treats queue / rate-limit keys as cache', () => {
    expect(isProtectedRedisKey('bull:email:123')).toBe(true);
    expect(isProtectedRedisKey('rl:tenant:policy:tier:id')).toBe(true);
    expect(isProtectedRedisKey('ratelimit:login:1.2.3.4')).toBe(true);
    expect(isProtectedRedisKey('ratelimit:order:1.2.3.4')).toBe(true);
  });

  it('treats real cache keys as purgeable', () => {
    expect(isProtectedRedisKey('analytics:sales-kpi::')).toBe(false);
    expect(isProtectedRedisKey('storefront:config')).toBe(false);
    expect(isProtectedRedisKey('categories:tree')).toBe(false);
    expect(isProtectedRedisKey('courier:token:pathao')).toBe(false);
    expect(isProtectedRedisKey('product:123')).toBe(false);
    expect(isProtectedRedisKey('bullish:lookalike')).toBe(false);
  });

  it('clears the in-memory store and reports counts without Redis', async () => {
    const service = new CacheService();
    try {
      await service.set('analytics:x', { a: 1 });
      await service.set('storefront:config', { b: 2 });
      expect(await service.get('analytics:x')).toEqual({ a: 1 });

      const result = await service.clearAll();

      expect(result.memoryCleared).toBe(2);
      expect(result.redisAvailable).toBe(false);
      expect(result.redisDeleted).toBe(0);
      expect(await service.get('analytics:x')).toBeUndefined();
      expect(await service.get('storefront:config')).toBeUndefined();
    } finally {
      service.onModuleDestroy();
    }
  });

  it('clear() still only clears memory (documented behaviour, not a purge)', async () => {
    const service = new CacheService();
    try {
      await service.set('analytics:x', { a: 1 });
      service.clear();
      expect(await service.get('analytics:x')).toBeUndefined();
    } finally {
      service.onModuleDestroy();
    }
  });
});

describe('CacheService tenant scoping', () => {
  const tenantA = { tenantId: 'tenant-a', slug: 'alpha' };
  const tenantB = { tenantId: 'tenant-b', slug: 'beta' };

  it('namespaces set/get/delete per tenant', async () => {
    const service = new CacheService();
    try {
      await runWithTenant(tenantA, async () => {
        await service.set('categories:tree', { a: 1 });
        expect((service as any).store.has('t:tenant-a:categories:tree')).toBe(
          true,
        );
        expect(await service.get('categories:tree')).toEqual({ a: 1 });
      });

      await runWithTenant(tenantB, async () => {
        // The first tenant's entry is invisible here.
        expect(await service.get('categories:tree')).toBeUndefined();
        await service.set('categories:tree', { b: 2 });
      });

      await runWithTenant(tenantA, async () => {
        await service.delete('categories:tree');
        expect(await service.get('categories:tree')).toBeUndefined();
      });

      await runWithTenant(tenantB, async () => {
        expect(await service.get('categories:tree')).toEqual({ b: 2 });
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('scopes prefix invalidation and counts per tenant', async () => {
    const service = new CacheService();
    try {
      await runWithTenant(tenantA, async () => {
        await service.set('product:1', { a: 1 });
        await service.set('product:2', { a: 2 });
      });
      await runWithTenant(tenantB, async () => {
        await service.set('product:1', { b: 1 });
      });

      await runWithTenant(tenantA, async () => {
        await service.invalidateByPrefix('product:');
        expect(await service.countByPrefix('product:')).toBe(0);
      });

      await runWithTenant(tenantB, async () => {
        expect(await service.countByPrefix('product:')).toBe(1);
        expect(await service.get('product:1')).toEqual({ b: 1 });
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('keeps the raw key outside a tenant context (global infra)', async () => {
    const service = new CacheService();
    try {
      await service.set('system:backup-maintenance', { mode: 'restore' });
      expect(
        (service as any).store.has('system:backup-maintenance'),
      ).toBe(true);
      expect(await service.get('system:backup-maintenance')).toEqual({
        mode: 'restore',
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it('clearAll purges only the current tenant cache', async () => {
    const service = new CacheService();
    try {
      await runWithTenant(tenantA, async () => {
        await service.set('categories:tree', { a: 1 });
        await service.set('product:1', { a: 1 });
      });
      await runWithTenant(tenantB, async () => {
        await service.set('categories:tree', { b: 2 });
      });

      const result = await runWithTenant(tenantA, () => service.clearAll());

      expect(result.memoryCleared).toBe(2);
      await runWithTenant(tenantA, async () => {
        expect(await service.get('categories:tree')).toBeUndefined();
      });
      await runWithTenant(tenantB, async () => {
        expect(await service.get('categories:tree')).toEqual({ b: 2 });
      });
    } finally {
      service.onModuleDestroy();
    }
  });
});
