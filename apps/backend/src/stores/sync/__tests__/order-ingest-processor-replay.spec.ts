/**
 * StoreOrderIngestProcessor — manual replay + ingest retry (Phase 9 G-12/G-16).
 *
 * (f) a `webhook-order-retry` job re-fetches the order through the
 * bounded reconcile path and resolves the failure row ONLY when the
 * order mapping exists afterwards (verified resolution).
 * Retry ladder (queue options: attempts 3, exponential backoff 5s —
 * stores.module.ts INGEST_QUEUE_DEFAULTS, Builder D): a transient
 * ingest failure rethrows plainly (BullMQ retries it) and records an
 * INGEST_FAILED row; a permanent failure (zero-stock reject, FK
 * errors) throws UnrecoverableError so the remaining attempts are
 * skipped; a retry that finally succeeds resolves the row.
 */
import { UnrecoverableError } from 'bullmq';
import { StoreOrderIngestProcessor } from '../sync.processors';
import { ZERO_STOCK_REJECT } from '../../orders/store-order-ingest.service';

function makeProcessor(opts: {
  ingestResult?: unknown;
  ingestError?: Error;
  resolveReplayResult?: boolean;
  runStoreResult?: unknown;
  runStoreError?: Error;
  withFailures?: boolean;
  withReconcile?: boolean;
} = {}) {
  const runs = {
    recordItem: jest.fn(async () => ({})),
    finish: jest.fn(async () => ({})),
    upsertIssue: jest.fn(async () => ({})),
  };
  const queues = {
    serializeStore: jest.fn((_storeId: string, fn: () => unknown) => fn()),
  };
  const ingest = {
    ingest: jest.fn(async () => {
      if (opts.ingestError) throw opts.ingestError;
      return opts.ingestResult ?? { orderId: 'order-1', created: true, status: 'Pending', statusChanged: true };
    }),
  };
  const failures = {
    recordFailureSafe: jest.fn(async () => ({})),
    resolveReplay: jest.fn(async () => opts.resolveReplayResult ?? true),
    resolveByDeliveryKey: jest.fn(async () => 1),
  };
  const reconcile = {
    runStore: jest.fn(async () => {
      if (opts.runStoreError) throw opts.runStoreError;
      return opts.runStoreResult ?? { created: 1, updated: 0, skipped: 0, failed: 0 };
    }),
  };
  const processor = new StoreOrderIngestProcessor(
    runs as any,
    queues as any,
    ingest as any,
    undefined,
    undefined,
    opts.withFailures === false ? undefined : (failures as any),
    opts.withReconcile === false ? undefined : (reconcile as any),
  );
  return { processor, runs, queues, ingest, failures, reconcile };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    name: 'webhook-order',
    attemptsMade: 0,
    data: {
      runId: 'run-1',
      storeId: 'store-1',
      rawOrder: { id: 'ext-1', status: 'processing', total: 250 },
      deliveryKey: 'dlv-1',
      topic: 'order.created',
      provider: 'woocommerce',
      tenantId: '11111111-1111-4111-8111-111111111111',
      ...overrides,
    },
  } as any;
}

function replayJob(overrides: Record<string, unknown> = {}) {
  const { rawOrder: _raw, ...rest } = job().data as Record<string, unknown>;
  void _raw;
  return {
    name: 'webhook-order-retry',
    attemptsMade: 0,
    data: {
      ...rest,
      rawOrder: undefined,
      replayFailureId: 'fail-1',
      externalOrderId: 'ext-1',
      replayWindowDays: 3,
      ...overrides,
    },
  } as any;
}

describe('StoreOrderIngestProcessor — manual replay (G-12)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    // Flags default ON when unset; pin them explicitly so a polluted
    // env in the same worker cannot flip the suite.
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    process.env.store_order_sync_enabled = 'true';
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('(f) replay job re-fetches via reconcile and resolves the row when the order exists', async () => {
    const { processor, runs, reconcile, failures, ingest } = makeProcessor();
    const out = await (processor as any).handle(replayJob());
    expect(out).toMatchObject({ replayed: true, resolved: true, created: 1 });
    expect(reconcile.runStore).toHaveBeenCalledWith(
      'store-1',
      'run-1',
      expect.objectContaining({ requestedDays: 3, wideningReason: 'webhook replay fail-1' }),
    );
    expect(failures.resolveReplay).toHaveBeenCalledWith('fail-1', 'store-1', 'ext-1');
    // The raw payload never rides a replay job — ingest is not called.
    expect(ingest.ingest).not.toHaveBeenCalled();
    // runStore finishes the run itself — the processor must NOT finish it again.
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it('replay leaves the row OPEN when the order is still missing after the re-fetch', async () => {
    const { processor, failures } = makeProcessor({ resolveReplayResult: false });
    const out = await (processor as any).handle(replayJob());
    expect(out).toMatchObject({ replayed: true, resolved: false });
    expect(failures.resolveReplay).toHaveBeenCalledTimes(1);
  });

  it('replay failure finishes the run FAILED, records INGEST_FAILED, and rethrows', async () => {
    const { processor, runs, failures } = makeProcessor({
      runStoreError: new Error('provider exploded'),
    });
    await expect((processor as any).handle(replayJob())).rejects.toThrow('provider exploded');
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 0,
      updated: 0,
      failed: 1,
    });
    expect(failures.recordFailureSafe).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-1', deliveryKey: 'dlv-1', reason: 'INGEST_FAILED' }),
    );
  });

  it('replay without a wired reconcile service degrades to the missing-payload path (run finished FAILED)', async () => {
    const { processor, runs, reconcile } = makeProcessor({ withReconcile: false });
    const out = await (processor as any).handle(replayJob());
    expect(out).toEqual({ ignored: 'missing-payload' });
    expect(reconcile.runStore).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 0,
      updated: 0,
      failed: 1,
    });
  });
});

describe('StoreOrderIngestProcessor — ingest retry ladder (G-12/G-16)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    // Flags default ON when unset; pin them explicitly so a polluted
    // env in the same worker cannot flip the suite.
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    process.env.store_order_sync_enabled = 'true';
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('transient failure rethrows PLAINLY (BullMQ retries it) and records an INGEST_FAILED row', async () => {
    const { processor, runs, failures } = makeProcessor({
      ingestError: new Error('db blip'),
    });
    let caught: unknown;
    try {
      await (processor as any).handle(
        job({
          rawOrder: {
            id: 'ext-1',
            status: 'processing',
            total: 250,
            customer: { name: 'Sara', phone: '01700000001' },
          },
        }),
      );
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toBe('db blip');
    expect(caught).not.toBeInstanceOf(UnrecoverableError);
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 0,
      updated: 0,
      failed: 1,
    });
    expect(failures.recordFailureSafe).toHaveBeenCalledTimes(1);
    const row = failures.recordFailureSafe.mock.calls[0][0];
    expect(row).toMatchObject({
      storeId: 'store-1',
      deliveryKey: 'dlv-1',
      topic: 'order.created',
      reason: 'INGEST_FAILED',
    });
    // J-11: the row payload is sanitized — no customer PII.
    expect(JSON.stringify(row.payload)).not.toContain('Sara');
    expect(JSON.stringify(row.payload)).not.toContain('01700000001');
    expect(row.payload).toMatchObject({ externalOrderId: 'ext-1' });
  });

  it('permanent failure (zero-stock reject) throws UnrecoverableError — no pointless retries', async () => {
    const { processor, failures } = makeProcessor({
      ingestError: new Error(`order rejected: ${ZERO_STOCK_REJECT} (SKU-1)`),
    });
    let caught: unknown;
    try {
      await (processor as any).handle(job());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnrecoverableError);
    // The failure row is still recorded (permanent ≠ invisible).
    expect(failures.recordFailureSafe).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'INGEST_FAILED' }),
    );
  });

  it('permanent FK errors (P2003/P2025) are also unrecoverable', async () => {
    const fk: any = new Error('Foreign key constraint failed');
    fk.code = 'P2003';
    const { processor } = makeProcessor({ ingestError: fk });
    await expect((processor as any).handle(job())).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('a retry that finally succeeds resolves the failure row (attemptsMade > 0)', async () => {
    const { processor, failures } = makeProcessor();
    await (processor as any).handle(job());
    // First attempt (attemptsMade 0): no resolve call — the happy
    // path must not pay an extra write per order.
    expect(failures.resolveByDeliveryKey).not.toHaveBeenCalled();

    const retry = makeProcessor();
    const retryJob = job();
    retryJob.attemptsMade = 2;
    await (retry.processor as any).handle(retryJob);
    expect(retry.failures.resolveByDeliveryKey).toHaveBeenCalledWith('dlv-1');
  });

  it('reconcile jobs (no deliveryKey) never write failure rows', async () => {
    const { processor, failures } = makeProcessor({
      ingestError: new Error('db blip'),
    });
    const reconcileJob = job({ deliveryKey: undefined });
    reconcileJob.name = 'order-reconcile';
    await expect((processor as any).handle(reconcileJob)).rejects.toThrow('db blip');
    expect(failures.recordFailureSafe).not.toHaveBeenCalled();
  });
});
