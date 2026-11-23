/**
 * Phase 9 G-14 — per-tenant fairness at the worker (TenantWorkerHost).
 *
 * The ingest queue is shared across tenants: without a guard, one
 * tenant's burst fills every worker slot and starves the rest. The
 * worker enforces the per-tenant in-flight cap (default 2) — a job
 * over its tenant's cap is DELAYED (BullMQ `moveToDelayed` +
 * `DelayedError`), never failed: no attempt is consumed, its
 * priority is intact, and it re-enters ~1s later.
 *
 * The fairness limiter here runs on its in-memory fallback
 * (REDIS_URL points at a dead port before the singleton is built),
 * so these specs are deterministic without a server.
 */
import { DelayedError } from 'bullmq';
import { TenantWorkerHost } from './tenant-job';
import { __resetFairnessLimiterForTests } from './tenant-fairness';

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002';

class FairnessTestWorker extends TenantWorkerHost<{ tenantId: string; value: string }> {
  entered = 0;
  handled: string[] = [];

  constructor(private readonly gate: Promise<void>) {
    super();
  }

  protected async handle(job: any): Promise<unknown> {
    this.entered += 1;
    this.handled.push(job.id as string);
    await this.gate;
    return job.data.value;
  }
}

function ingestJob(id: string, tenantId: string, queueName = 'store-order-ingest') {
  return {
    name: 'webhook-order',
    id,
    queueName,
    timestamp: Date.now(),
    data: { tenantId, value: `done-${id}` },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  } as any;
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('TenantWorkerHost per-tenant fairness (G-14)', () => {
  const OLD_REDIS_URL = process.env.REDIS_URL;
  const OLD_CAP = process.env.STORE_INGEST_PER_TENANT_CONCURRENCY;

  beforeEach(() => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6399';
    delete process.env.STORE_INGEST_PER_TENANT_CONCURRENCY;
    __resetFairnessLimiterForTests();
  });

  afterEach(() => {
    __resetFairnessLimiterForTests();
    if (OLD_REDIS_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = OLD_REDIS_URL;
    if (OLD_CAP === undefined) delete process.env.STORE_INGEST_PER_TENANT_CONCURRENCY;
    else process.env.STORE_INGEST_PER_TENANT_CONCURRENCY = OLD_CAP;
  });

  it('holds the cap under a simulated burst: 2 run, the 3rd waits (never fails)', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    const worker = new FairnessTestWorker(gate);

    // Two jobs fill tenant A's cap and block inside handle().
    const p1 = worker.process(ingestJob('j1', TENANT_A));
    const p2 = worker.process(ingestJob('j2', TENANT_A));
    await waitFor(() => worker.entered === 2);

    // A third job for the same tenant is deferred, not failed.
    const job3 = ingestJob('j3', TENANT_A);
    const before = Date.now();
    await expect(worker.process(job3)).rejects.toThrow(DelayedError);
    const after = Date.now();
    expect(worker.handled).not.toContain('j3');
    // moveToDelayed ~1s out (1000ms base + up to 500ms jitter).
    expect(job3.moveToDelayed).toHaveBeenCalledTimes(1);
    const delayedUntil = job3.moveToDelayed.mock.calls[0][0] as number;
    expect(delayedUntil).toBeGreaterThanOrEqual(before + 1000);
    expect(delayedUntil).toBeLessThanOrEqual(after + 1500);

    // Another tenant is unaffected while A is at cap (admitted
    // immediately — it blocks on the same gate, so don't await it).
    const pB = worker.process(ingestJob('j-b1', TENANT_B));
    await waitFor(() => worker.entered === 3);
    expect(worker.handled).toContain('j-b1');

    // Once A's jobs finish, the deferred job runs fine.
    releaseGate();
    await expect(p1).resolves.toBe('done-j1');
    await expect(p2).resolves.toBe('done-j2');
    await expect(pB).resolves.toBe('done-j-b1');
    await expect(worker.process(ingestJob('j3-retry', TENANT_A))).resolves.toBe('done-j3-retry');
  });

  it('does not gate non-ingest queues', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    const worker = new FairnessTestWorker(gate);
    const runs = Array.from({ length: 5 }, (_, i) =>
      worker.process(ingestJob(`r${i}`, TENANT_A, 'store-reconcile')),
    );
    await waitFor(() => worker.entered === 5);
    releaseGate();
    await expect(Promise.all(runs)).resolves.toHaveLength(5);
  });

  it('disables the cap when STORE_INGEST_PER_TENANT_CONCURRENCY=0', async () => {
    process.env.STORE_INGEST_PER_TENANT_CONCURRENCY = '0';
    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => {
      releaseGate = r;
    });
    const worker = new FairnessTestWorker(gate);
    const runs = Array.from({ length: 5 }, (_, i) =>
      worker.process(ingestJob(`u${i}`, TENANT_A)),
    );
    await waitFor(() => worker.entered === 5);
    releaseGate();
    await expect(Promise.all(runs)).resolves.toHaveLength(5);
  });

  it('releases the slot when the job throws (no cap leak)', async () => {
    class FailingWorker extends TenantWorkerHost<{ tenantId: string; value: string }> {
      protected async handle(): Promise<unknown> {
        throw new Error('boom');
      }
    }
    const worker = new FailingWorker();
    await expect(worker.process(ingestJob('f1', TENANT_A))).rejects.toThrow('boom');
    await expect(worker.process(ingestJob('f2', TENANT_A))).rejects.toThrow('boom');
    // Both slots were released by the finally — a third job is
    // admitted (and throws on its own merit, not deferred).
    await expect(worker.process(ingestJob('f3', TENANT_A))).rejects.toThrow('boom');
  });
});
