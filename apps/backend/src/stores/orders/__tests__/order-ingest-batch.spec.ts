/**
 * J-10 batch SKU resolution — equivalence + query counts.
 *
 * The batch path (`buildSkuResolutionContext` + `resolveSku(ctx)`) must
 * resolve EXACTLY like the per-SKU path (same precedence: StoreSkuMapping
 * → variant → product), with 3 batched queries per page instead of up to
 * 3 lookups per item per order. Query counts below are MEASURED with a
 * counting fake Prisma, not reasoned — see BUILD-SUMMARY (C-gating).
 *
 * Fixture SKUs:
 * - SKU-A: explicit StoreSkuMapping → prod-A / var-A (also has a variant
 *   row + a product row — the mapping must win).
 * - SKU-B: no mapping; variant row → prod-B / var-B.
 * - SKU-C: no mapping/variant; product row → prod-C.
 * - SKU-D: nothing anywhere → unresolved (product-less + UNMATCHED_SKU).
 */
import { StoreOrderIngestService } from '../store-order-ingest.service';
import { StoreOrderReconcileService } from '../store-order-reconcile.service';

const MAPPINGS = [
  { storeId: 's1', sku: 'SKU-A', productId: 'prod-A', variantId: 'var-A' },
];
const VARIANTS = [
  { id: 'var-A', productId: 'prod-A-via-variant', sku: 'SKU-A' },
  { id: 'var-B', productId: 'prod-B', sku: 'SKU-B' },
];
const PRODUCTS = [
  { id: 'prod-A-via-product', sku: 'SKU-A' },
  { id: 'prod-C', sku: 'SKU-C' },
];

/** Counting fake Prisma: every SKU-lookup method records its calls. */
function countingPrisma() {
  const counts = {
    mappingFindUnique: 0,
    mappingFindMany: 0,
    variantFindFirst: 0,
    variantFindMany: 0,
    productFindFirst: 0,
    productFindMany: 0,
  };
  const prisma: any = {
    _counts: counts,
    store: { findUnique: jest.fn().mockResolvedValue({ id: 's1', kind: 'WOOCOMMERCE', name: 'Woo' }) },
    storeOrderMapping: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    storeOrderStatusMap: {
      findUnique: jest.fn().mockResolvedValue({ internalStatusName: 'Confirmed' }),
      create: jest.fn(),
    },
    storeSkuMapping: {
      findUnique: jest.fn(async ({ where }: any) => {
        counts.mappingFindUnique += 1;
        return MAPPINGS.find((m) => m.storeId === where?.storeId_sku?.storeId && m.sku === where?.storeId_sku?.sku) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        counts.mappingFindMany += 1;
        const skus: string[] = where?.sku?.in ?? [];
        return MAPPINGS.filter((m) => m.storeId === where?.storeId && skus.includes(m.sku));
      }),
      upsert: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(async ({ where }: any) => VARIANTS.find((v) => v.id === where?.id) ?? null),
      findFirst: jest.fn(async ({ where }: any) => {
        counts.variantFindFirst += 1;
        return VARIANTS.find((v) => v.sku === where?.sku) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        counts.variantFindMany += 1;
        const skus: string[] = where?.sku?.in ?? [];
        return VARIANTS.filter((v) => skus.includes(v.sku));
      }),
    },
    product: {
      // ERP stock: every product is ALWAYS_IN_STOCK so the P13 check
      // never rejects and never issues extra queries.
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where?.id, availabilityMode: 'ALWAYS_IN_STOCK',
      })),
      findFirst: jest.fn(async ({ where }: any) => {
        counts.productFindFirst += 1;
        return PRODUCTS.find((p) => p.sku === where?.sku) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        counts.productFindMany += 1;
        const skus: string[] = where?.sku?.in ?? [];
        return PRODUCTS.filter((p) => skus.includes(p.sku));
      }),
    },
    physicalInventory: { findMany: jest.fn().mockResolvedValue([]) },
    orderStatus: { findFirst: jest.fn().mockResolvedValue({ id: 'st-x', name: 'Confirmed' }) },
    order: { findUnique: jest.fn(), update: jest.fn() },
    syncRun: { update: jest.fn().mockResolvedValue({}) },
  };
  return { prisma, counts };
}

function buildIngest(prisma: any) {
  const orders = {
    create: jest.fn().mockResolvedValue({ id: 'ord-1', status: { name: 'Confirmed' }, total: 250 }),
    updateStatus: jest.fn().mockResolvedValue({}),
  };
  const runs = {
    begin: jest.fn().mockResolvedValue({ id: 'run-1' }),
    recordItem: jest.fn().mockResolvedValue({}),
    upsertIssue: jest.fn().mockResolvedValue({}),
    finish: jest.fn().mockResolvedValue({}),
  };
  const svc = new StoreOrderIngestService(
    prisma,
    orders as any,
    runs as any,
    { providerFor: jest.fn() } as any,
    { storeWithSecrets: jest.fn() } as any,
  );
  return { svc, orders, runs };
}

function rawOrder(id: string, skus: string[]) {
  return {
    id, status: 'processing', total: 250, currency: 'BDT',
    createdAt: '2026-09-23T13:00:00.000Z',
    items: skus.map((sku) => ({ sku, qty: 1, price: 100 })),
    customer: { phone: '01700000001', name: 'Sara' },
  };
}

// 3 orders, 6 items, 4 distinct SKUs — the burst under test.
const BURST = [
  rawOrder('ext-b1', ['SKU-A', 'SKU-B']),
  rawOrder('ext-b2', ['SKU-C', 'SKU-D']),
  rawOrder('ext-b3', ['SKU-A', 'SKU-C']),
];

describe('J-10 batch SKU resolution — equivalence', () => {
  it('batch context resolves exactly like the per-SKU path (same precedence)', async () => {
    const { prisma } = countingPrisma();
    const { svc } = buildIngest(prisma);
    const ctx = await svc.buildSkuResolutionContext('s1', ['SKU-A', 'SKU-B', 'SKU-C', 'SKU-D']);
    // Mapping wins over variant/product for SKU-A.
    expect(ctx.resolutions.get('SKU-A')).toEqual({ productId: 'prod-A', variantId: 'var-A', resolved: true });
    expect(ctx.resolutions.get('SKU-B')).toEqual({ productId: 'prod-B', variantId: 'var-B', resolved: true });
    expect(ctx.resolutions.get('SKU-C')).toEqual({ productId: 'prod-C', resolved: true });
    expect(ctx.resolutions.get('SKU-D')).toEqual({ resolved: false });

    // Per-SKU path agrees on every SKU.
    for (const [sku, expected] of ctx.resolutions) {
      await expect(svc.resolveSku('s1', sku)).resolves.toEqual(expected);
    }
  });

  it('empty SKU list builds an empty context with zero queries', async () => {
    const { prisma, counts } = countingPrisma();
    const { svc } = buildIngest(prisma);
    const ctx = await svc.buildSkuResolutionContext('s1', []);
    expect(ctx.resolutions.size).toBe(0);
    expect(counts.mappingFindMany).toBe(0);
    expect(counts.variantFindMany).toBe(0);
    expect(counts.productFindMany).toBe(0);
  });

  it('out-of-batch SKUs fall back to the per-SKU DB path', async () => {
    const { prisma, counts } = countingPrisma();
    const { svc } = buildIngest(prisma);
    const ctx = await svc.buildSkuResolutionContext('s1', ['SKU-A']);
    expect(ctx.resolutions.has('SKU-B')).toBe(false);
    await expect(svc.resolveSku('s1', 'SKU-B', ctx)).resolves.toEqual({
      productId: 'prod-B', variantId: 'var-B', resolved: true,
    });
    // The fallback issued per-SKU lookups (mapping miss + variant hit).
    expect(counts.mappingFindUnique).toBe(1);
    expect(counts.variantFindFirst).toBe(1);
    expect(counts.productFindFirst).toBe(0);
  });
});

describe('J-10 batch SKU resolution — query counts (measured)', () => {
  it('per-order path: 13 SKU lookups for the 3-order burst; batch path: 3 findMany + 0 lookups', async () => {
    // WITHOUT a batch context (today's behavior).
    const plain = countingPrisma();
    const plainSvc = buildIngest(plain.prisma);
    for (const raw of BURST) {
      await plainSvc.svc.ingest('s1', raw, { type: 'RECONCILE', runId: 'run-1' });
    }
    const plainLookups =
      plain.counts.mappingFindUnique + plain.counts.variantFindFirst + plain.counts.productFindFirst;
    // SKU-A: mapping hit (1). SKU-B: mapping miss + variant hit (2).
    // SKU-C: mapping miss + variant miss + product hit (3). SKU-D: 3 misses.
    // Burst items A,B,C,D,A,C → 1+2+3+3+1+3 = 13.
    expect(plain.counts).toMatchObject({
      mappingFindUnique: 6, variantFindFirst: 4, productFindFirst: 3,
    });
    expect(plainLookups).toBe(13);

    // WITH one shared batch context for the burst.
    const batched = countingPrisma();
    const batchedSvc = buildIngest(batched.prisma);
    const ctx = await batchedSvc.svc.buildSkuResolutionContext('s1', [
      'SKU-A', 'SKU-B', 'SKU-C', 'SKU-D',
    ]);
    for (const raw of BURST) {
      await batchedSvc.svc.ingest('s1', raw, { type: 'RECONCILE', runId: 'run-1', skuContext: ctx });
    }
    const batchedLookups =
      batched.counts.mappingFindUnique + batched.counts.variantFindFirst + batched.counts.productFindFirst;
    expect(batched.counts).toMatchObject({
      mappingFindMany: 1, variantFindMany: 1, productFindMany: 1,
    });
    expect(batchedLookups).toBe(0);

    // Identical orders created in both runs (same items, same ids).
    const plainItems = plainSvc.orders.create.mock.calls.map((c: any) => c[0].items);
    const batchedItems = batchedSvc.orders.create.mock.calls.map((c: any) => c[0].items);
    expect(plainSvc.orders.create).toHaveBeenCalledTimes(3);
    expect(batchedSvc.orders.create).toHaveBeenCalledTimes(3);
    expect(batchedItems).toEqual(plainItems);
    // And the same UNMATCHED_SKU issue (SKU-D) in both runs.
    expect(batchedSvc.runs.upsertIssue.mock.calls).toEqual(plainSvc.runs.upsertIssue.mock.calls);
  });
});

describe('J-10 batch SKU resolution — reconcile wires one batch per page', () => {
  function buildReconcile(ingestMock: any, kind = 'WOOCOMMERCE') {
    const prisma: any = {
      store: { findMany: jest.fn().mockResolvedValue([]) },
      syncRun: { update: jest.fn().mockResolvedValue({}) },
    };
    const runs: any = {
      begin: jest.fn().mockResolvedValue({ id: 'run-1' }),
      recordItem: jest.fn().mockResolvedValue({}),
      upsertIssue: jest.fn().mockResolvedValue({}),
      finish: jest.fn().mockResolvedValue({}),
    };
    const provider = {
      fetchOrders: jest.fn().mockResolvedValue({ orders: BURST, hasMore: false }),
    };
    const stores: any = {
      storeWithSecrets: jest.fn().mockResolvedValue({ id: 's1', kind, settings: {}, secrets: {} }),
    };
    const svc = new StoreOrderReconcileService(
      prisma, runs, { enqueue: jest.fn() } as any, ingestMock, stores,
    );
    return { svc, runs, provider };
  }

  it('builds ONE batch per page and passes it + the provider into every ingest', async () => {
    const ctx = { resolutions: new Map() };
    const ingestMock: any = {
      providerFor: jest.fn(),
      buildSkuResolutionContext: jest.fn().mockResolvedValue(ctx),
      ingest: jest.fn().mockResolvedValue({ orderId: 'ord-1', created: true, status: 'Confirmed', statusChanged: true }),
    };
    const { svc, provider } = buildReconcile(ingestMock);
    ingestMock.providerFor.mockResolvedValue(provider);

    const counts = await svc.runStore('s1', 'run-1', {});
    expect(counts).toMatchObject({ created: 3, failed: 0 });
    expect(ingestMock.buildSkuResolutionContext).toHaveBeenCalledTimes(1);
    expect(ingestMock.buildSkuResolutionContext).toHaveBeenCalledWith(
      's1',
      expect.arrayContaining(['SKU-A', 'SKU-B', 'SKU-C', 'SKU-D']),
    );
    expect(ingestMock.ingest).toHaveBeenCalledTimes(3);
    for (const call of ingestMock.ingest.mock.calls) {
      expect(call[2]).toMatchObject({ type: 'RECONCILE', provider: 'woocommerce', skuContext: ctx, bypassStatusGate: true });
    }
  });

  it('a batch-build failure falls back to per-order resolution (no lost page)', async () => {
    const ingestMock: any = {
      providerFor: jest.fn(),
      buildSkuResolutionContext: jest.fn().mockRejectedValue(new Error('db blip')),
      ingest: jest.fn().mockResolvedValue({ orderId: 'ord-1', created: true, status: 'Confirmed', statusChanged: true }),
    };
    const { svc, provider } = buildReconcile(ingestMock);
    ingestMock.providerFor.mockResolvedValue(provider);

    const counts = await svc.runStore('s1', 'run-1', {});
    expect(counts).toMatchObject({ created: 3, failed: 0 });
    expect(ingestMock.ingest).toHaveBeenCalledTimes(3);
    for (const call of ingestMock.ingest.mock.calls) {
      expect(call[2].skuContext).toBeUndefined();
    }
  });

  it('an ingest mock without buildSkuResolutionContext still works (backward compat)', async () => {
    const ingestMock: any = {
      providerFor: jest.fn(),
      ingest: jest.fn().mockResolvedValue({ orderId: 'ord-1', created: true, status: 'Confirmed', statusChanged: true }),
    };
    const { svc, provider } = buildReconcile(ingestMock);
    ingestMock.providerFor.mockResolvedValue(provider);

    const counts = await svc.runStore('s1', 'run-1', {});
    expect(counts).toMatchObject({ created: 3, failed: 0 });
    expect(ingestMock.ingest).toHaveBeenCalledTimes(3);
  });
});
