/**
 * G-08/G-09 at the ingest processor (J-09 defense in depth, second layer).
 *
 * A job enqueued before the operator flipped auto-sync / scope off must
 * not ingest. The processor re-checks the store's settings at execution
 * time, BEFORE taking the per-store lock; a skip finishes the run as
 * skipped (never stranded RUNNING) and records a visible IGNORED row.
 *
 * Fail-open is deliberate: no Prisma (specs), a missing store row, or a
 * lookup error all allow ingest — a gate failure must never suppress
 * orders (intake already gated the common case).
 */
import { StoreOrderIngestProcessor } from '../sync.processors';

function makeProcessor(storeRow: any = { autoSyncEnabled: true, settings: {} }, opts: {
  withPrisma?: boolean;
  storeThrows?: boolean;
  withFailureTable?: boolean;
} = {}) {
  const { withPrisma = true, storeThrows = false, withFailureTable = true } = opts;
  const runs = {
    recordItem: jest.fn(async () => ({})),
    finish: jest.fn(async () => ({})),
    upsertIssue: jest.fn(async () => ({})),
  };
  const queues = {
    serializeStore: jest.fn((_storeId: string, fn: () => unknown) => fn()),
  };
  const ingest = {
    ingest: jest.fn(async () => ({ orderId: 'order-1', created: true, status: 'Pending', statusChanged: true })),
  };
  const prisma: any = withPrisma
    ? {
        store: {
          findUnique: storeThrows
            ? jest.fn(async () => { throw new Error('db down'); })
            : jest.fn(async () => storeRow),
        },
        ...(withFailureTable
          ? { storeWebhookFailure: { upsert: jest.fn().mockResolvedValue({}) } }
          : {}),
      }
    : undefined;
  // 4th ctor arg is tenantRegistry (undefined here); Prisma is the 5th.
  const processor = new StoreOrderIngestProcessor(
    runs as any,
    queues as any,
    ingest as any,
    undefined,
    prisma,
  );
  return { processor, runs, queues, ingest, prisma };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    name: 'webhook-order',
    data: {
      runId: 'run-1',
      storeId: 'store-1',
      rawOrder: { id: 'ext-1' },
      deliveryKey: 'dlv-1',
      topic: 'order.created',
      provider: 'woocommerce',
      tenantId: '11111111-1111-4111-8111-111111111111',
      ...overrides,
    },
  } as any;
}

describe('StoreOrderIngestProcessor gating (G-08/G-09)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    process.env.store_order_sync_enabled = 'true';
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('autoSyncEnabled false → no ingest, run finished as skipped:1, IGNORED row', async () => {
    const { processor, runs, queues, ingest, prisma } = makeProcessor({ autoSyncEnabled: false });
    const out = await (processor as any).handle(job());
    expect(out).toEqual({ skipped: true, reason: 'AUTO_SYNC_DISABLED', deliveryKey: 'dlv-1' });
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(queues.serializeStore).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ objectType: 'ORDER', status: 'SKIPPED', reason: 'AUTO_SYNC_DISABLED' }),
    );
    expect(runs.finish).toHaveBeenCalledWith('run-1', { created: 0, updated: 0, skipped: 1, failed: 0 });
    expect(prisma.storeWebhookFailure.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.storeWebhookFailure.upsert.mock.calls[0][0].create).toMatchObject({
      storeId: 'store-1',
      deliveryKey: 'dlv-1',
      topic: 'order.created',
      reason: 'AUTO_SYNC_DISABLED',
      status: 'IGNORED',
    });
  });

  it('syncScope.orders false → no ingest, skip reason ORDER_SYNC_SCOPE_DISABLED', async () => {
    const { processor, runs, ingest, prisma } = makeProcessor({
      autoSyncEnabled: true,
      settings: { syncScope: { orders: false } },
    });
    const out = await (processor as any).handle(job());
    expect(out).toEqual({ skipped: true, reason: 'ORDER_SYNC_SCOPE_DISABLED', deliveryKey: 'dlv-1' });
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith('run-1', { created: 0, updated: 0, skipped: 1, failed: 0 });
    expect(prisma.storeWebhookFailure.upsert.mock.calls[0][0].create).toMatchObject({
      reason: 'ORDER_SYNC_SCOPE_DISABLED',
      status: 'IGNORED',
    });
  });

  it('defaults (null/unset) → ingest runs normally', async () => {
    for (const row of [
      { autoSyncEnabled: null, settings: null },
      { autoSyncEnabled: true, settings: {} },
      {},
    ]) {
      const { processor, ingest } = makeProcessor(row);
      await (processor as any).handle(job());
      expect(ingest.ingest).toHaveBeenCalledTimes(1);
    }
  });

  it('skips cleanly when the failure table has not landed yet (no delegate, no throw)', async () => {
    const { processor, runs, ingest } = makeProcessor(
      { autoSyncEnabled: false },
      { withFailureTable: false },
    );
    const out = await (processor as any).handle(job());
    expect(out).toEqual({ skipped: true, reason: 'AUTO_SYNC_DISABLED', deliveryKey: 'dlv-1' });
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledTimes(1);
  });

  it('no Prisma (3-arg construction) → gate is a no-op, ingest runs (backward compat)', async () => {
    const runs: any = {
      recordItem: jest.fn(async () => ({})),
      finish: jest.fn(async () => ({})),
      upsertIssue: jest.fn(async () => ({})),
    };
    const queues: any = { serializeStore: jest.fn((_s: string, fn: () => unknown) => fn()) };
    const ingest: any = {
      ingest: jest.fn(async () => ({ orderId: 'o1', created: true, status: 'Pending', statusChanged: true })),
    };
    const processor = new StoreOrderIngestProcessor(runs, queues, ingest);
    await (processor as any).handle(job());
    expect(ingest.ingest).toHaveBeenCalledTimes(1);
  });

  it('store lookup throws → fail open, ingest runs', async () => {
    const { processor, ingest } = makeProcessor(null, { storeThrows: true });
    await (processor as any).handle(job());
    expect(ingest.ingest).toHaveBeenCalledTimes(1);
  });

  it('missing store row → fail open, ingest runs', async () => {
    const { processor, ingest } = makeProcessor(null);
    await (processor as any).handle(job());
    expect(ingest.ingest).toHaveBeenCalledTimes(1);
  });

  it('threads topic + provider into the ingest call (G-15 needs them)', async () => {
    const { processor, ingest } = makeProcessor({ autoSyncEnabled: true });
    await (processor as any).handle(job({ topic: 'order.updated', provider: 'woocommerce' }));
    expect(ingest.ingest).toHaveBeenCalledWith(
      'store-1',
      { id: 'ext-1' },
      expect.objectContaining({ type: 'WEBHOOK', topic: 'order.updated', provider: 'woocommerce' }),
    );
  });

  it('skip without a runId still refuses ingest and returns skipped', async () => {
    const { processor, runs, ingest } = makeProcessor({ autoSyncEnabled: false });
    const out = await (processor as any).handle(job({ runId: undefined }));
    expect(out).toEqual({ skipped: true, reason: 'AUTO_SYNC_DISABLED', deliveryKey: 'dlv-1' });
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(runs.finish).not.toHaveBeenCalled();
    expect(runs.recordItem).not.toHaveBeenCalled();
  });
});
