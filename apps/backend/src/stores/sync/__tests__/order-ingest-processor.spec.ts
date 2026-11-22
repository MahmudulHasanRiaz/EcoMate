/**
 * StoreOrderIngestProcessor run lifecycle — D-3 fix round.
 *
 * Webhook ORDER_INGEST runs used to never finish (the processor only
 * recordItem'd): every webhook left a permanently RUNNING row and the
 * Sync Center poll never settled. The processor must now finish its run
 * on success AND on failure, mirroring the product processor.
 */
import { StoreOrderIngestProcessor } from '../sync.processors';

function makeProcessor(ingestResult?: unknown, ingestError?: Error) {
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
      if (ingestError) throw ingestError;
      return ingestResult ?? { orderId: 'order-1', created: true, status: 'Pending', statusChanged: true };
    }),
  };
  const processor = new StoreOrderIngestProcessor(runs as any, queues as any, ingest as any);
  return { processor, runs, queues, ingest };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    name: 'webhook-order',
    data: {
      runId: 'run-1',
      storeId: 'store-1',
      rawOrder: { id: 'ext-1' },
      deliveryKey: 'dlv-1',
      tenantId: '11111111-1111-4111-8111-111111111111',
      ...overrides,
    },
  } as any;
}

describe('StoreOrderIngestProcessor (D-3)', () => {
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

  it('finishes the run as created:1 on a fresh ingest', async () => {
    const { processor, runs } = makeProcessor();
    const out = await (processor as any).handle(job());
    expect(out).toMatchObject({ orderId: 'order-1', created: true, deliveryKey: 'dlv-1' });
    expect(runs.finish).toHaveBeenCalledTimes(1);
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('finishes the run as skipped:1 on an unchanged replay (no create, no status change)', async () => {
    const { processor, runs } = makeProcessor({
      orderId: 'order-1',
      created: false,
      status: 'Pending',
      statusChanged: false,
    });
    await (processor as any).handle(job());
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it('finishes the run as updated:1 on a status-only reconcile', async () => {
    const { processor, runs } = makeProcessor({
      orderId: 'order-1',
      created: false,
      status: 'Confirmed',
      statusChanged: true,
    });
    await (processor as any).handle(job({}));
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it('finishes the run as FAILED on ingest failure, then rethrows', async () => {
    const { processor, runs } = makeProcessor(undefined, new Error('boom'));
    await expect((processor as any).handle(job())).rejects.toThrow('boom');
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ objectType: 'ORDER', status: 'FAILED' }),
    );
    expect(runs.upsertIssue).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-1', code: 'ORDER_INGEST_FAILED' }),
    );
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 0,
      updated: 0,
      failed: 1,
    });
  });

  it('skips finish when the job carries no runId (ingest still runs)', async () => {
    const { processor, runs, ingest } = makeProcessor();
    await (processor as any).handle(job({ runId: undefined }));
    expect(ingest.ingest).toHaveBeenCalledTimes(1);
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it('refuses with flags off (G-4): no ingest, no finish', async () => {
    process.env.store_order_sync_enabled = 'false';
    const { processor, runs, ingest } = makeProcessor();
    const out = await (processor as any).handle(job());
    expect(out).toEqual({ refused: true });
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(runs.finish).not.toHaveBeenCalled();
  });

  // ND-1: the missing-payload early return used to recordItem SKIPPED and
  // return without finishing the run, stranding a RUNNING row. Both
  // malformed shapes that reach it through real signed webhooks (a
  // JSON-null body, and a non-JSON text/plain body) flow through this
  // same early return, so one test covers both.
  it('finishes the run as FAILED on a missing payload (no storeId/rawOrder)', async () => {
    const { processor, runs, ingest } = makeProcessor();
    const out = await (processor as any).handle(job({ rawOrder: undefined }));
    expect(out).toEqual({ ignored: 'missing-payload' });
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(runs.recordItem).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ objectType: 'ORDER', status: 'SKIPPED', reason: 'ORDER_INGEST_MISSING_PAYLOAD' }),
    );
    expect(runs.finish).toHaveBeenCalledTimes(1);
    expect(runs.finish).toHaveBeenCalledWith('run-1', {
      created: 0,
      updated: 0,
      failed: 1,
    });
  });

  it('does not finish when the missing-payload job carries no runId', async () => {
    const { processor, runs } = makeProcessor();
    const out = await (processor as any).handle(job({ runId: undefined, rawOrder: undefined }));
    expect(out).toEqual({ ignored: 'missing-payload' });
    expect(runs.recordItem).not.toHaveBeenCalled();
    expect(runs.finish).not.toHaveBeenCalled();
  });
});
