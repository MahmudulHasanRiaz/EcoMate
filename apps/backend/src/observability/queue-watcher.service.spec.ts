import { QueueWatcherService } from './queue-watcher.service';

function fakeModuleRef(
  queues: Record<string, Record<string, number> | Error>,
) {
  return {
    get: (token: string) => {
      const name = String(token).replace('BullQueue_', '');
      const entry = queues[name];
      if (entry === undefined) throw new Error(`No provider for ${token}`);
      return {
        getJobCounts: jest.fn().mockImplementation(async () => {
          if (entry instanceof Error) throw entry;
          return entry;
        }),
      };
    },
  } as any;
}

const IDLE = { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };

describe('QueueWatcherService', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns counts and pushes them to metrics', async () => {
    const moduleRef = fakeModuleRef({
      email: { ...IDLE, waiting: 5, completed: 10 },
    });
    const metrics = { setQueueCounts: jest.fn() };
    const watcher = new QueueWatcherService(moduleRef, undefined, metrics as any);
    const result = await watcher.check();
    expect(result.get('email')).toEqual({ ...IDLE, waiting: 5, completed: 10 });
    expect(metrics.setQueueCounts).toHaveBeenCalledWith('email', {
      ...IDLE,
      waiting: 5,
      completed: 10,
    });
  });

  it('alerts when waiting+delayed depth passes the threshold', async () => {
    process.env.QUEUE_DEPTH_ALERT_THRESHOLD = '10';
    const moduleRef = fakeModuleRef({
      email: { ...IDLE, waiting: 8, delayed: 5 },
    });
    const alerts = { sendAlert: jest.fn().mockResolvedValue({ sent: true }) };
    const watcher = new QueueWatcherService(moduleRef, alerts as any);
    await watcher.check();
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'queue-depth',
        subject: expect.stringContaining('email'),
      }),
    );
  });

  it('does not alert at or below the threshold', async () => {
    process.env.QUEUE_DEPTH_ALERT_THRESHOLD = '10';
    const moduleRef = fakeModuleRef({
      email: { ...IDLE, waiting: 6, delayed: 4 },
    });
    const alerts = { sendAlert: jest.fn() };
    const watcher = new QueueWatcherService(moduleRef, alerts as any);
    await watcher.check();
    expect(alerts.sendAlert).not.toHaveBeenCalled();
  });

  it('alerts only when the failed count INCREASES (not on first sight)', async () => {
    const counts = { ...IDLE, failed: 3 };
    const moduleRef = fakeModuleRef({ email: counts });
    const alerts = { sendAlert: jest.fn().mockResolvedValue({ sent: true }) };
    const watcher = new QueueWatcherService(moduleRef, alerts as any);
    // First sight of failed=3: baseline, no alert.
    await watcher.check();
    expect(alerts.sendAlert).not.toHaveBeenCalled();
    // Same count on the next tick: still quiet.
    await watcher.check();
    expect(alerts.sendAlert).not.toHaveBeenCalled();
    // Count rose 3 -> 5: alert with the delta.
    counts.failed = 5;
    await watcher.check();
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'queue-failed-jobs',
        subject: expect.stringContaining('2 new failed'),
      }),
    );
  });

  it('alerts when a queue cannot be read (queue health)', async () => {
    const moduleRef = fakeModuleRef({
      email: new Error('Redis unavailable'),
    });
    const alerts = { sendAlert: jest.fn().mockResolvedValue({ sent: true }) };
    const watcher = new QueueWatcherService(moduleRef, alerts as any);
    const result = await watcher.check();
    expect(result.has('email')).toBe(false);
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'queue-health',
        subject: expect.stringContaining('email'),
      }),
    );
  });

  it('skips quietly when no queue resolves', async () => {
    const watcher = new QueueWatcherService(fakeModuleRef({}));
    const result = await watcher.check();
    expect(result.size).toBe(0);
  });
});
