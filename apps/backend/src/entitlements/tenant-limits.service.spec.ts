import { ForbiddenException } from '@nestjs/common';
import { TenantLimitsService } from './tenant-limits.service';

function mockService(limits: Record<string, unknown> = {}) {
  const entitlements = {
    getLimits: jest.fn().mockReturnValue(limits),
    getPlanName: jest.fn().mockReturnValue('Growth'),
    getAccessState: jest.fn().mockReturnValue('full'),
  };
  const prisma = {
    product: { count: jest.fn().mockResolvedValue(0) },
    userProfile: { count: jest.fn().mockResolvedValue(0) },
    order: { count: jest.fn().mockResolvedValue(0) },
    media: { aggregate: jest.fn().mockResolvedValue({ _sum: { size: 0 } }) },
    store: { count: jest.fn().mockResolvedValue(0) },
  };
  return {
    entitlements,
    prisma,
    service: new TenantLimitsService(entitlements as any, prisma as any),
  };
}

describe('TenantLimitsService', () => {
  describe('getLimit', () => {
    it('treats an absent key as unlimited', () => {
      const { service } = mockService({});
      expect(service.getLimit('products')).toBeNull();
    });

    it.each([['abc'], [-1], [null], [Number.NaN]])(
      'treats %s as unlimited instead of locking the tenant out',
      (value) => {
        const { service } = mockService({ products: value });
        expect(service.getLimit('products')).toBeNull();
      },
    );

    it('floors a valid limit', () => {
      const { service } = mockService({ products: 12.9 });
      expect(service.getLimit('products')).toBe(12);
    });
  });

  describe('usage counters', () => {
    it('counts published products only (drafts do not consume quota)', async () => {
      const { service, prisma } = mockService({ products: 100 });
      await service.getUsage('products');
      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { status: { not: 'draft' } },
      });
    });

    it('counts staff users only', async () => {
      const { service, prisma } = mockService({ staff_users: 5 });
      await service.getUsage('staff_users');
      expect(prisma.userProfile.count).toHaveBeenCalledWith({
        where: { role: { not: 'customer' } },
      });
    });

    it('counts non-trashed orders created in the current Dhaka month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-01T00:30:00.000Z'));
      try {
        const { service, prisma } = mockService({ orders_per_month: 10 });
        await service.getUsage('orders_per_month');
        expect(prisma.order.count).toHaveBeenCalledWith({
          where: {
            trashedAt: null,
            createdAt: { gte: new Date('2026-10-31T18:00:00.000Z') },
          },
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports media storage in whole megabytes', async () => {
      const { service, prisma } = mockService({ storage_mb: 100 });
      prisma.media.aggregate.mockResolvedValue({
        _sum: { size: Math.round(1.5 * 1024 * 1024) },
      });
      expect(await service.getUsage('storage_mb')).toBe(2);
    });

    it('counts orders in a half-open [from, to) window when one is given', async () => {
      const { service, prisma } = mockService({ orders_per_month: 10 });
      const from = new Date('2026-11-01T00:00:00.000Z');
      const to = new Date('2026-12-01T00:00:00.000Z');
      prisma.order.count.mockResolvedValue(42);

      expect(
        await service.getUsage('orders_per_month', { from, to }),
      ).toBe(42);
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          trashedAt: null,
          // Half-open: an order created exactly at `to` belongs to the
          // next period, never to both.
          createdAt: { gte: from, lt: to },
        },
      });
    });

    it('ignores the window for point-in-time counters', async () => {
      const { service, prisma } = mockService({ products: 100 });
      const window = {
        from: new Date('2026-11-01T00:00:00.000Z'),
        to: new Date('2026-12-01T00:00:00.000Z'),
      };

      await service.getUsage('products', window);

      expect(prisma.product.count).toHaveBeenCalledWith({
        where: { status: { not: 'draft' } },
      });
    });

    it('counts non-NATIVE, non-DISCONNECTED stores only (Phase 9 §5.2)', async () => {
      const { service, prisma } = mockService({ external_stores: 3 });
      prisma.store.count.mockResolvedValue(2);
      expect(await service.getUsage('external_stores')).toBe(2);
      expect(prisma.store.count).toHaveBeenCalledWith({
        where: { kind: { not: 'NATIVE' }, status: { not: 'DISCONNECTED' } },
      });
    });
  });

  describe('assertWithinLimit', () => {
    it('does nothing when the plan does not define the limit', async () => {
      const { service, prisma } = mockService({});
      await expect(service.assertWithinLimit('products')).resolves.toBeUndefined();
      expect(prisma.product.count).not.toHaveBeenCalled();
    });

    it('allows the last unit under the cap', async () => {
      const { service, prisma } = mockService({ products: 100 });
      prisma.product.count.mockResolvedValue(99);
      await expect(service.assertWithinLimit('products')).resolves.toBeUndefined();
    });

    it('blocks the unit that would exceed the cap', async () => {
      const { service, prisma } = mockService({ products: 100 });
      prisma.product.count.mockResolvedValue(100);
      await expect(service.assertWithinLimit('products')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.assertWithinLimit('products')).rejects.toThrow(
        'Plan limit reached for Products (100/100). Upgrade your plan to continue.',
      );
    });

    it('blocks everything for a zero limit', async () => {
      const { service } = mockService({ products: 0 });
      await expect(service.assertWithinLimit('products')).rejects.toThrow(
        /Plan limit reached for Products \(0\/0\)/,
      );
    });

    it('blocks storage once the cap is reached (amount 0)', async () => {
      const { service, prisma } = mockService({ storage_mb: 10 });
      prisma.media.aggregate.mockResolvedValue({
        _sum: { size: 10 * 1024 * 1024 },
      });
      await expect(
        service.assertWithinLimit('storage_mb', 0),
      ).rejects.toThrow(/Plan limit reached for Media storage \(MB\) \(10\/10\)/);
    });
  });

  describe('getUsageSnapshot', () => {
    it('reports every counter with percent + 80% warning', async () => {
      const { service, prisma } = mockService({
        products: 100,
        storage_mb: 10,
      });
      prisma.product.count.mockResolvedValue(85);
      prisma.userProfile.count.mockResolvedValue(4);
      prisma.order.count.mockResolvedValue(12);
      prisma.media.aggregate.mockResolvedValue({
        _sum: { size: 2 * 1024 * 1024 },
      });

      const snapshot = await service.getUsageSnapshot();

      expect(snapshot.planName).toBe('Growth');
      expect(snapshot.accessState).toBe('full');
      expect(snapshot.limits).toEqual([
        {
          key: 'products',
          label: 'Products',
          limit: 100,
          used: 85,
          percent: 85,
          warning: true,
        },
        {
          key: 'staff_users',
          label: 'Staff users',
          limit: null,
          used: 4,
          percent: null,
          warning: false,
        },
        {
          key: 'orders_per_month',
          label: 'Orders per month',
          limit: null,
          used: 12,
          percent: null,
          warning: false,
        },
        {
          key: 'storage_mb',
          label: 'Media storage (MB)',
          limit: 10,
          used: 2,
          percent: 20,
          warning: false,
        },
        {
          key: 'external_stores',
          label: 'External stores',
          limit: null,
          used: 0,
          percent: null,
          warning: false,
        },
      ]);
    });

    it('handles a zero cap without dividing by zero', async () => {
      const { service, prisma } = mockService({ products: 0 });
      prisma.product.count.mockResolvedValue(0);
      const snapshot = await service.getUsageSnapshot();
      expect(snapshot.limits[0]).toMatchObject({
        limit: 0,
        used: 0,
        percent: 0,
        warning: false,
      });

      prisma.product.count.mockResolvedValue(3);
      const over = await service.getUsageSnapshot();
      expect(over.limits[0]).toMatchObject({ percent: 100, warning: true });
    });
  });
});
