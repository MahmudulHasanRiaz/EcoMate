/**
 * Webhook failure lifecycle — Phase 9 webhook fix (G-12, G-16; J-05, J-11).
 *
 * (f) failed delivery recorded + replay re-enqueues + resolves (verified
 * resolution — the row flips only when the order mapping exists).
 * Plus: record upsert semantics (delivery-keyed + day-bucket), the
 * sanitize allowlist (J-11), list pagination, ignore, and every replay
 * guard (404 / 409 / 503).
 *
 * Service-level with mocked Prisma/runs/queues; the processor half of
 * replay lives in `sync/__tests__/order-ingest-processor-replay.spec.ts`.
 */
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  buildReplayJobId,
  sanitizeFailurePayload,
  WebhookFailuresService,
} from '../webhook-failures.service';

const STORE_ID = 'store-fail-1';
const FAILURE_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERY_KEY = 'a'.repeat(64);

function failureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FAILURE_ID,
    tenantId: 'tenant-fail-1',
    storeId: STORE_ID,
    deliveryKey: DELIVERY_KEY,
    topic: 'order.created',
    reason: 'ENQUEUE_FAILED',
    status: 'OPEN',
    payload: { externalOrderId: 'ext-f1', status: 'processing', total: 250, itemCount: 1 },
    occurrences: 1,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    resolvedAt: null,
    ...overrides,
  };
}

function buildService(opts: {
  findUniqueImpl?: jest.Mock;
  findFirstImpl?: jest.Mock;
  createImpl?: jest.Mock;
  updateImpl?: jest.Mock;
  updateManyImpl?: jest.Mock;
  countImpl?: jest.Mock;
  findManyImpl?: jest.Mock;
  mappingImpl?: jest.Mock;
  enqueueOrThrowImpl?: jest.Mock;
} = {}) {
  const prisma: any = {
    storeWebhookFailure: {
      findUnique: opts.findUniqueImpl ?? jest.fn().mockResolvedValue(null),
      findFirst: opts.findFirstImpl ?? jest.fn().mockResolvedValue(null),
      create: opts.createImpl ?? jest.fn().mockImplementation(async ({ data }: any) => ({ id: FAILURE_ID, ...data })),
      update: opts.updateImpl ?? jest.fn().mockResolvedValue({}),
      updateMany: opts.updateManyImpl ?? jest.fn().mockResolvedValue({ count: 1 }),
      count: opts.countImpl ?? jest.fn().mockResolvedValue(0),
      findMany: opts.findManyImpl ?? jest.fn().mockResolvedValue([]),
    },
    storeOrderMapping: {
      findUnique: opts.mappingImpl ?? jest.fn().mockResolvedValue(null),
    },
  };
  const runs: any = {
    begin: jest.fn().mockResolvedValue({ id: 'run-fail-1' }),
    finish: jest.fn().mockResolvedValue({}),
  };
  const queues: any = {
    enqueueOrThrow: opts.enqueueOrThrowImpl ?? jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const svc = new WebhookFailuresService(prisma, runs, queues);
  return { svc, prisma, runs, queues };
}

describe('sanitizeFailurePayload (J-11 allowlist)', () => {
  it('keeps order identity + totals only; drops PII, secrets, meta, headers', () => {
    const out = sanitizeFailurePayload({
      id: 'ext-s1',
      status: 'processing',
      total: 250,
      currency: 'BDT',
      line_items: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 2 }],
      customer: { name: 'Sara', phone: '01700000001', email: 'sara@example.com' },
      billing: { address_1: 'House 1', phone: '01700000001' },
      meta_data: [{ key: 'secret', value: 'sk_live_x' }],
      _headers: { 'x-wc-webhook-signature': 'sig' },
    });
    expect(out).toEqual({
      externalOrderId: 'ext-s1',
      status: 'processing',
      total: 250,
      currency: 'BDT',
      itemCount: 2,
    });
  });

  it('returns null for non-order-shaped input (never persists garbage)', () => {
    expect(sanitizeFailurePayload(null)).toBeNull();
    expect(sanitizeFailurePayload(undefined)).toBeNull();
    expect(sanitizeFailurePayload('raw body string')).toBeNull();
    expect(sanitizeFailurePayload([1, 2, 3])).toBeNull();
    expect(sanitizeFailurePayload(42)).toBeNull();
  });
});

describe('buildReplayJobId', () => {
  it('builds a distinct retry job id (never collides with the live webhook id)', () => {
    expect(buildReplayJobId(DELIVERY_KEY)).toBe(`webhook-retry:${DELIVERY_KEY}`);
    expect(buildReplayJobId(DELIVERY_KEY)).not.toBe(`webhook:${DELIVERY_KEY}`);
  });
});

describe('recordFailure', () => {
  it('delivery-keyed: creates a new row on first sight', async () => {
    const { svc, prisma } = buildService();
    await svc.recordFailure({
      storeId: STORE_ID,
      deliveryKey: DELIVERY_KEY,
      topic: 'order.created',
      reason: 'INGEST_FAILED',
      payload: { externalOrderId: 'ext-f1' },
    });
    expect(prisma.storeWebhookFailure.findUnique).toHaveBeenCalledWith({
      where: { deliveryKey: DELIVERY_KEY },
    });
    expect(prisma.storeWebhookFailure.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: STORE_ID,
        deliveryKey: DELIVERY_KEY,
        topic: 'order.created',
        reason: 'INGEST_FAILED',
        payload: { externalOrderId: 'ext-f1' },
      }),
    });
  });

  it('delivery-keyed repeat: bumps occurrences and RE-OPENS a resolved row', async () => {
    const existing = failureRow({ status: 'RESOLVED', resolvedAt: new Date(), occurrences: 2 });
    const { svc, prisma } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(existing),
    });
    await svc.recordFailure({
      storeId: STORE_ID,
      deliveryKey: DELIVERY_KEY,
      reason: 'INGEST_FAILED',
    });
    expect(prisma.storeWebhookFailure.create).not.toHaveBeenCalled();
    expect(prisma.storeWebhookFailure.update).toHaveBeenCalledWith({
      where: { deliveryKey: DELIVERY_KEY },
      data: expect.objectContaining({
        occurrences: { increment: 1 },
        status: 'OPEN',
        resolvedAt: null,
      }),
    });
  });

  it('delivery-keyed P2002 race: the loser bumps instead of erroring', async () => {
    const p2002: any = new Error('Unique constraint failed');
    p2002.code = 'P2002';
    const { svc, prisma } = buildService({
      createImpl: jest.fn().mockRejectedValueOnce(p2002),
    });
    prisma.storeWebhookFailure.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failureRow({ occurrences: 2 }));
    const out = await svc.recordFailure({
      storeId: STORE_ID,
      deliveryKey: DELIVERY_KEY,
      reason: 'INGEST_FAILED',
    });
    expect(prisma.storeWebhookFailure.updateMany).toHaveBeenCalledWith({
      where: { deliveryKey: DELIVERY_KEY },
      data: expect.objectContaining({ occurrences: { increment: 1 }, status: 'OPEN' }),
    });
    expect((out as any).occurrences).toBe(2);
  });

  it('keyless: buckets by (store, reason, UTC day) — repeat bumps the same row', async () => {
    const bucket = failureRow({ deliveryKey: null, occurrences: 3 });
    const { svc, prisma } = buildService({
      findFirstImpl: jest.fn().mockResolvedValue(bucket),
    });
    await svc.recordFailure({ storeId: STORE_ID, reason: 'SIGNATURE_MISMATCH' });
    expect(prisma.storeWebhookFailure.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: STORE_ID,
          reason: 'SIGNATURE_MISMATCH',
          status: 'OPEN',
        }),
      }),
    );
    expect(prisma.storeWebhookFailure.update).toHaveBeenCalledWith({
      where: { id: bucket.id },
      data: expect.objectContaining({ occurrences: { increment: 1 } }),
    });
    expect(prisma.storeWebhookFailure.create).not.toHaveBeenCalled();
  });

  it('recordFailureSafe never throws (a lost row must not break intake/processor)', async () => {
    const { svc } = buildService({
      createImpl: jest.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(
      svc.recordFailureSafe({ storeId: STORE_ID, deliveryKey: DELIVERY_KEY, reason: 'INGEST_FAILED' }),
    ).resolves.toBeNull();
  });
});

describe('listFailures', () => {
  it('paginates newest-first with total + totalPages', async () => {
    const rows = [failureRow(), failureRow({ id: '22222222-2222-4222-8222-222222222222' })];
    const { svc, prisma } = buildService({
      countImpl: jest.fn().mockResolvedValue(45),
      findManyImpl: jest.fn().mockResolvedValue(rows),
    });
    const out = await svc.listFailures(STORE_ID, { page: 2, limit: 20, status: 'OPEN' });
    expect(out.meta).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    expect(out.data).toHaveLength(2);
    expect(prisma.storeWebhookFailure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: STORE_ID, status: 'OPEN' },
        orderBy: { lastSeenAt: 'desc' },
        skip: 20,
        take: 20,
      }),
    );
  });

  it('clamps page/limit and ignores an invalid status filter', async () => {
    const { svc, prisma } = buildService();
    const out = await svc.listFailures(STORE_ID, { page: 0, limit: 500, status: 'BOGUS' });
    expect(out.meta).toEqual({ page: 1, limit: 100, total: 0, totalPages: 1 });
    expect(prisma.storeWebhookFailure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: STORE_ID }, skip: 0, take: 100 }),
    );
  });
});

describe('replay (G-12)', () => {
  it('(f) replays an OPEN ENQUEUE_FAILED row: RETRY run + priority-1 retry job, row stays OPEN until verified', async () => {
    const row = failureRow();
    const { svc, prisma, runs, queues } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(row),
    });
    const out = await svc.replay(FAILURE_ID, STORE_ID, 'actor-1');
    expect(out).toEqual({
      replayed: true,
      runId: 'run-fail-1',
      jobId: `webhook-retry:${DELIVERY_KEY}`,
    });
    expect(runs.begin).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'ORDER_INGEST', triggerType: 'RETRY', storeId: STORE_ID, initiatedById: 'actor-1' }),
    );
    expect(queues.enqueueOrThrow).toHaveBeenCalledTimes(1);
    const [queue, jobName, data, jobId, opts] = queues.enqueueOrThrow.mock.calls[0];
    expect(queue).toBe('store-order-ingest');
    expect(jobName).toBe('webhook-order-retry');
    expect(jobId).toBe(`webhook-retry:${DELIVERY_KEY}`);
    expect(data).toMatchObject({
      runId: 'run-fail-1',
      storeId: STORE_ID,
      deliveryKey: DELIVERY_KEY,
      replayFailureId: FAILURE_ID,
      externalOrderId: 'ext-f1',
      replayWindowDays: 1,
    });
    // G-14: a manual replay jumps the queue (priority 1).
    expect(opts).toEqual({ priority: 1 });
    // Enqueueing is NOT success: the row is untouched until the
    // processor verifies the order exists (resolveReplay).
    expect(prisma.storeWebhookFailure.update).not.toHaveBeenCalled();
    expect(prisma.storeWebhookFailure.updateMany).not.toHaveBeenCalled();
  });

  it('replay window covers the failure age, clamped to the 30-day reconcile max', async () => {
    const old = failureRow({
      firstSeenAt: new Date(Date.now() - 40 * 86400000),
    });
    const { svc, queues } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(old),
    });
    await svc.replay(FAILURE_ID, STORE_ID);
    expect(queues.enqueueOrThrow.mock.calls[0][2]).toMatchObject({ replayWindowDays: 30 });
  });

  it('404 for an unknown row or a row belonging to another store', async () => {
    const { svc } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.replay(FAILURE_ID, STORE_ID)).rejects.toBeInstanceOf(NotFoundException);
    const other = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow({ storeId: 'store-other' })),
    });
    await expect(other.svc.replay(FAILURE_ID, STORE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 for a non-OPEN row (already RESOLVED / IGNORED)', async () => {
    const { svc } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow({ status: 'RESOLVED' })),
    });
    await expect(svc.replay(FAILURE_ID, STORE_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 for a non-replayable reason (no verified payload ever existed)', async () => {
    const { svc } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow({ reason: 'SIGNATURE_MISMATCH' })),
    });
    await expect(svc.replay(FAILURE_ID, STORE_ID)).rejects.toThrow(
      'Cannot replay a SIGNATURE_MISMATCH failure',
    );
  });

  it('409 when the row has no external order id to re-fetch', async () => {
    const { svc } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow({ payload: { total: 250 } })),
    });
    await expect(svc.replay(FAILURE_ID, STORE_ID)).rejects.toThrow(
      'Failure has no external order id to re-fetch',
    );
  });

  it('503 when the retry job cannot be enqueued — the run finishes FAILED, never a false success', async () => {
    const { svc, runs } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow()),
      enqueueOrThrowImpl: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    await expect(svc.replay(FAILURE_ID, STORE_ID)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(runs.finish).toHaveBeenCalledWith('run-fail-1', {
      created: 0,
      updated: 0,
      failed: 1,
    });
  });

  it('409 when the tenant plan no longer includes order sync (enqueue skipped)', async () => {
    const { svc, runs } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow()),
      enqueueOrThrowImpl: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.replay(FAILURE_ID, STORE_ID)).rejects.toThrow(
      'Tenant plan no longer includes order sync',
    );
    expect(runs.finish).toHaveBeenCalledWith('run-fail-1', {
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
  });
});

describe('resolveReplay / resolveByDeliveryKey', () => {
  it('(f) resolveReplay flips OPEN → RESOLVED only when the order mapping exists', async () => {
    const { svc, prisma } = buildService({
      mappingImpl: jest.fn().mockResolvedValue({ orderId: 'ord-1' }),
    });
    const ok = await svc.resolveReplay(FAILURE_ID, STORE_ID, 'ext-f1');
    expect(ok).toBe(true);
    expect(prisma.storeOrderMapping.findUnique).toHaveBeenCalledWith({
      where: { storeId_externalOrderId: { storeId: STORE_ID, externalOrderId: 'ext-f1' } },
    });
    expect(prisma.storeWebhookFailure.updateMany).toHaveBeenCalledWith({
      where: { id: FAILURE_ID, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date) },
    });
  });

  it('resolveReplay returns false (row stays OPEN) when the order is still missing', async () => {
    const { svc, prisma } = buildService({
      mappingImpl: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.resolveReplay(FAILURE_ID, STORE_ID, 'ext-f1')).resolves.toBe(false);
    expect(prisma.storeWebhookFailure.updateMany).not.toHaveBeenCalled();
  });

  it('resolveByDeliveryKey resolves OPEN rows for a delivery whose retry succeeded', async () => {
    const { svc, prisma } = buildService({
      updateManyImpl: jest.fn().mockResolvedValue({ count: 1 }),
    });
    await expect(svc.resolveByDeliveryKey(DELIVERY_KEY)).resolves.toBe(1);
    expect(prisma.storeWebhookFailure.updateMany).toHaveBeenCalledWith({
      where: { deliveryKey: DELIVERY_KEY, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date) },
    });
  });
});

describe('ignore', () => {
  it('OPEN → IGNORED; RESOLVED rows stay RESOLVED; unknown → 404', async () => {
    const { svc, prisma } = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow()),
    });
    await svc.ignore(FAILURE_ID, STORE_ID);
    expect(prisma.storeWebhookFailure.update).toHaveBeenCalledWith({
      where: { id: FAILURE_ID },
      data: { status: 'IGNORED', resolvedAt: expect.any(Date) },
    });

    const resolved = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(failureRow({ status: 'RESOLVED' })),
    });
    await expect(resolved.svc.ignore(FAILURE_ID, STORE_ID)).rejects.toBeInstanceOf(ConflictException);

    const missing = buildService({
      findUniqueImpl: jest.fn().mockResolvedValue(null),
    });
    await expect(missing.svc.ignore(FAILURE_ID, STORE_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
