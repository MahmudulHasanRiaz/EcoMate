/**
 * Product-import processors (§10.2–10.3, R5).
 *
 * Page processor: G-4 kill-switch refusal (still closes the page out so
 * the batch cannot hang), cancel-before-start, per-item isolation,
 * completion-sweep aggregation. Image processor: all-ok / partial /
 * failed outcomes, BullMQ retry on non-final attempts, final-attempt
 * issue recording, kill-switch refusal.
 */
import {
  StoreProductImportImagesProcessor,
  StoreProductImportProcessor,
} from '../store-product-import.processor';

const STORE_ID = 'store-1';
const BATCH_ID = 'batch-1';

const BATCH_META = {
  import: {
    publishMode: 'draft',
    categoryMode: 'with_categories',
    stockTick: true,
    skipImages: false,
    pageCount: 1,
    imageJobsTotal: 0,
    decisions: [{ remoteId: '101', action: 'create' }],
  },
};

function enableImport() {
  process.env.THIRD_PARTY_STORES_ENABLED = 'true';
  process.env.store_sync_enabled = 'true';
  process.env.store_product_sync_enabled = 'true';
  process.env.store_product_import_enabled = 'true';
}

function makePageProcessor(overrides: Record<string, any> = {}) {
  const batchState: any = {
    id: BATCH_ID,
    status: 'RUNNING',
    triggerType: 'MANUAL',
    initiatedById: 'user-1',
    metadata: BATCH_META,
    ...(overrides.batch ?? {}),
  };
  const childrenState: any[] = overrides.children ?? [];
  const runs = {
    begin: jest.fn(async () => ({ id: 'child-1' })),
    recordItem: jest.fn(async () => ({})),
    upsertIssue: jest.fn(async () => ({})),
    finish: jest.fn(async (runId: string, counts: any) => {
      if (runId === 'child-1') {
        childrenState.push({
          id: 'child-1',
          status: counts.failed === 0 ? 'SUCCESS' : 'PARTIAL',
          createdCount: counts.created,
          updatedCount: counts.updated,
          skippedCount: counts.skipped,
          failedCount: counts.failed,
        });
      }
      if (runId === BATCH_ID) batchState.status = 'SUCCESS';
      return {};
    }),
    childRuns: jest.fn(async () => [...childrenState]),
    ...overrides.runs,
  };
  const provider = {
    listProducts: jest.fn(async () => ({
      products: [
        { id: 101, name: 'Blue Panjabi', type: 'simple', status: 'publish' },
      ],
      hasMore: false,
    })),
    ...overrides.provider,
  };
  const imports = {
    getBatchRun: jest.fn(async () => batchState),
    importContext: jest.fn(async () => ({
      store: { id: STORE_ID, kind: 'WOOCOMMERCE', status: 'CONNECTED' },
      provider,
      secrets: { id: STORE_ID, kind: 'WOOCOMMERCE' },
    })),
    importOne: jest.fn(async (_ctx: any, input: any) => ({
      status: 'created',
      reason: 'CREATED',
      remoteId: input.decision.remoteId,
      productId: 'local-1',
      imageJobEnqueued: false,
    })),
    fetchAllVariations: jest.fn(async () => []),
    bumpImageJobsTotal: jest.fn(async () => undefined),
    bumpImportSummary: jest.fn(async () => undefined),
    ...overrides.imports,
  };
  const queues = {
    serializeStore: jest.fn((_storeId: string, fn: () => unknown) => fn()),
  };
  const processor = new StoreProductImportProcessor(
    {} as any,
    imports as any,
    runs as any,
    queues as any,
  );
  return { processor, runs, imports, queues, provider, batchState, childrenState };
}

function pageJob(decisions: any[] = [{ remoteId: '101', action: 'create' }]) {
  return {
    name: 'import-page',
    data: { batchRunId: BATCH_ID, storeId: STORE_ID, pageIndex: 0, decisions },
  } as any;
}

describe('StoreProductImportProcessor (§10.3)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    enableImport();
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('processes a page, finishes the child run, and sweeps the batch done', async () => {
    const { processor, runs, imports } = makePageProcessor();
    const out = await (processor as any).handle(pageJob());
    expect(out).toMatchObject({ childRunId: 'child-1', created: 1, failed: 0 });
    expect(imports.importOne).toHaveBeenCalledTimes(1);
    expect(runs.finish).toHaveBeenCalledWith('child-1', {
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
    // Sweep: the only child is terminal → the batch finishes with the totals.
    expect(runs.finish).toHaveBeenCalledWith(BATCH_ID, {
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('aggregates created/linked/skipped/failed across items', async () => {
    const { processor, runs } = makePageProcessor({
      imports: {
        importOne: jest.fn(async (_ctx: any, input: any) => {
          const map: Record<string, any> = {
            '1': { status: 'created', reason: 'CREATED', remoteId: '1', imageJobEnqueued: false },
            '2': { status: 'linked', reason: 'LINKED', remoteId: '2', imageJobEnqueued: false },
            '3': { status: 'skipped', reason: 'SKIPPED:DECISION', remoteId: '3', imageJobEnqueued: false },
            '4': { status: 'failed', reason: 'FAILED:QUOTA', remoteId: '4', imageJobEnqueued: false },
            '5': { status: 'remote_deleted', reason: 'REMOTE_DELETED', remoteId: '5', imageJobEnqueued: false },
          };
          return map[input.decision.remoteId];
        }),
      },
    });
    const decisions = ['1', '2', '3', '4', '5'].map((remoteId) => ({ remoteId, action: 'create' }));
    const out = await (processor as any).handle(pageJob(decisions));
    expect(out).toMatchObject({ created: 1, updated: 1, skipped: 2, failed: 1 });
    expect(runs.finish).toHaveBeenCalledWith('child-1', {
      created: 1,
      updated: 1,
      skipped: 2,
      failed: 1,
    });
  });

  it('isolates a poisoned item: FAILED:UNEXPECTED, the rest still import (§13.3)', async () => {
    const { processor, runs, imports } = makePageProcessor({
      imports: {
        importOne: jest.fn(async (_ctx: any, input: any) => {
          if (input.decision.remoteId === 'bad') throw new Error('boom');
          return { status: 'created', reason: 'CREATED', remoteId: input.decision.remoteId, imageJobEnqueued: false };
        }),
      },
    });
    const out = await (processor as any).handle(
      pageJob([
        { remoteId: 'bad', action: 'create' },
        { remoteId: 'good', action: 'create' },
      ]),
    );
    expect(out).toMatchObject({ created: 1, failed: 1 });
    expect(imports.importOne).toHaveBeenCalledTimes(2);
    expect(runs.recordItem).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ status: 'FAILED', reason: 'FAILED:UNEXPECTED' }),
    );
  });

  it('does no work when the batch was cancelled (cancel-before-start)', async () => {
    const { processor, runs, imports } = makePageProcessor({
      batch: { status: 'CANCELLED' },
    });
    const out = await (processor as any).handle(pageJob());
    expect(out).toMatchObject({ childRunId: '' });
    expect(runs.begin).not.toHaveBeenCalled();
    expect(imports.importOne).not.toHaveBeenCalled();
  });

  it('refuses when the kill switch is off — and still closes the page out (G-4)', async () => {
    process.env.store_product_import_enabled = 'false';
    const { processor, runs, imports } = makePageProcessor();
    const out = await (processor as any).handle(
      pageJob([
        { remoteId: '101', action: 'create' },
        { remoteId: '102', action: 'create' },
      ]),
    );
    expect(out).toEqual({ refused: true });
    expect(imports.importOne).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledTimes(2);
    expect(runs.recordItem).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ status: 'FAILED', reason: 'FAILED:IMPORT_DISABLED' }),
    );
    expect(runs.finish).toHaveBeenCalledWith('child-1', {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 2,
    });
    // The sweep still runs: the batch finishes (FAILED) instead of hanging.
    expect(runs.finish).toHaveBeenCalledWith(
      BATCH_ID,
      expect.objectContaining({ failed: 2 }),
    );
  });

  it('sweep waits while another child run is still RUNNING', async () => {
    const { processor, runs } = makePageProcessor({
      batch: {
        metadata: { import: { ...BATCH_META.import, pageCount: 2 } },
      },
      children: [
        { id: 'child-0', status: 'RUNNING', createdCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0 },
      ],
    });
    await (processor as any).handle(pageJob());
    // Child finished, but the batch must NOT finish (child-0 still running).
    expect(runs.finish).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ created: 1 }),
    );
    expect(runs.finish).not.toHaveBeenCalledWith(
      BATCH_ID,
      expect.anything(),
    );
  });

  it('sweep never re-finishes a batch cancelled mid-page', async () => {
    // First read (page start): RUNNING. Second read (sweep): CANCELLED —
    // the operator cancelled while the page was processing. The child run
    // still finishes, but the batch is never re-finished.
    const running = { id: BATCH_ID, status: 'RUNNING', triggerType: 'MANUAL', initiatedById: 'user-1', metadata: BATCH_META };
    const cancelled = { ...running, status: 'CANCELLED' };
    const { processor, runs } = makePageProcessor();
    // Call-counting getBatchRun: RUNNING once (page start), then CANCELLED.
    let reads = 0;
    (processor as any).imports.getBatchRun = jest.fn(async () => {
      reads += 1;
      return reads === 1 ? running : cancelled;
    });
    const out = await (processor as any).handle(pageJob());
    expect(out).toMatchObject({ created: 1 });
    expect(runs.finish).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ created: 1 }),
    );
    expect(runs.finish).not.toHaveBeenCalledWith(BATCH_ID, expect.anything());
  });

  it('a page-level list failure fails every decision explicitly', async () => {
    const { processor, runs } = makePageProcessor({
      provider: {
        listProducts: jest.fn(async () => {
          throw new Error('woo down');
        }),
      },
    });
    const out = await (processor as any).handle(
      pageJob([
        { remoteId: '101', action: 'create' },
        { remoteId: '102', action: 'create' },
      ]),
    );
    expect(out).toMatchObject({ failed: 2 });
    expect(runs.recordItem).toHaveBeenCalledTimes(2);
    expect(runs.recordItem).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ status: 'FAILED', reason: 'FAILED:PROVIDER_ERROR' }),
    );
  });

  it('bumps the batch image-job total by the enqueued count', async () => {
    const { processor, imports } = makePageProcessor({
      imports: {
        importOne: jest.fn(async (_ctx: any, input: any) => ({
          status: 'created',
          reason: 'CREATED',
          remoteId: input.decision.remoteId,
          imageJobEnqueued: true,
        })),
      },
    });
    await (processor as any).handle(
      pageJob([
        { remoteId: '101', action: 'create' },
        { remoteId: '102', action: 'create' },
      ]),
    );
    expect(imports.bumpImageJobsTotal).toHaveBeenCalledWith(BATCH_ID, 2);
  });

  it('aggregates per-item summary deltas into one batch bump', async () => {
    const { processor, imports } = makePageProcessor({
      imports: {
        importOne: jest.fn(async (_ctx: any, input: any) => ({
          '101': {
            status: 'created',
            reason: 'CREATED',
            remoteId: '101',
            imageJobEnqueued: false,
            variantsImported: 2,
            categoriesCreated: 1,
            categoriesReused: 1,
          },
          '102': {
            status: 'linked',
            reason: 'LINKED',
            remoteId: '102',
            imageJobEnqueued: false,
            variantsImported: 3,
          },
          '103': { status: 'failed', reason: 'FAILED:QUOTA', remoteId: '103', imageJobEnqueued: false },
        })[input.decision.remoteId]),
      },
    });
    await (processor as any).handle(
      pageJob([
        { remoteId: '101', action: 'create' },
        { remoteId: '102', action: 'link', productId: 'local-1' },
        { remoteId: '103', action: 'create' },
      ]),
    );
    expect(imports.bumpImportSummary).toHaveBeenCalledWith(BATCH_ID, {
      variantsImported: 5,
      categoriesCreated: 1,
      categoriesReused: 1,
    });
  });
});

describe('StoreProductImportImagesProcessor (R5)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    enableImport();
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  function makeImagesProcessor(overrides: Record<string, any> = {}) {
    const prisma = {
      product: { update: jest.fn(async () => ({})) },
      ...overrides.prisma,
    };
    const media = {
      ingestFromUrl: jest.fn(async (url: string) => ({
        id: `m-${url.slice(-6)}`,
        url: `https://cdn.test/${url.split('/').pop()}`,
        filename: 'img.jpg',
        size: 100,
        mimeType: 'image/jpeg',
      })),
      syncEntityImages: jest.fn(async (_t: string, _id: string, urls: string[]) => urls),
      ...overrides.media,
    };
    const runs = {
      recordItem: jest.fn(async () => ({})),
      upsertIssue: jest.fn(async () => ({})),
      ...overrides.runs,
    };
    const queues = {
      serializeStore: jest.fn((_storeId: string, fn: () => unknown) => fn()),
    };
    const processor = new StoreProductImportImagesProcessor(
      prisma as any,
      media as any,
      runs as any,
      queues as any,
    );
    return { processor, prisma, media, runs };
  }

  function imagesJob(attemptsMade = 0, attempts = 3) {
    return {
      name: 'import-images',
      attemptsMade,
      opts: { attempts },
      data: {
        batchRunId: BATCH_ID,
        storeId: STORE_ID,
        productId: 'local-1',
        externalId: '101',
        images: [
          { src: 'https://woo.test/a.jpg', alt: 'a' },
          { src: 'https://woo.test/b.jpg', alt: null },
        ],
      },
    } as any;
  }

  it('downloads all images, attaches them, records IMAGES_OK:n', async () => {
    const { processor, prisma, media, runs } = makeImagesProcessor();
    const out = await (processor as any).handle(imagesJob());
    expect(out).toEqual({ downloaded: 2 });
    expect(media.ingestFromUrl).toHaveBeenCalledTimes(2);
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'local-1' },
      data: { images: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'] },
    });
    expect(runs.recordItem).toHaveBeenCalledWith(
      BATCH_ID,
      expect.objectContaining({ objectType: 'MEDIA', status: 'SUCCESS', reason: 'IMAGES_OK:2' }),
    );
    expect(runs.upsertIssue).not.toHaveBeenCalled();
  });

  it('retries (throws) on a non-final attempt with failures', async () => {
    const { processor, runs } = makeImagesProcessor({
      media: {
        ingestFromUrl: jest.fn(async (url: string) => {
          if (url.includes('b.jpg')) throw new Error('503');
          return { id: 'm-a', url: 'https://cdn.test/a.jpg', filename: 'a.jpg', size: 1, mimeType: 'image/jpeg' };
        }),
      },
    });
    await expect((processor as any).handle(imagesJob(0, 3))).rejects.toThrow('1/2 failed');
    expect(runs.recordItem).not.toHaveBeenCalled();
    expect(runs.upsertIssue).not.toHaveBeenCalled();
  });

  it('on the final attempt records IMAGE_DOWNLOAD_FAILED + IMAGES_PARTIAL and keeps partial images', async () => {
    const { processor, prisma, runs } = makeImagesProcessor({
      media: {
        ingestFromUrl: jest.fn(async (url: string) => {
          if (url.includes('b.jpg')) throw new Error('503');
          return { id: 'm-a', url: 'https://cdn.test/a.jpg', filename: 'a.jpg', size: 1, mimeType: 'image/jpeg' };
        }),
      },
    });
    const out = await (processor as any).handle(imagesJob(2, 3));
    expect(out).toEqual({ downloaded: 1, failed: 1 });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'local-1' },
      data: { images: ['https://cdn.test/a.jpg'] },
    });
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'IMAGE_DOWNLOAD_FAILED' }),
    );
    expect(runs.recordItem).toHaveBeenCalledWith(
      BATCH_ID,
      expect.objectContaining({ status: 'SUCCESS', reason: 'IMAGES_PARTIAL:1/1' }),
    );
  });

  it('records IMAGES_FAILED when every image fails on the final attempt', async () => {
    const { processor, runs } = makeImagesProcessor({
      media: {
        ingestFromUrl: jest.fn(async () => {
          throw new Error('503');
        }),
      },
    });
    const out = await (processor as any).handle(imagesJob(2, 3));
    expect(out).toEqual({ downloaded: 0, failed: 2 });
    expect(runs.recordItem).toHaveBeenCalledWith(
      BATCH_ID,
      expect.objectContaining({ status: 'FAILED', reason: 'IMAGES_FAILED:2' }),
    );
  });

  it('refuses when the kill switch is off and records the outcome (G-4)', async () => {
    process.env.store_product_import_enabled = 'false';
    const { processor, media, runs } = makeImagesProcessor();
    const out = await (processor as any).handle(imagesJob());
    expect(out).toEqual({ refused: true });
    expect(media.ingestFromUrl).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      BATCH_ID,
      expect.objectContaining({ status: 'FAILED', reason: 'IMAGES_FAILED:2' }),
    );
  });
});
