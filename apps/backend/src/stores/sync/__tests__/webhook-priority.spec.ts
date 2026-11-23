/**
 * Phase 9 G-14 — BullMQ priorities on the ingest/reconcile queues
 * (ported from jannat J-04). Lower number = processed sooner:
 * manual-retry (1) jumps the queue, live webhooks (5) run next,
 * reconciliation (10) yields to both.
 *
 * Coverage:
 *  - the WEBHOOK_PRIORITY contract itself;
 *  - the queue defaults in stores.module.ts (ingest = 5 with the
 *    G-12 retry ladder, reconcile = 10);
 *  - SyncQueuesService passes an explicit priority through to
 *    BullMQ and omits it otherwise (queue default applies);
 *  - the manual-replay enqueue site passes priority 1, and the
 *    reconcile enqueue sites pass priority 10.
 *
 * The ordering itself is BullMQ's (prioritized set, lowest score
 * first); what this suite proves is that every enqueue site for
 * these queues carries the right priority — a job with NO priority
 * (0) would land on the plain wait list, which BullMQ drains BEFORE
 * the prioritized set.
 */
import { INGEST_QUEUE_DEFAULTS, RECONCILE_QUEUE_DEFAULTS } from '../../stores.module';
import { WEBHOOK_PRIORITY, priorityForTrigger } from '../webhook-priority';
import { SyncQueuesService } from '../sync-queues.service';
import { WebhookFailuresService } from '../../webhooks/webhook-failures.service';
import { StoreOrderReconcileService } from '../../orders/store-order-reconcile.service';

describe('WEBHOOK_PRIORITY contract (G-14)', () => {
  it('is { manual-retry: 1, webhook: 5, reconciliation: 10 }', () => {
    expect(WEBHOOK_PRIORITY).toEqual({
      'manual-retry': 1,
      webhook: 5,
      reconciliation: 10,
    });
  });

  it('orders manual retries ahead of live webhooks ahead of reconciliation', () => {
    expect(WEBHOOK_PRIORITY['manual-retry']).toBeLessThan(WEBHOOK_PRIORITY.webhook);
    expect(WEBHOOK_PRIORITY.webhook).toBeLessThan(WEBHOOK_PRIORITY.reconciliation);
  });

  it('priorityForTrigger resolves every trigger', () => {
    expect(priorityForTrigger('manual-retry')).toBe(1);
    expect(priorityForTrigger('webhook')).toBe(5);
    expect(priorityForTrigger('reconciliation')).toBe(10);
  });
});

describe('queue defaults (stores.module.ts)', () => {
  it('ingest defaults to priority 5 with the G-12 retry ladder', () => {
    expect(INGEST_QUEUE_DEFAULTS.priority).toBe(WEBHOOK_PRIORITY.webhook);
    expect(INGEST_QUEUE_DEFAULTS.attempts).toBe(3);
    expect(INGEST_QUEUE_DEFAULTS.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('reconcile defaults to priority 10', () => {
    expect(RECONCILE_QUEUE_DEFAULTS.priority).toBe(WEBHOOK_PRIORITY.reconciliation);
    expect(RECONCILE_QUEUE_DEFAULTS.attempts).toBe(1);
  });
});

describe('SyncQueuesService priority passthrough (G-14)', () => {
  function svcWithQueues(queues: Record<string, any>) {
    const svc = Object.create(SyncQueuesService.prototype) as any;
    svc.queueFor = (name: string) => queues[name];
    svc.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    return svc as SyncQueuesService;
  }

  it('passes an explicit priority to queue.add', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const svc = svcWithQueues({ 'store-order-ingest': { add } });
    await svc.enqueueOrThrow(
      'store-order-ingest',
      'webhook-order-retry',
      { runId: 'run-1', storeId: 'store-1' },
      'webhook-retry:dk-1',
      { priority: WEBHOOK_PRIORITY['manual-retry'] },
    );
    expect(add).toHaveBeenCalledWith(
      'webhook-order-retry',
      expect.objectContaining({ runId: 'run-1', storeId: 'store-1' }),
      expect.objectContaining({ priority: 1, jobId: 'webhook-retry-dk-1' }),
    );
  });

  it('omits priority when none is given (queue default applies)', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-2' });
    const svc = svcWithQueues({ 'store-order-ingest': { add } });
    await svc.enqueueOrThrow(
      'store-order-ingest',
      'webhook-order',
      { runId: 'run-2', storeId: 'store-1' },
      'webhook:dk-2',
    );
    const opts = add.mock.calls[0][2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('priority');
    expect(opts).toMatchObject({ jobId: 'webhook-dk-2' });
  });

  it('passes priority through the swallowing enqueue() variant too', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-3' });
    const svc = svcWithQueues({ 'store-reconcile': { add } });
    await svc.enqueue(
      'store-reconcile',
      'order-reconcile',
      { runId: 'run-3', storeId: 'store-1' },
      'order-reconcile:store-1:run-3',
      { priority: WEBHOOK_PRIORITY.reconciliation },
    );
    expect(add).toHaveBeenCalledWith(
      'order-reconcile',
      expect.any(Object),
      expect.objectContaining({ priority: 10 }),
    );
  });
});

describe('manual replay enqueues at priority 1 (G-14)', () => {
  it('replay passes WEBHOOK_PRIORITY["manual-retry"] to enqueueOrThrow', async () => {
    const row = {
      id: 'failure-1',
      storeId: 'store-1',
      deliveryKey: 'dk-1',
      status: 'OPEN',
      reason: 'ENQUEUE_FAILED',
      payload: { externalOrderId: '4821' },
      firstSeenAt: new Date(),
    };
    const prisma = {
      storeWebhookFailure: { findUnique: jest.fn().mockResolvedValue(row) },
    } as any;
    const runs = {
      begin: jest.fn().mockResolvedValue({ id: 'run-9' }),
      finish: jest.fn(),
    } as any;
    const enqueueOrThrow = jest.fn().mockResolvedValue({ id: 'job-9' });
    const queues = { enqueueOrThrow } as any;
    const svc = new WebhookFailuresService(prisma, runs, queues);

    const res = await svc.replay('failure-1', 'store-1', 'actor-1');
    expect(res).toEqual({ replayed: true, runId: 'run-9', jobId: 'webhook-retry:dk-1' });
    expect(enqueueOrThrow).toHaveBeenCalledWith(
      'store-order-ingest',
      'webhook-order-retry',
      expect.objectContaining({ runId: 'run-9', storeId: 'store-1', replayFailureId: 'failure-1' }),
      'webhook-retry:dk-1',
      { priority: 1 },
    );
  });
});

describe('reconcile enqueue sites pass priority 10 (G-14)', () => {
  const OLD_FLAGS = {
    master: process.env.THIRD_PARTY_STORES_ENABLED,
    sync: process.env.store_sync_enabled,
    reconcile: process.env.store_reconcile_enabled,
  };

  beforeEach(() => {
    process.env.THIRD_PARTY_STORES_ENABLED = 'true';
    process.env.store_sync_enabled = 'true';
    process.env.store_reconcile_enabled = 'true';
  });

  afterEach(() => {
    if (OLD_FLAGS.master === undefined) delete process.env.THIRD_PARTY_STORES_ENABLED;
    else process.env.THIRD_PARTY_STORES_ENABLED = OLD_FLAGS.master;
    if (OLD_FLAGS.sync === undefined) delete process.env.store_sync_enabled;
    else process.env.store_sync_enabled = OLD_FLAGS.sync;
    if (OLD_FLAGS.reconcile === undefined) delete process.env.store_reconcile_enabled;
    else process.env.store_reconcile_enabled = OLD_FLAGS.reconcile;
  });

  it('tickHourly enqueues each store at priority 10', async () => {
    const prisma = {
      store: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'store-1', kind: 'WOOCOMMERCE' },
          { id: 'store-2', kind: 'NATIVE' },
          { id: 'store-3', kind: 'SHOPIFY' },
        ]),
      },
    } as any;
    const runs = {
      begin: jest.fn().mockResolvedValueOnce({ id: 'run-a' }).mockResolvedValueOnce({ id: 'run-b' }),
    } as any;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const queues = { enqueue } as any;
    const svc = new StoreOrderReconcileService(prisma, runs, queues, {} as any, {} as any);

    const res = await svc.tickHourly();
    expect(res.enqueued).toEqual(['run-a', 'run-b']);
    expect(res.excludedNativeCount).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
    for (const call of enqueue.mock.calls) {
      expect(call[0]).toBe('store-reconcile');
      expect(call[4]).toEqual({ priority: 10 });
    }
  });
});
