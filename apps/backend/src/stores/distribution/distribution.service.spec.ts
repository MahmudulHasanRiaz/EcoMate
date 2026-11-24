/**
 * DistributionService spec — central-commerce §8.2 + §8.2.1 + §10 (P3).
 *
 * Row-level storeId validation on every mutation; NATIVE rejected 400 on
 * writes and excluded from bulk; bulk >50 enqueues; assignment/rule
 * mutations never write Product rows (storefront read path untouched).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DistributionService } from './distribution.service';
import { StoreAvailabilityService } from './store-availability.service';

describe('DistributionService', () => {
  let svc: DistributionService;
  let prisma: any;

  const wooStore = { id: 'store-woo', kind: 'WOOCOMMERCE', name: 'Woo' };
  const shopifyStore = { id: 'store-shop', kind: 'SHOPIFY', name: 'Shop' };
  const nativeStore = { id: 'store-native', kind: 'NATIVE', name: 'Native Website' };
  const product = {
    id: 'prod-1',
    status: 'active',
    isActive: true,
    categoryId: 'cat-child',
    productCategories: [],
  };

  beforeEach(() => {
    prisma = {
      store: { findUnique: jest.fn(), findMany: jest.fn() },
      product: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      productStoreAssignment: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      storeAvailabilityRule: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      category: { findUnique: jest.fn(), findMany: jest.fn() },
    };
    prisma.product.findUnique.mockResolvedValue(product);
    prisma.category.findMany.mockResolvedValue([
      { id: 'cat-child', parentId: 'cat-parent', name: 'Child', slug: 'child' },
      { id: 'cat-parent', parentId: null, name: 'Parent', slug: 'parent' },
    ]);
    svc = new DistributionService(prisma, new StoreAvailabilityService());
  });

  describe('getAvailability', () => {
    it('resolves effective = global AND (override ?? rule ?? default)', async () => {
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.productStoreAssignment.findMany.mockResolvedValue([]);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: true, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.globalActive).toBe(true);
      expect(view.stores).toHaveLength(1);
      expect(view.stores[0]).toMatchObject({ storeId: 'store-woo', effective: true, ruleAvailable: true });
    });

    it('override beats rule', async () => {
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.productStoreAssignment.findMany.mockResolvedValue([
        { storeId: 'store-woo', available: false, source: 'MANUAL' },
      ]);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: true, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0].effective).toBe(false);
      expect(view.stores[0].overrideAvailable).toBe(false);
    });

    it('404s for an unknown product', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(svc.getAvailability('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rule inheritance', () => {
    function mockStoresWithRules(rules: any[]) {
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.productStoreAssignment.findMany.mockResolvedValue([]);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue(rules);
    }

    it('a parent rule propagates to a child category by default', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: false, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0]).toMatchObject({ effective: false, ruleAvailable: false });
    });

    it('a child rule with inheritFromParent=false wins over the parent', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: false, inheritFromParent: true },
        { storeId: 'store-woo', categoryId: 'cat-child', available: true, inheritFromParent: false },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0]).toMatchObject({ effective: true, ruleAvailable: true });
    });

    it('a child rule with inheritFromParent=true defers to the parent', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: false, inheritFromParent: true },
        { storeId: 'store-woo', categoryId: 'cat-child', available: true, inheritFromParent: true },
      ]);
      const view = await svc.getAvailability('prod-1');
      expect(view.stores[0]).toMatchObject({ effective: false, ruleAvailable: false });
    });

    it('a non-propagating parent rule (inheritFromParent=false) does not reach the child', async () => {
      mockStoresWithRules([
        { storeId: 'store-woo', categoryId: 'cat-parent', available: true, inheritFromParent: false },
      ]);
      const view = await svc.getAvailability('prod-1');
      // No applicable rule → external default OFF.
      expect(view.stores[0]).toMatchObject({ effective: false, ruleAvailable: null });
    });
  });

  describe('setOverride', () => {
    it('upserts a MANUAL override', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.productStoreAssignment.upsert.mockResolvedValue({ available: true });
      await svc.setOverride('prod-1', 'store-woo', true);
      expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId_productId: { storeId: 'store-woo', productId: 'prod-1' } },
          create: expect.objectContaining({ source: 'MANUAL', available: true }),
        }),
      );
    });

    it('null clears the override without writing one', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      await svc.setOverride('prod-1', 'store-woo', null);
      expect(prisma.productStoreAssignment.deleteMany).toHaveBeenCalled();
      expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
    });

    it('rejects NATIVE with 400', async () => {
      prisma.store.findUnique.mockResolvedValue(nativeStore);
      await expect(svc.setOverride('prod-1', 'store-native', true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
    });

    it('404s for an unknown store', async () => {
      prisma.store.findUnique.mockResolvedValue(null);
      await expect(svc.setOverride('prod-1', 'ghost', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('bulkSet', () => {
    beforeEach(() => {
      prisma.store.findMany.mockResolvedValue([wooStore, shopifyStore, nativeStore]);
      prisma.productStoreAssignment.upsert.mockResolvedValue({});
    });

    it('excludes NATIVE and reports excludedNativeCount', async () => {
      const res = await svc.bulkSet('prod-1', 'all_on');
      expect(res).toMatchObject({ enqueued: false, updated: 2, total: 2, excludedNativeCount: 1 });
      expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledTimes(2);
    });

    it('Disable-all requires typed confirmation', async () => {
      await expect(svc.bulkSet('prod-1', 'all_off')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.bulkSet('prod-1', 'all_off', 'WRONG')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
      const res = await svc.bulkSet('prod-1', 'all_off', 'DISABLE');
      expect(res.updated).toBe(2);
    });

    it('enqueues a background job when targets exceed 50', async () => {
      const many = Array.from({ length: 55 }, (_, i) => ({
        id: `store-${i}`,
        kind: 'WOOCOMMERCE',
        name: `S${i}`,
      }));
      prisma.store.findMany.mockResolvedValue([...many, nativeStore]);
      const res = await svc.bulkSet('prod-1', 'all_on');
      expect(res.enqueued).toBe(true);
      expect(res.jobId).toBeDefined();
      expect(res).toMatchObject({ total: 55, excludedNativeCount: 1 });
      // Background processing completes the writes without blocking the response.
      await svc.waitForBulkJob(res.jobId as string);
      expect(prisma.productStoreAssignment.upsert).toHaveBeenCalledTimes(55);
    });
  });

  describe('rules', () => {
    it('upserts a rule with the inherit flag', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-parent' });
      prisma.storeAvailabilityRule.upsert.mockResolvedValue({});
      await svc.upsertRule('store-woo', 'cat-parent', { available: false, inheritFromParent: true });
      expect(prisma.storeAvailabilityRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId_categoryId: { storeId: 'store-woo', categoryId: 'cat-parent' } },
        }),
      );
    });

    it('rejects NATIVE rules with 400 and writes nothing', async () => {
      prisma.store.findUnique.mockResolvedValue(nativeStore);
      await expect(
        svc.upsertRule('store-native', 'cat-parent', { available: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.storeAvailabilityRule.upsert).not.toHaveBeenCalled();
    });

    it('404s for an unknown category', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(svc.upsertRule('store-woo', 'ghost', { available: true })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('storefront isolation', () => {
    it('no distribution mutation writes Product rows', async () => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.store.findMany.mockResolvedValue([wooStore]);
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-parent' });
      await svc.setOverride('prod-1', 'store-woo', true);
      await svc.setOverride('prod-1', 'store-woo', null);
      await svc.bulkSet('prod-1', 'all_on');
      await svc.upsertRule('store-woo', 'cat-parent', { available: true });
      expect(prisma.product.update).not.toHaveBeenCalled();
      expect(prisma.product.create).not.toHaveBeenCalled();
      expect(prisma.product.delete).not.toHaveBeenCalled();
    });
  });

  describe('ensureAssignment (D-2 auto-assign on push)', () => {
    beforeEach(() => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.productStoreAssignment.findUnique.mockResolvedValue(null);
      prisma.productStoreAssignment.create.mockImplementation(async ({ data }: any) => ({
        id: 'asg-1',
        ...data,
      }));
    });

    it('creates a MANUAL available row when none exists', async () => {
      const out = await svc.ensureAssignment('prod-1', 'store-woo');
      expect(out).toEqual({ created: true });
      expect(prisma.productStoreAssignment.create).toHaveBeenCalledWith({
        data: { storeId: 'store-woo', productId: 'prod-1', source: 'MANUAL', available: true },
      });
    });

    it('leaves an existing OFF assignment untouched (never flips it)', async () => {
      prisma.productStoreAssignment.findUnique.mockResolvedValue({
        id: 'asg-1',
        storeId: 'store-woo',
        productId: 'prod-1',
        source: 'MANUAL',
        available: false,
      });
      const out = await svc.ensureAssignment('prod-1', 'store-woo');
      expect(out).toEqual({ created: false });
      expect(prisma.productStoreAssignment.create).not.toHaveBeenCalled();
      expect(prisma.productStoreAssignment.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: a second push finds the row and creates nothing', async () => {
      const rows = new Map<string, any>();
      prisma.productStoreAssignment.findUnique.mockImplementation(async ({ where }: any) => {
        const k = where.storeId_productId;
        return rows.get(`${k.storeId}:${k.productId}`) ?? null;
      });
      prisma.productStoreAssignment.create.mockImplementation(async ({ data }: any) => {
        const row = { id: `asg-${rows.size + 1}`, ...data };
        rows.set(`${data.storeId}:${data.productId}`, row);
        return row;
      });
      expect(await svc.ensureAssignment('prod-1', 'store-woo')).toEqual({ created: true });
      expect(await svc.ensureAssignment('prod-1', 'store-woo')).toEqual({ created: false });
      expect(prisma.productStoreAssignment.create).toHaveBeenCalledTimes(1);
      expect(rows.size).toBe(1);
    });

    it('treats a P2002 race as already-exists (concurrent push)', async () => {
      const race = new Error('Unique constraint failed') as any;
      race.code = 'P2002';
      prisma.productStoreAssignment.create.mockRejectedValue(race);
      await expect(svc.ensureAssignment('prod-1', 'store-woo')).resolves.toEqual({
        created: false,
      });
    });

    it('rethrows non-unique create errors', async () => {
      prisma.productStoreAssignment.create.mockRejectedValue(new Error('db down'));
      await expect(svc.ensureAssignment('prod-1', 'store-woo')).rejects.toThrow('db down');
    });

    it('404s for a missing product or store, 400s for NATIVE', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(svc.ensureAssignment('ghost', 'store-woo')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      prisma.product.findUnique.mockResolvedValue(product);
      prisma.store.findUnique.mockResolvedValue(null);
      await expect(svc.ensureAssignment('prod-1', 'ghost-store')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      prisma.store.findUnique.mockResolvedValue(nativeStore);
      await expect(svc.ensureAssignment('prod-1', 'store-native')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.productStoreAssignment.create).not.toHaveBeenCalled();
    });
  });

  describe('ruleMatchedProductIds (D-4)', () => {
    const ruleOn = { storeId: 'store-woo', categoryId: 'cat-parent', available: true, inheritFromParent: true };
    const ruleOff = { storeId: 'store-woo', categoryId: 'cat-parent', available: false, inheritFromParent: true };

    beforeEach(() => {
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([ruleOn]);
      // cat-child inherits from cat-parent (parent map in the outer
      // beforeEach); prod-2 sits directly on the ruled category.
      prisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', categoryId: 'cat-child', productCategories: [] },
        { id: 'prod-2', categoryId: 'cat-parent', productCategories: [] },
        { id: 'prod-3', categoryId: null, productCategories: [{ categoryId: 'cat-child' }] },
        { id: 'prod-4', categoryId: 'cat-other', productCategories: [] },
      ]);
    });

    it('returns globalActive rule-matched ids (inherited + join categories)', async () => {
      // The rule is inheritFromParent=true on cat-parent: it propagates
      // DOWN to descendants (prod-1 via categoryId, prod-3 via the join
      // table) but does NOT govern cat-parent itself (prod-2) — that is
      // the existing resolver's semantics, reused verbatim.
      const ids = await svc.ruleMatchedProductIds('store-woo', 500);
      expect(ids).toEqual(['prod-1', 'prod-3']);
      // Only globally active products with NO assignment row are candidates.
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            isActive: true,
            storeAssignments: { none: { storeId: 'store-woo' } },
          }),
        }),
      );
    });

    it('an own-value rule (inheritFromParent=false) governs its own category only', async () => {
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([
        { ...ruleOn, inheritFromParent: false },
      ]);
      const ids = await svc.ruleMatchedProductIds('store-woo', 500);
      expect(ids).toEqual(['prod-2']);
    });

    it('respects the limit (oldest candidates first)', async () => {
      const ids = await svc.ruleMatchedProductIds('store-woo', 1);
      expect(ids).toEqual(['prod-1']);
    });

    it('returns [] when the rule resolves OFF', async () => {
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([ruleOff]);
      await expect(svc.ruleMatchedProductIds('store-woo', 500)).resolves.toEqual([]);
    });

    it('returns [] for a missing store, a NATIVE store, or no rules (fail-soft)', async () => {
      prisma.store.findUnique.mockResolvedValue(null);
      await expect(svc.ruleMatchedProductIds('ghost', 500)).resolves.toEqual([]);
      prisma.store.findUnique.mockResolvedValue(nativeStore);
      await expect(svc.ruleMatchedProductIds('store-native', 500)).resolves.toEqual([]);
      prisma.store.findUnique.mockResolvedValue(wooStore);
      prisma.storeAvailabilityRule.findMany.mockResolvedValue([]);
      await expect(svc.ruleMatchedProductIds('store-woo', 500)).resolves.toEqual([]);
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it('returns [] for limit <= 0 without touching the DB', async () => {
      await expect(svc.ruleMatchedProductIds('store-woo', 0)).resolves.toEqual([]);
      expect(prisma.store.findUnique).not.toHaveBeenCalled();
    });
  });
});
