/**
 * Outbound per-product push (P1) + rule-matched sweep (D-4).
 *
 * - SyncQueuesService.triggerProductSync: run + job carrying productId
 * - StoresController sync-product (auto-assign first, D-2) + remote-product
 *   probe (G-9), with the same guards as triggerSync
 * - StoreProductSyncProcessor: per-product branch through syncProduct,
 *   D-4 sweep union (assignments + rule matches, deduped, capped at 500),
 *   EMPTY_SWEEP item on an empty sweep (G-8)
 * - StoreReconcileProcessor: the same union on the safety-net sweep (cap 200)
 * - Per-product job absolutizes images through PushMediaService (P0 path)
 */
import { ForbiddenException } from '@nestjs/common';
import { FakeProvider } from '../../providers/__tests__/fake.provider';
import { FieldOwnershipService } from '../../distribution/field-ownership.service';
import { StoreAvailabilityService } from '../../distribution/store-availability.service';
import { DistributionService } from '../../distribution/distribution.service';
import { SyncRunService } from '../sync-run.service';
import { CategorySyncService } from '../category-sync.service';
import { ProductSyncService } from '../product-sync.service';
import { PushMediaService } from '../push-media.service';
import { TenantRegistryService } from '../../../tenancy/tenant-registry.service';
import { SyncQueuesService } from '../sync-queues.service';
import { StoresController } from '../../stores.controller';
import {
  EMPTY_SWEEP_REASON,
  StoreProductSyncProcessor,
  StoreReconcileProcessor,
} from '../sync.processors';

const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';
const RUN_ID = 'run-1';

const OLD_ENV = process.env;

function pinFlags() {
  process.env = { ...OLD_ENV };
  // Flags default ON when unset; pin them explicitly so a polluted env
  // in the same worker cannot flip the suite.
  process.env.THIRD_PARTY_STORES_ENABLED = 'true';
  process.env.store_sync_enabled = 'true';
  process.env.store_product_sync_enabled = 'true';
  process.env.store_reconcile_enabled = 'true';
}

// ── triggerProductSync ────────────────────────────────────────────────

describe('SyncQueuesService.triggerProductSync (P1)', () => {
  function queueSvc() {
    const runs = { begin: jest.fn(async () => ({ id: 'run-7' })) };
    const svc = Object.create(SyncQueuesService.prototype) as any;
    svc.runs = runs;
    svc.enqueue = jest.fn(async () => undefined);
    svc.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    return { svc: svc as SyncQueuesService, runs, enqueue: svc.enqueue as jest.Mock };
  }

  it('creates a PRODUCT/MANUAL run and enqueues store-sync with the productId', async () => {
    const { svc, runs, enqueue } = queueSvc();
    const out = await svc.triggerProductSync(STORE_ID, PRODUCT_ID, 'user-1');
    expect(out).toEqual({ runId: 'run-7' });
    expect(runs.begin).toHaveBeenCalledWith({
      scope: 'PRODUCT',
      triggerType: 'MANUAL',
      storeId: STORE_ID,
      initiatedById: 'user-1',
    });
    // Fire-and-forget enqueue: the call itself is synchronous.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      'store-product-sync',
      'store-sync',
      { runId: 'run-7', storeId: STORE_ID, productId: PRODUCT_ID },
      'store-sync:run-7',
    );
  });
});

// ── Controller endpoints ──────────────────────────────────────────────

describe('StoresController sync-product + remote-product (P1)', () => {
  beforeEach(pinFlags);
  afterEach(() => {
    process.env = OLD_ENV;
  });

  function controller(overrides: Record<string, unknown> = {}) {
    const stores = { detail: jest.fn(async () => ({ id: STORE_ID })) };
    const queues = {
      triggerProductSync: jest.fn(async () => ({ runId: 'run-9' })),
      triggerStoreSync: jest.fn(),
    };
    const distribution = {
      ensureAssignment: jest.fn(async () => ({ created: true })),
    };
    const productSync = {
      findRemoteBySku: jest.fn(async () => ({ exists: true, externalId: 'woo-15' })),
    };
    const c = new StoresController(
      { ...stores, ...(overrides.stores as object | undefined) } as any,
      { ...queues, ...(overrides.queues as object | undefined) } as any,
      {} as any,
      {} as any,
      { ...distribution, ...(overrides.distribution as object | undefined) } as any,
      { ...productSync, ...(overrides.productSync as object | undefined) } as any,
    );
    return { controller: c, stores, queues, distribution, productSync };
  }

  it('sync-product: auto-assigns first, then enqueues, returns { runId }', async () => {
    const { controller: c, stores, queues, distribution } = controller();
    const out = await c.syncProduct(STORE_ID, { productId: PRODUCT_ID }, { sub: 'user-1' });
    expect(out).toEqual({ runId: 'run-9' });
    expect(stores.detail).toHaveBeenCalledWith(STORE_ID);
    expect(distribution.ensureAssignment).toHaveBeenCalledWith(PRODUCT_ID, STORE_ID);
    expect(queues.triggerProductSync).toHaveBeenCalledWith(STORE_ID, PRODUCT_ID, 'user-1');
    // Auto-assign runs BEFORE the enqueue (the push must see the row).
    expect(
      (distribution.ensureAssignment as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan((queues.triggerProductSync as jest.Mock).mock.invocationCallOrder[0]);
  });

  it('sync-product: 403 when product sync is disabled', async () => {
    process.env.store_product_sync_enabled = 'false';
    const { controller: c, queues, distribution } = controller();
    await expect(
      c.syncProduct(STORE_ID, { productId: PRODUCT_ID }, { sub: 'user-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(distribution.ensureAssignment).not.toHaveBeenCalled();
    expect(queues.triggerProductSync).not.toHaveBeenCalled();
  });

  it('sync-product: 403 when stores are disabled', async () => {
    process.env.THIRD_PARTY_STORES_ENABLED = 'false';
    const { controller: c } = controller();
    await expect(
      c.syncProduct(STORE_ID, { productId: PRODUCT_ID }, { sub: 'user-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sync-product: a missing store 404s before any assign/enqueue', async () => {
    const { controller: c, queues, distribution } = controller({
      stores: { detail: jest.fn(async () => { throw new Error('Store not found'); }) },
    });
    await expect(
      c.syncProduct(STORE_ID, { productId: PRODUCT_ID }, { sub: 'user-1' }),
    ).rejects.toThrow('Store not found');
    expect(distribution.ensureAssignment).not.toHaveBeenCalled();
    expect(queues.triggerProductSync).not.toHaveBeenCalled();
  });

  it('remote-product: returns the probe result for the SKU', async () => {
    const { controller: c, stores, productSync } = controller();
    const out = await c.remoteProduct(STORE_ID, { sku: 'ECO-TEE-1' });
    expect(out).toEqual({ exists: true, externalId: 'woo-15' });
    expect(stores.detail).toHaveBeenCalledWith(STORE_ID);
    expect(productSync.findRemoteBySku).toHaveBeenCalledWith(STORE_ID, 'ECO-TEE-1');
  });

  it('remote-product: 403 when product sync is disabled', async () => {
    process.env.store_product_sync_enabled = 'false';
    const { controller: c, productSync } = controller();
    await expect(c.remoteProduct(STORE_ID, { sku: 'ECO-TEE-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(productSync.findRemoteBySku).not.toHaveBeenCalled();
  });
});

// ── Product processor: per-product branch + D-4 sweep ─────────────────

describe('StoreProductSyncProcessor per-product push + D-4 sweep', () => {
  beforeEach(pinFlags);
  afterEach(() => {
    process.env = OLD_ENV;
  });

  function makeProcessor(opts: {
    assignments?: string[];
    ruleIds?: string[];
    withDistribution?: boolean;
    syncImpl?: (storeId: string, productId: string, runId: string) => Promise<unknown>;
  } = {}) {
    const prisma = {
      productStoreAssignment: {
        findMany: jest.fn(async ({ take }: any) => (opts.assignments ?? []).slice(0, take).map((productId) => ({ productId }))),
      },
    };
    const syncProduct = jest.fn(
      opts.syncImpl ??
        (async () => ({ pushed: ['name'], preserved: [], skipped: [] })),
    );
    const products = { syncProduct };
    const runs = {
      recordItem: jest.fn(async () => ({})),
      finish: jest.fn(async () => ({})),
      recordAttempt: jest.fn(async () => ({})),
      countAttempts: jest.fn(async () => 0),
      upsertIssue: jest.fn(async () => ({})),
    };
    const queues = {
      serializeStore: jest.fn((_storeId: string, fn: () => unknown) => fn()),
    };
    const breaker = {
      allow: jest.fn(async () => true),
      success: jest.fn(async () => undefined),
      failure: jest.fn(async () => undefined),
    };
    const distribution = {
      ruleMatchedProductIds: jest.fn(async () => opts.ruleIds ?? []),
    };
    const processor = new StoreProductSyncProcessor(
      prisma as any,
      products as any,
      runs as any,
      queues as any,
      breaker as any,
      undefined,
      opts.withDistribution === false ? undefined : (distribution as any),
    );
    return { processor, prisma, syncProduct, runs, queues, breaker, distribution };
  }

  function job(data: Record<string, unknown>) {
    return { name: 'store-sync', data: { runId: RUN_ID, storeId: STORE_ID, ...data } } as any;
  }

  it('per-product job syncs only that product through syncProduct', async () => {
    const { processor, syncProduct, prisma, runs } = makeProcessor({
      assignments: ['prod-other'],
    });
    const out = await (processor as any).handle(job({ productId: PRODUCT_ID }));
    expect(syncProduct).toHaveBeenCalledTimes(1);
    expect(syncProduct).toHaveBeenCalledWith(STORE_ID, PRODUCT_ID, RUN_ID);
    // The sweep never runs on the per-product path.
    expect(prisma.productStoreAssignment.findMany).not.toHaveBeenCalled();
    expect(runs.recordItem).not.toHaveBeenCalled();
    expect(out).toMatchObject({ updated: 1 });
  });

  it('sweep includes a rule-matched product with no assignment row', async () => {
    const { processor, syncProduct, distribution } = makeProcessor({
      assignments: ['prod-assigned'],
      ruleIds: ['prod-rule-only'],
    });
    await (processor as any).handle(job({}));
    expect(distribution.ruleMatchedProductIds).toHaveBeenCalledWith(STORE_ID, 499);
    expect(syncProduct).toHaveBeenCalledTimes(2);
    const pushed = (syncProduct as jest.Mock).mock.calls.map((c) => c[1]);
    expect(pushed).toEqual(expect.arrayContaining(['prod-assigned', 'prod-rule-only']));
  });

  it('no double-push when a product has both an assignment row and a rule match', async () => {
    const { processor, syncProduct } = makeProcessor({
      assignments: ['prod-both', 'prod-assigned'],
      ruleIds: ['prod-both', 'prod-rule-only'],
    });
    await (processor as any).handle(job({}));
    expect(syncProduct).toHaveBeenCalledTimes(3);
    const pushed = (syncProduct as jest.Mock).mock.calls.map((c) => c[1]);
    expect(pushed.filter((p: string) => p === 'prod-both')).toHaveLength(1);
    expect(pushed).toEqual(expect.arrayContaining(['prod-assigned', 'prod-rule-only']));
  });

  it('sweep caps at 500 total: assignments first, rule ids fill the remainder', async () => {
    const assignments = Array.from({ length: 500 }, (_, i) => `prod-a${i}`);
    const { processor, syncProduct, distribution } = makeProcessor({
      assignments,
      ruleIds: ['prod-rule-1', 'prod-rule-2'],
    });
    await (processor as any).handle(job({}));
    // No room left — the rule lookup is not even attempted.
    expect(distribution.ruleMatchedProductIds).not.toHaveBeenCalled();
    expect(syncProduct).toHaveBeenCalledTimes(500);
  });

  it('sweep without a DistributionService stays assignments-only', async () => {
    const { processor, syncProduct } = makeProcessor({
      assignments: ['prod-assigned'],
      withDistribution: false,
    });
    await (processor as any).handle(job({}));
    expect(syncProduct).toHaveBeenCalledTimes(1);
    expect(syncProduct).toHaveBeenCalledWith(STORE_ID, 'prod-assigned', RUN_ID);
  });

  it('empty sweep records the EMPTY_SWEEP item and finishes skipped: 1 (SUCCESS)', async () => {
    const { processor, syncProduct, runs } = makeProcessor({ assignments: [], ruleIds: [] });
    const out = await (processor as any).handle(job({}));
    expect(syncProduct).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledTimes(1);
    expect(runs.recordItem).toHaveBeenCalledWith(RUN_ID, {
      storeId: STORE_ID,
      objectType: 'PRODUCT',
      status: 'SKIPPED',
      reason: EMPTY_SWEEP_REASON,
      auditLevel: 'G',
    });
    expect(EMPTY_SWEEP_REASON).toBe(
      'EMPTY_SWEEP: 0 products assigned — nothing to push; product sync pushes EcoMate products out, it does not import',
    );
    expect(runs.finish).toHaveBeenCalledWith(RUN_ID, {
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(out).toMatchObject({ skipped: 1, failed: 0 });
  });

  it('a non-empty sweep records no EMPTY_SWEEP item', async () => {
    const { processor, runs } = makeProcessor({ assignments: ['prod-assigned'], ruleIds: [] });
    await (processor as any).handle(job({}));
    expect(runs.recordItem).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith(RUN_ID, {
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
  });
});

// ── Reconcile processor: D-4 safety net ───────────────────────────────

describe('StoreReconcileProcessor product safety net (D-4)', () => {
  beforeEach(pinFlags);
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('unions rule-matched ids into the safety-net sweep (cap 200)', async () => {
    const prisma = {
      productStoreAssignment: {
        findMany: jest.fn(async () => [{ productId: 'prod-assigned' }]),
      },
    };
    const syncProduct = jest.fn(async () => ({ pushed: ['name'], preserved: [], skipped: [] }));
    const runs = { finish: jest.fn(async () => ({})) };
    const queues = { serializeStore: jest.fn((_s: string, fn: () => unknown) => fn()) };
    const distribution = {
      ruleMatchedProductIds: jest.fn(async () => ['prod-rule-only']),
    };
    const processor = new StoreReconcileProcessor(
      prisma as any,
      { syncProduct } as any,
      runs as any,
      queues as any,
      {} as any,
      undefined,
      distribution as any,
    );
    const out = await (processor as any).handle({
      name: 'product-safety-net',
      data: { runId: RUN_ID, storeId: STORE_ID },
    } as any);
    expect(distribution.ruleMatchedProductIds).toHaveBeenCalledWith(STORE_ID, 199);
    expect(syncProduct).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ updated: 2, failed: 0 });
  });
});

// ── Per-product job through the real engine: P0 media path ─────────────
//
// Mock-prisma harness copied from product-sync.spec.ts (same FakeProvider
// + PushMediaService wiring) so the test proves the PROCESSOR's
// per-product branch — not just syncProduct in isolation — absolutizes
// images before the provider sees them.

const TENANT_ID = 'tenant-1';
const TENANT_SLUG = 'features-test-store';
const MEDIA_DOMAIN_CONFIG = {
  primaryDomain: 'staging.faah.net',
  baseDomains: ['staging.faah.net', 'staging.ecomate.bd'],
  customDomainCname: 'cname.staging.faah.net',
  allowExternalFallback: false,
};
const absMedia = (path: string) => `https://${TENANT_SLUG}.staging.faah.net${path}`;

function mockPrisma() {
  const fieldStates = new Map<string, any>();
  const productMappings = new Map<string, any>();
  const categoryMappings = new Map<string, any>();
  const mediaMappings = new Map<string, any>();
  const variantMappings = new Map<string, any>();
  const skuMappings = new Map<string, any>();
  const issues: any[] = [];
  const items: any[] = [];
  const attempts: any[] = [];
  let runSeq = 0;

  const prisma: any = {
    store: {
      findUnique: jest.fn(async () => ({
        id: STORE_ID, kind: 'WOOCOMMERCE', name: 'Woo', settings: {}, tenantId: TENANT_ID,
      })),
      findMany: jest.fn(async () => []),
    },
    storeCredential: { findMany: jest.fn(async () => []) },
    product: { findUnique: jest.fn() },
    category: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    productStoreAssignment: { findMany: jest.fn(async () => []) },
    storeAvailabilityRule: { findMany: jest.fn(async () => []) },
    productStoreFieldState: {
      findMany: jest.fn(async ({ where }: any) => {
        const all = [...fieldStates.values()];
        return all.filter((s) => (!where?.storeId || s.storeId === where.storeId) && (!where?.productId || s.productId === where.productId));
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_productId_field;
        return (k ? fieldStates.get(`${k.storeId}:${k.productId}:${k.field}`) : null) ?? null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.storeId_productId_field;
        const key = `${k.storeId}:${k.productId}:${k.field}`;
        const next = { ...(fieldStates.get(key) ?? {}), ...create, ...update };
        fieldStates.set(key, next);
        return next;
      }),
    },
    storeProductMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_productId;
        return (k ? productMappings.get(`${k.storeId}:${k.productId}`) : null) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `map-${productMappings.size + 1}`, ...data };
        productMappings.set(`${data.storeId}:${data.productId}`, row);
        return row;
      }),
      delete: jest.fn(async ({ where }: any) => {
        for (const [k, v] of productMappings) {
          if (v.id === where.id) {
            productMappings.delete(k);
            return v;
          }
        }
        return null;
      }),
    },
    storeCategoryMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where?.storeId_categoryId;
        return (k ? categoryMappings.get(`${k.storeId}:${k.categoryId}`) : null) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cat-${categoryMappings.size + 1}`, ...data };
        categoryMappings.set(`${data.storeId}:${data.categoryId}`, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    storeMediaMapping: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `med-${mediaMappings.size + 1}`, ...data };
        mediaMappings.set(`${data.storeId}:${data.mediaKey}`, row);
        return row;
      }),
    },
    storeVariantMapping: {
      findMany: jest.fn(async ({ where }: any) => {
        const all = [...variantMappings.values()];
        const ids = where?.variantId?.in as string[] | undefined;
        return all.filter(
          (m) =>
            (!where?.storeId || m.storeId === where.storeId) &&
            (!ids || ids.includes(m.variantId)),
        );
      }),
      upsert: jest.fn(async ({ create, update }: any) => {
        const row = { id: `var-${variantMappings.size + 1}`, ...create, ...update };
        variantMappings.set(`${create.storeId}:${create.variantId}`, row);
        return row;
      }),
    },
    storeSkuMapping: {
      upsert: jest.fn(async ({ create }: any) => {
        skuMappings.set(`${create.storeId}:${create.sku}`, create);
        return create;
      }),
    },
    syncRun: {
      create: jest.fn(async ({ data }: any) => ({ id: `run-${++runSeq}`, ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...data })),
    },
    syncRunItem: { create: jest.fn(async ({ data }: any) => { items.push(data); return data; }), findMany: jest.fn(async () => []) },
    syncAttempt: { create: jest.fn(async ({ data }: any) => { attempts.push(data); return data; }), count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    storeSyncIssue: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => { issues.push(data); return data; }),
      update: jest.fn(async ({ data }: any) => data),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => issues),
    },
  };
  return { prisma, fieldStates, productMappings, issues, items, attempts };
}

function ecoProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Eco Tee',
    slug: 'eco-tee',
    type: 'simple',
    description: 'Full',
    shortDesc: 'Short',
    basePrice: '100' as unknown,
    salePrice: null,
    sku: 'ECO-TEE-1',
    isActive: true,
    status: 'active',
    categoryId: null,
    brandId: null,
    brand: null,
    tags: [],
    productTags: [],
    images: [],
    seoMeta: {},
    variants: [],
    productCategories: [],
    ...overrides,
  };
}

describe('per-product job absolutizes images (P0 path through the processor)', () => {
  beforeEach(pinFlags);
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('a store-sync job with productId creates the remote product with absolute faah.net image URLs', async () => {
    const { prisma, issues } = mockPrisma();
    const fake = new FakeProvider();
    (prisma.product.findUnique as jest.Mock).mockResolvedValue(
      ecoProduct({ images: ['/uploads/a.jpg', '/uploads/b.jpg'] }),
    );
    const registry = new TenantRegistryService();
    registry.setDomainConfig(MEDIA_DOMAIN_CONFIG);
    registry.replace([
      { id: TENANT_ID, slug: TENANT_SLUG, status: 'ACTIVE', hosts: [`${TENANT_SLUG}.staging.faah.net`] },
    ]);
    const head = jest.fn(async (url: string) => ({
      statusCode: 200, contentType: 'image/jpeg', finalUrl: url,
    }));
    const runs = new SyncRunService(prisma);
    const pushMedia = new PushMediaService(registry, runs, { head } as any);
    const svc = new ProductSyncService(
      prisma,
      { providerFor: () => fake } as any,
      new FieldOwnershipService(),
      new DistributionService(prisma, new StoreAvailabilityService()),
      runs,
      new CategorySyncService(prisma, runs),
      undefined,
      undefined,
      pushMedia,
    );
    const processor = new StoreProductSyncProcessor(
      prisma as any,
      svc as any,
      runs as any,
      { serializeStore: (_s: string, fn: () => unknown) => fn() } as any,
      {
        allow: async () => true,
        success: async () => undefined,
        failure: async () => undefined,
      } as any,
      undefined,
      undefined,
    );

    const out = await (processor as any).handle({
      name: 'store-sync',
      data: { runId: RUN_ID, storeId: STORE_ID, productId: PRODUCT_ID },
    } as any);

    // The remote product was created WITH images — absolute, never raw
    // relative /uploads/... paths (raw strings must never reach a provider).
    expect(fake.productCount()).toBe(1);
    const created = fake.findBySku('ECO-TEE-1');
    expect(created?.fields.primaryImage).toBe(absMedia('/uploads/a.jpg'));
    expect(created?.fields.galleryImages).toEqual([absMedia('/uploads/b.jpg')]);
    expect(head).toHaveBeenCalledWith(absMedia('/uploads/a.jpg'), expect.anything());
    expect(head).toHaveBeenCalledWith(absMedia('/uploads/b.jpg'), expect.anything());
    expect(issues.some((i) => String(i.code).startsWith('MEDIA_'))).toBe(false);
    expect(out).toMatchObject({ failed: 0 });
  });
});
