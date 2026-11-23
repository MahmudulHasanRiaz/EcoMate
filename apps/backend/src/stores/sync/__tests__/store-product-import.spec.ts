/**
 * StoreProductImportService unit tests — WooCommerce product import.
 *
 * Pure rules (assignment table §15.4, reason grammar §10.4), confirm
 * validation + quota pre-check + idempotency (§13), and the per-item
 * skip / already-linked / remote-gone paths of importOne. The full
 * create/link flows run against the real DB in the E2E spec
 * (store-product-import.e2e-spec.ts) — mocking the whole Prisma surface
 * here would test the mocks, not the service.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProviderError, ProviderErrorCategory } from '../../../marketing/ad-provider.adapter';
import {
  StoreProductImportService,
  decideAssignment,
  reasonPrefix,
} from '../store-product-import.service';

const STORE_ID = 'store-1';
const BATCH_ID = 'batch-1';

function makeService(overrides: Record<string, any> = {}) {
  const prisma = {
    syncRun: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    syncRunItem: { findMany: jest.fn(async () => []) },
    storeProductMapping: { findUnique: jest.fn(async () => null) },
    storeProductImportSkip: { upsert: jest.fn(async (a: any) => a.create) },
    product: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
    },
    category: { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(async (fn: any) => fn(prismaTx)),
    ...overrides.prisma,
  };
  const prismaTx = {
    storeVariantMapping: { deleteMany: jest.fn(async () => ({})) },
    productStoreFieldState: { deleteMany: jest.fn(async () => ({})) },
    productStoreAssignment: { deleteMany: jest.fn(async () => ({})) },
    storeProductMapping: { delete: jest.fn(async () => ({})) },
  };
  const stores = {
    detail: jest.fn(async () => ({ id: STORE_ID, kind: 'WOOCOMMERCE', status: 'CONNECTED', name: 'Woo' })),
    storeWithSecrets: jest.fn(async () => ({ id: STORE_ID, kind: 'WOOCOMMERCE' })),
    ...overrides.stores,
  };
  const provider = {
    slug: 'woocommerce',
    syncedFields: [],
    listProducts: jest.fn(async () => ({ products: [], hasMore: false })),
    fetchProduct: jest.fn(async () => { throw new Error('not stubbed'); }),
    ...overrides.provider,
  };
  const registry = { providerFor: jest.fn(() => provider), ...overrides.registry };
  const runs = {
    begin: jest.fn(async () => ({ id: BATCH_ID })),
    recordItem: jest.fn(async () => ({})),
    upsertIssue: jest.fn(async () => ({})),
    finish: jest.fn(async () => ({})),
    childRuns: jest.fn(async () => []),
    countItemsByReason: jest.fn(async () => []),
    ...overrides.runs,
  };
  const queues = { enqueue: jest.fn(async () => undefined), ...overrides.queues };
  const ownership = { adoptExisting: jest.fn((i: any) => ({ ownership: 'ECOMATE', baselineHash: i.externalHash, externalHash: i.externalHash, ecoMateHashAtRebase: i.ecoMateHash })) };
  const limits = {
    getLimit: jest.fn(() => null as number | null),
    getUsage: jest.fn(async () => 0),
    assertWithinLimit: jest.fn(async () => undefined),
    ...overrides.limits,
  };
  const stockSync = { notifyStockChanged: jest.fn(async () => undefined) };
  const service = new StoreProductImportService(
    prisma as any,
    stores as any,
    registry as any,
    runs as any,
    queues as any,
    ownership as any,
    limits as any,
    stockSync as any,
  );
  return { service, prisma, prismaTx, stores, provider, registry, runs, queues, limits };
}

function enableImport() {
  process.env.THIRD_PARTY_STORES_ENABLED = 'true';
  process.env.store_sync_enabled = 'true';
  process.env.store_product_sync_enabled = 'true';
  process.env.store_product_import_enabled = 'true';
}

describe('decideAssignment (§15.4)', () => {
  it.each([
    ['create + active + no assignment → create', 'create', true, false, 'create'],
    ['create + draft → none (draft ⇒ NO assignment ever)', 'create', false, false, 'none'],
    ['link + active + no assignment → create', 'link', true, false, 'create'],
    ['link + active + existing assignment → leave (never overwrite)', 'link', true, true, 'leave'],
    ['link + draft → none (D7 warning, no assignment)', 'link', false, false, 'none'],
    ['link + draft + existing assignment → leave', 'link', false, true, 'none'],
  ])('%s', (_label, decision, productActive, hasAssignment, expected) => {
    expect(
      decideAssignment({
        decision: decision as 'create' | 'link',
        productActive,
        hasAssignment,
      }),
    ).toBe(expected);
  });
});

describe('reasonPrefix (§10.4)', () => {
  it('groups SKIPPED:<code> and FAILED:<code> under their prefix', () => {
    expect(reasonPrefix('SKIPPED:ALREADY_LINKED')).toBe('SKIPPED');
    expect(reasonPrefix('FAILED:QUOTA')).toBe('FAILED');
    expect(reasonPrefix('LINKED')).toBe('LINKED');
    expect(reasonPrefix('IMAGES_PARTIAL:3/2')).toBe('IMAGES_PARTIAL');
    expect(reasonPrefix('')).toBe('');
  });
});

describe('startImport (§7.1, §13)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    enableImport();
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  const dto = (overrides: Record<string, any> = {}) => ({
    decisions: [{ remoteId: '101', action: 'create' }],
    publishMode: 'draft',
    categoryMode: 'with_categories',
    ...overrides,
  });

  it('refuses when the kill switch is off', async () => {
    process.env.store_product_import_enabled = 'false';
    const { service } = makeService();
    await expect(service.startImport(STORE_ID, dto() as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a non-WooCommerce store', async () => {
    const { service } = makeService({
      stores: {
        detail: jest.fn(async () => ({ id: STORE_ID, kind: 'SHOPIFY', status: 'CONNECTED' })),
      },
    });
    await expect(service.startImport(STORE_ID, dto() as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a disconnected store', async () => {
    const { service } = makeService({
      stores: {
        detail: jest.fn(async () => ({ id: STORE_ID, kind: 'WOOCOMMERCE', status: 'DISCONNECTED' })),
      },
    });
    await expect(service.startImport(STORE_ID, dto() as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects duplicate decisions, link without a target, and bad category modes', async () => {
    const { service } = makeService();
    await expect(
      service.startImport(
        STORE_ID,
        dto({ decisions: [{ remoteId: '1', action: 'create' }, { remoteId: '1', action: 'skip' }] }) as any,
      ),
    ).rejects.toThrow('Duplicate decision');
    await expect(
      service.startImport(STORE_ID, dto({ decisions: [{ remoteId: '1', action: 'link' }] }) as any),
    ).rejects.toThrow('missing its local product');
    await expect(
      service.startImport(STORE_ID, dto({ categoryMode: 'assign_one' }) as any),
    ).rejects.toThrow('categoryId is required');
  });

  it('rejects a missing link target', async () => {
    const { service } = makeService();
    await expect(
      service.startImport(
        STORE_ID,
        dto({ decisions: [{ remoteId: '1', action: 'link', productId: 'nope' }] }) as any,
      ),
    ).rejects.toThrow('not found');
  });

  it('quota pre-check blocks an over-limit active import (§13.4)', async () => {
    const { service } = makeService({
      limits: { getLimit: jest.fn(() => 10), getUsage: jest.fn(async () => 9) },
    });
    await expect(
      service.startImport(
        STORE_ID,
        dto({
          publishMode: 'active',
          decisions: [
            { remoteId: '1', action: 'create', remoteStatus: 'publish' },
            { remoteId: '2', action: 'create', remoteStatus: 'publish' },
          ],
        }) as any,
      ),
    ).rejects.toThrow('shortfall 1');
  });

  it('quota pre-check passes for drafts (quota-free) and ignores draft remotes', async () => {
    const { service, runs, queues } = makeService({
      limits: { getLimit: jest.fn(() => 10), getUsage: jest.fn(async () => 10) },
    });
    const out = await service.startImport(
      STORE_ID,
      dto({
        publishMode: 'active',
        decisions: [{ remoteId: '1', action: 'create', remoteStatus: 'draft' }],
      }) as any,
    );
    expect(out.runId).toBe(BATCH_ID);
    expect(runs.begin).toHaveBeenCalledTimes(1);
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });

  it('dedupes a second confirm with the same idempotency key (§13.2)', async () => {
    const { service, runs, queues } = makeService({
      prisma: {
        syncRun: {
          findFirst: jest.fn(async () => ({ id: 'existing-batch' })),
          findUnique: jest.fn(async () => null),
          update: jest.fn(async () => ({})),
        },
      },
    });
    const out = await service.startImport(
      STORE_ID,
      dto({ idempotencyKey: 'key-1' }) as any,
    );
    expect(out).toEqual({ runId: 'existing-batch', deduped: true });
    expect(runs.begin).not.toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('fans out one page job per 100 decisions', async () => {
    const { service, queues, runs } = makeService();
    const decisions = Array.from({ length: 250 }, (_, i) => ({
      remoteId: String(i + 1),
      action: 'create' as const,
    }));
    const out = await service.startImport(STORE_ID, dto({ decisions }) as any);
    expect(out).toEqual({ runId: BATCH_ID, deduped: false });
    expect(queues.enqueue).toHaveBeenCalledTimes(3);
    expect(queues.enqueue).toHaveBeenNthCalledWith(
      1,
      'store-product-import',
      'import-page',
      expect.objectContaining({ batchRunId: BATCH_ID, storeId: STORE_ID, pageIndex: 0 }),
      expect.stringContaining('import-page-'),
    );
    const meta = (runs.begin as jest.Mock).mock.calls[0][0].metadata.import;
    expect(meta.pageCount).toBe(3);
    expect(meta.decisions).toHaveLength(250);
    expect(meta.stockTick).toBe(true);
    expect(meta.skipImages).toBe(false);
  });
});

describe('importOne — skip / already-linked / remote-gone', () => {
  const ctx = (provider: any, overrides: Record<string, any> = {}) => ({
    batchRunId: BATCH_ID,
    childRunId: 'child-1',
    storeId: STORE_ID,
    store: { id: STORE_ID, kind: 'WOOCOMMERCE', status: 'CONNECTED' },
    provider,
    secrets: { id: STORE_ID, kind: 'WOOCOMMERCE' },
    options: {
      publishMode: 'draft',
      categoryMode: 'with_categories',
      stockTick: true,
      skipImages: false,
    },
    cache: {
      categories: new Map(),
      categoriesCreated: new Set<string>(),
      tags: new Map(),
      brands: new Map(),
      attributes: new Map(),
      attributeValues: new Map(),
    },
    ...overrides,
  });

  const remote = {
    id: 101,
    name: 'Blue Panjabi',
    slug: 'blue-panjabi',
    sku: 'BP-001',
    type: 'simple',
    status: 'publish',
    regular_price: '1200',
  };

  it('skip decision persists the skip and records SKIPPED:DECISION', async () => {
    const { service, prisma, runs, provider } = makeService();
    const out = await service.importOne(ctx(provider) as any, {
      remote: remote as any,
      variations: [],
      decision: { remoteId: '101', action: 'skip', note: 'not now' },
    });
    expect(out).toMatchObject({ status: 'skipped', reason: 'SKIPPED:DECISION' });
    expect(prisma.storeProductImportSkip.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId_externalId: { storeId: STORE_ID, externalId: '101' } },
      }),
    );
    expect(runs.recordItem).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ status: 'SKIPPED', reason: 'SKIPPED:DECISION' }),
    );
  });

  it('re-import of a linked product skips and reports only (R2)', async () => {
    const { service, runs, provider } = makeService({
      prisma: {
        storeProductMapping: {
          findUnique: jest.fn(async () => ({ productId: 'local-1' })),
        },
      },
    });
    const out = await service.importOne(ctx(provider) as any, {
      remote: remote as any,
      variations: [],
      decision: { remoteId: '101', action: 'create' },
    });
    expect(out).toMatchObject({ status: 'skipped', reason: 'SKIPPED:ALREADY_LINKED', productId: 'local-1' });
    expect(runs.recordItem).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ status: 'SKIPPED', reason: 'SKIPPED:ALREADY_LINKED' }),
    );
  });

  it('fetchProduct 404 on an import-origin mapping unlinks + keeps local (R10/D5)', async () => {
    const { service, runs, provider, prismaTx } = makeService({
      provider: {
        fetchProduct: jest.fn(async () => {
          throw new ProviderError('gone', ProviderErrorCategory.REMOTE_NOT_FOUND, 'woocommerce');
        }),
      },
      prisma: {
        storeProductMapping: {
          findUnique: jest.fn(async () => ({ productId: 'local-1', origin: 'IMPORT_CREATE' })),
        },
      },
    });
    const out = await service.importOne(ctx(provider) as any, {
      remote: null,
      variations: [],
      decision: { remoteId: '101', action: 'create' },
    });
    expect(out).toMatchObject({ status: 'remote_deleted', reason: 'REMOTE_DELETED' });
    expect(prismaTx.storeVariantMapping.deleteMany).toHaveBeenCalled();
    expect(prismaTx.productStoreFieldState.deleteMany).toHaveBeenCalled();
    expect(prismaTx.productStoreAssignment.deleteMany).toHaveBeenCalled();
    expect(prismaTx.storeProductMapping.delete).toHaveBeenCalled();
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'REMOTE_DELETED' }),
    );
  });

  it('fetchProduct 404 on a push-origin mapping leaves it alone (push re-creates)', async () => {
    const { service, runs, provider, prismaTx } = makeService({
      provider: {
        fetchProduct: jest.fn(async () => {
          throw new ProviderError('gone', ProviderErrorCategory.REMOTE_NOT_FOUND, 'woocommerce');
        }),
      },
      prisma: {
        storeProductMapping: {
          findUnique: jest.fn(async () => ({ productId: 'local-1', origin: 'PUSH' })),
        },
      },
    });
    const out = await service.importOne(ctx(provider) as any, {
      remote: null,
      variations: [],
      decision: { remoteId: '101', action: 'create' },
    });
    expect(out).toMatchObject({ status: 'skipped', reason: 'SKIPPED:ALREADY_LINKED' });
    expect(prismaTx.storeProductMapping.delete).not.toHaveBeenCalled();
    expect(runs.upsertIssue).not.toHaveBeenCalled();
  });

  it('fetchProduct 404 with no mapping: create skips, link fails', async () => {
    const { service, provider } = makeService({
      provider: {
        fetchProduct: jest.fn(async () => {
          throw new ProviderError('gone', ProviderErrorCategory.REMOTE_NOT_FOUND, 'woocommerce');
        }),
      },
    });
    const skipped = await service.importOne(ctx(provider) as any, {
      remote: null,
      variations: [],
      decision: { remoteId: '101', action: 'create' },
    });
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'SKIPPED:REMOTE_DELETED' });
    const failed = await service.importOne(ctx(provider) as any, {
      remote: null,
      variations: [],
      decision: { remoteId: '101', action: 'link', productId: 'local-1' },
    });
    expect(failed).toMatchObject({ status: 'failed', reason: 'FAILED:REMOTE_DELETED' });
  });

  it('a non-404 fetchProduct failure propagates (processor records FAILED:UNEXPECTED)', async () => {
    const { service, provider } = makeService({
      provider: {
        fetchProduct: jest.fn(async () => {
          throw new ProviderError('down', ProviderErrorCategory.TEMPORARY_FAILURE, 'woocommerce');
        }),
      },
    });
    await expect(
      service.importOne(ctx(provider) as any, {
        remote: null,
        variations: [],
        decision: { remoteId: '101', action: 'create' },
      }),
    ).rejects.toThrow('down');
  });
});

describe('retryFailedImport + reasonCounts + imageStatus (§10.4–10.5)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    enableImport();
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  const batchMeta = {
    import: {
      publishMode: 'draft',
      categoryMode: 'with_categories',
      stockTick: true,
      skipImages: false,
      pageCount: 1,
      imageJobsTotal: 0,
      decisions: [
        { remoteId: '1', action: 'create' },
        { remoteId: '2', action: 'create' },
        { remoteId: '3', action: 'create' },
      ],
    },
  };

  it('retry re-runs FAILED items only, with a new idempotency key', async () => {
    const { service, runs, queues } = makeService({
      prisma: {
        syncRun: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => ({
            id: BATCH_ID,
            scope: 'PRODUCT_IMPORT',
            parentRunId: null,
            status: 'PARTIAL',
            storeId: STORE_ID,
            metadata: batchMeta,
          })),
          update: jest.fn(async () => ({})),
        },
        syncRunItem: {
          findMany: jest.fn(async () => [
            { externalObjectId: '2' },
            { externalObjectId: '2' },
          ]),
        },
      },
      runs: {
        childRuns: jest.fn(async () => [{ id: 'child-1' }]),
      },
    });
    const out = await service.retryFailedImport(BATCH_ID, 'user-1');
    expect(out.retried).toBe(1);
    expect(runs.begin).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'PRODUCT_IMPORT', triggerType: 'RETRY' }),
    );
    const meta = (runs.begin as jest.Mock).mock.calls[0][0].metadata.import;
    expect(meta.decisions).toEqual([{ remoteId: '2', action: 'create' }]);
    expect(meta.retriesRunId).toBe(BATCH_ID);
    expect(meta.idempotencyKey).toMatch(/^retry:/);
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });

  it('retry refuses a running batch', async () => {
    const { service } = makeService({
      prisma: {
        syncRun: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => ({
            id: BATCH_ID,
            scope: 'PRODUCT_IMPORT',
            parentRunId: null,
            status: 'RUNNING',
            storeId: STORE_ID,
            metadata: batchMeta,
          })),
          update: jest.fn(async () => ({})),
        },
      },
    });
    await expect(service.retryFailedImport(BATCH_ID)).rejects.toThrow('still running');
  });

  it('retry refuses a batch with nothing failed', async () => {
    const { service } = makeService({
      prisma: {
        syncRun: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => ({
            id: BATCH_ID,
            scope: 'PRODUCT_IMPORT',
            parentRunId: null,
            status: 'SUCCESS',
            storeId: STORE_ID,
            metadata: batchMeta,
          })),
          update: jest.fn(async () => ({})),
        },
        syncRunItem: { findMany: jest.fn(async () => []) },
      },
      runs: {
        childRuns: jest.fn(async () => [{ id: 'child-1' }]),
      },
    });
    await expect(service.retryFailedImport(BATCH_ID)).rejects.toThrow('No failed items');
  });

  it('reasonCounts groups by prefix across batch + children', async () => {
    const { service } = makeService({
      runs: {
        childRuns: jest.fn(async () => [{ id: 'child-1' }, { id: 'child-2' }]),
        countItemsByReason: jest.fn(async () => [
          { reason: 'CREATED', count: 5 },
          { reason: 'CREATED:IMAGE_LIMIT', count: 1 },
          { reason: 'SKIPPED:ALREADY_LINKED', count: 2 },
          { reason: 'FAILED:QUOTA', count: 1 },
        ]),
      },
    });
    const out = await service.reasonCounts(BATCH_ID);
    expect(out).toEqual({
      counts: { CREATED: 6, SKIPPED: 2, FAILED: 1 },
      total: 9,
    });
  });

  it('imageStatus parses IMAGES_* reasons into downloaded/pending/failed', async () => {
    const { service } = makeService({
      prisma: {
        syncRun: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => ({
            metadata: { import: { imageJobsTotal: 4 } },
            storeId: STORE_ID,
          })),
          update: jest.fn(async () => ({})),
        },
      },
      runs: {
        childRuns: jest.fn(async () => []),
        countItemsByReason: jest.fn(async () => [
          { reason: 'IMAGES_OK:3', count: 1 },
          { reason: 'IMAGES_PARTIAL:2/1', count: 1 },
          { reason: 'IMAGES_FAILED:2', count: 1 },
          { reason: 'CREATED', count: 4 },
        ]),
      },
    });
    const out = await service.imageStatus(BATCH_ID);
    expect(out).toEqual({
      total: 4,
      completed: 3,
      pending: 1,
      failed: 1,
      downloaded: 5,
      failedImages: 3,
    });
  });

  it('importSummary merges accumulated metadata counts with live image counts', async () => {
    const { service } = makeService({
      prisma: {
        syncRun: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => ({
            metadata: {
              import: {
                imageJobsTotal: 2,
                summary: { variantsImported: 5, categoriesCreated: 2, categoriesReused: 3 },
              },
            },
            storeId: STORE_ID,
          })),
          update: jest.fn(async () => ({})),
        },
      },
      runs: {
        childRuns: jest.fn(async () => []),
        countItemsByReason: jest.fn(async () => [
          { reason: 'IMAGES_OK:4', count: 1 },
          { reason: 'IMAGES_FAILED:1', count: 1 },
          { reason: 'CREATED', count: 3 },
        ]),
      },
    });
    const out = await service.importSummary(BATCH_ID);
    expect(out).toEqual({
      categoriesCreated: 2,
      categoriesReused: 3,
      variantsImported: 5,
      imagesDownloaded: 4,
      imagesPending: 0,
      imagesFailed: 1,
    });
  });

  it('importSummary returns zeros when the batch has no summary yet', async () => {
    const { service } = makeService({
      prisma: {
        syncRun: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async () => ({
            metadata: { import: { imageJobsTotal: 0 } },
            storeId: STORE_ID,
          })),
          update: jest.fn(async () => ({})),
        },
      },
      runs: {
        childRuns: jest.fn(async () => []),
        countItemsByReason: jest.fn(async () => []),
      },
    });
    const out = await service.importSummary(BATCH_ID);
    expect(out).toEqual({
      categoriesCreated: 0,
      categoriesReused: 0,
      variantsImported: 0,
      imagesDownloaded: 0,
      imagesPending: 0,
      imagesFailed: 0,
    });
  });
});
