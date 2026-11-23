/**
 * replaceFinishedJob: BullMQ dedupes by job id while ANY record exists, so a
 * second stock change for the same product would be swallowed by the first
 * job's completed record. Finished records are cleared first; pending jobs
 * are left alone (they re-read live state, so coalescing stays safe).
 */
import { SyncQueuesService } from '../sync-queues.service';

function stockQueue(getJob: jest.Mock) {
  return { getJob };
}

function svc(stockQ: any) {
  const q = (name: string) => {
    if (name === 'store-stock-sync') return stockQ;
    throw new Error(`unexpected queue ${name}`);
  };
  const svc = Object.create(SyncQueuesService.prototype) as any;
  svc.queueFor = q;
  svc.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  return svc as SyncQueuesService;
}

/**
 * enqueueOrThrow (G-11) + enqueue swallow-and-log preservation.
 *
 * Intake + replay must KNOW whether the job queued (a lost delivery is
 * a 503, never a false 200); every other caller relies on `enqueue`
 * never throwing (R-2 — post-commit notifies). The two variants share
 * one internal path; only the error propagation differs.
 */
describe('SyncQueuesService.enqueueOrThrow / enqueue (G-11)', () => {
  function queueSvc(opts: {
    addImpl?: jest.Mock;
    canUse?: boolean;
  } = {}) {
    const add = opts.addImpl ?? jest.fn().mockResolvedValue({ id: 'job-1' });
    const queue = { add };
    const s = Object.create(SyncQueuesService.prototype) as any;
    s.queueFor = () => queue;
    s.logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    // Entitlements wired only when the test stages a value (undefined =
    // no check, like the legacy manual constructions).
    if (opts.canUse !== undefined) {
      s.entitlements = { canUse: jest.fn().mockReturnValue(opts.canUse) };
    }
    return { svc: s as SyncQueuesService, queue, add };
  }

  it('enqueueOrThrow returns the job, stamps the tenant, and sanitizes the job id', async () => {
    const { svc, add } = queueSvc();
    const out = await svc.enqueueOrThrow(
      'store-order-ingest',
      'webhook-order',
      { runId: 'run-1', storeId: 's1' },
      'webhook:abc123',
    );
    expect(out).toEqual({ id: 'job-1' });
    expect(add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = add.mock.calls[0];
    expect(jobName).toBe('webhook-order');
    // BullMQ ids cannot contain ':' — sanitized, uniqueness kept.
    expect(opts.jobId).toBe('webhook-abc123');
    // Tenant stamp (test env falls back to the zero tenant id).
    expect(payload).toMatchObject({
      runId: 'run-1',
      storeId: 's1',
      tenantId: '00000000-0000-4000-8000-000000000000',
    });
    expect(opts).toMatchObject({ removeOnComplete: 100, removeOnFail: 50 });
  });

  it('enqueueOrThrow passes an explicit priority through (manual replay jumps the queue)', async () => {
    const { svc, add } = queueSvc();
    await svc.enqueueOrThrow(
      'store-order-ingest',
      'webhook-order-retry',
      { runId: 'run-1' },
      'webhook-retry:abc',
      { priority: 1 },
    );
    expect(add.mock.calls[0][2]).toMatchObject({ priority: 1, jobId: 'webhook-retry-abc' });
  });

  it('enqueueOrThrow PROPAGATES a queue failure (the caller surfaces it as 503)', async () => {
    const { svc } = queueSvc({
      addImpl: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    await expect(
      svc.enqueueOrThrow('store-order-ingest', 'webhook-order', { runId: 'run-1' }, 'webhook:x'),
    ).rejects.toThrow('redis down');
  });

  it('enqueueOrThrow returns null (no add) when the tenant entitlement check fails', async () => {
    const { svc, add } = queueSvc({ canUse: false });
    const out = await svc.enqueueOrThrow(
      'store-order-ingest',
      'webhook-order',
      { runId: 'run-1' },
      'webhook:x',
    );
    expect(out).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueue still swallows a queue failure (other callers are unaffected — R-2)', async () => {
    const { svc, add } = queueSvc({
      addImpl: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    await expect(
      svc.enqueue('store-order-ingest', 'webhook-order', { runId: 'run-1' }, 'webhook:x'),
    ).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledTimes(1);
    expect((svc as any).logger.error).toHaveBeenCalledTimes(1);
  });

  it('enqueue still returns null-equivalent (void) on entitlement skip, without throwing', async () => {
    const { svc, add } = queueSvc({ canUse: false });
    await expect(
      svc.enqueue('store-order-ingest', 'webhook-order', { runId: 'run-1' }, 'webhook:x'),
    ).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });
});

describe('SyncQueuesService.replaceFinishedJob', () => {
  it('removes completed and failed records, keeps pending ones', async () => {
    const completed = { remove: jest.fn(async () => undefined), isCompleted: jest.fn(async () => true), isFailed: jest.fn(async () => false) };
    const s1 = svc(stockQueue(jest.fn(async () => completed)));
    await s1.replaceFinishedJob('store-stock-sync', 'stock:s:p:-');
    expect(completed.remove).toHaveBeenCalledTimes(1);

    const failed = { remove: jest.fn(async () => undefined), isCompleted: jest.fn(async () => false), isFailed: jest.fn(async () => true) };
    const s2 = svc(stockQueue(jest.fn(async () => failed)));
    await s2.replaceFinishedJob('store-stock-sync', 'stock:s:p:-');
    expect(failed.remove).toHaveBeenCalledTimes(1);

    const pending = { remove: jest.fn(async () => undefined), isCompleted: jest.fn(async () => false), isFailed: jest.fn(async () => false) };
    const s3 = svc(stockQueue(jest.fn(async () => pending)));
    await s3.replaceFinishedJob('store-stock-sync', 'stock:s:p:-');
    expect(pending.remove).not.toHaveBeenCalled();
  });

  it('tolerates missing jobs and queue errors (best-effort, never throws)', async () => {
    const s1 = svc(stockQueue(jest.fn(async () => null)));
    await expect(s1.replaceFinishedJob('store-stock-sync', 'x')).resolves.toBeUndefined();
    const s2 = svc(stockQueue(jest.fn(async () => { throw new Error('redis down'); })));
    await expect(s2.replaceFinishedJob('store-stock-sync', 'x')).resolves.toBeUndefined();
  });
});
