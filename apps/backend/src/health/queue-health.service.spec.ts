import { Queue } from 'bullmq';
import { QueueHealthService } from './queue-health.service';

function fakeQueue(name: string, counts: { failed: number } | Error) {
  const queue = Object.create(Queue.prototype) as Queue;
  Object.defineProperty(queue, 'name', { value: name });
  queue.getJobCounts = jest.fn(
    counts instanceof Error
      ? () => Promise.reject(counts)
      : () => Promise.resolve(counts as any),
  );
  return queue;
}

describe('QueueHealthService', () => {
  function makeService(instances: unknown[]) {
    const discovery = {
      getProviders: jest.fn(() =>
        instances.map((instance) => ({ instance })),
      ),
    };
    return new QueueHealthService(discovery as any);
  }

  it('reports ok with per-queue failed counts', async () => {
    const service = makeService([
      fakeQueue('email', { failed: 2 }),
      fakeQueue('backup', { failed: 0 }),
      { notAQueue: true },
      undefined,
    ]);
    const result = await service.check();
    expect(result.ok).toBe(true);
    expect(result.queues).toEqual([
      { name: 'email', ok: true, failed: 2 },
      { name: 'backup', ok: true, failed: 0 },
    ]);
  });

  it('fails when a queue errors', async () => {
    const service = makeService([
      fakeQueue('email', { failed: 0 }),
      fakeQueue('media', new Error('ECONNREFUSED')),
    ]);
    const result = await service.check();
    expect(result.ok).toBe(false);
    expect(result.queues).toEqual([
      { name: 'email', ok: true, failed: 0 },
      { name: 'media', ok: false, failed: 0 },
    ]);
  });

  it('reports ok with no queues when nothing is discovered', async () => {
    const service = makeService([]);
    const result = await service.check();
    expect(result).toEqual({ ok: true, queues: [] });
  });

  it('survives a discovery failure', async () => {
    const discovery = {
      getProviders: jest.fn(() => {
        throw new Error('boom');
      }),
    };
    const service = new QueueHealthService(discovery as any);
    const result = await service.check();
    expect(result).toEqual({ ok: true, queues: [] });
  });
});
