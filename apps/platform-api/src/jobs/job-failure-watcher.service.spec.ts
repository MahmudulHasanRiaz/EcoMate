import { JobFailureWatcherService } from './job-failure-watcher.service';

function jobsServiceWith(
  jobs: Array<{
    name: string;
    lastRunAt: string | null;
    lastResult: { errors: string[] } | null;
    lastError: string | null;
  }>,
) {
  return {
    status: () => ({ jobs }),
  } as any;
}

describe('JobFailureWatcherService', () => {
  it('alerts once per failing run (not on every poll)', async () => {
    const jobs = jobsServiceWith([
      {
        name: 'reminders',
        lastRunAt: '2026-11-17T00:00:00.000Z',
        lastResult: { errors: ['SMTP down'] },
        lastError: 'SMTP down',
      },
      {
        name: 'trial-expiry',
        lastRunAt: '2026-11-17T00:00:00.000Z',
        lastResult: { errors: [] },
        lastError: null,
      },
    ]);
    const alerts = {
      sendAlert: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const metrics = { recordBillingJobRun: jest.fn() } as any;
    const watcher = new JobFailureWatcherService(jobs, alerts, metrics);

    const first = await watcher.check();
    expect(first).toEqual(['reminders']);
    expect(alerts.sendAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'billing-job-failure',
        subject: 'Billing job reminders failed',
      }),
    );
    // Same run polled again: no second alert, no double metric.
    const second = await watcher.check();
    expect(second).toEqual([]);
    expect(alerts.sendAlert).toHaveBeenCalledTimes(1);
    expect(metrics.recordBillingJobRun).toHaveBeenCalledTimes(2);
    expect(metrics.recordBillingJobRun).toHaveBeenCalledWith(
      'reminders',
      new Date('2026-11-17T00:00:00.000Z'),
      true,
    );
    expect(metrics.recordBillingJobRun).toHaveBeenCalledWith(
      'trial-expiry',
      new Date('2026-11-17T00:00:00.000Z'),
      false,
    );
  });

  it('alerts again when a NEW failing run appears', async () => {
    let jobs = jobsServiceWith([
      {
        name: 'reminders',
        lastRunAt: '2026-11-17T00:00:00.000Z',
        lastResult: { errors: ['SMTP down'] },
        lastError: 'SMTP down',
      },
    ]);
    const alerts = {
      sendAlert: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const watcher = new JobFailureWatcherService(jobs, alerts);
    await watcher.check();
    jobs = jobsServiceWith([
      {
        name: 'reminders',
        lastRunAt: '2026-11-17T01:00:00.000Z',
        lastResult: { errors: ['SMTP still down'] },
        lastError: 'SMTP still down',
      },
    ]);
    (watcher as any).jobs = jobs;
    const alerted = await watcher.check();
    expect(alerted).toEqual(['reminders']);
    expect(alerts.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('is quiet when nothing has ever run', async () => {
    const jobs = jobsServiceWith([
      { name: 'reminders', lastRunAt: null, lastResult: null, lastError: null },
    ]);
    const alerts = { sendAlert: jest.fn() } as any;
    const watcher = new JobFailureWatcherService(jobs, alerts);
    await expect(watcher.check()).resolves.toEqual([]);
    expect(alerts.sendAlert).not.toHaveBeenCalled();
  });

  it('treats lastError alone (no lastResult) as a failure', async () => {
    const jobs = jobsServiceWith([
      {
        name: 'grace-suspend',
        lastRunAt: '2026-11-17T00:00:00.000Z',
        lastResult: null,
        lastError: 'DB timeout',
      },
    ]);
    const alerts = {
      sendAlert: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const watcher = new JobFailureWatcherService(jobs, alerts);
    await expect(watcher.check()).resolves.toEqual(['grace-suspend']);
  });
});
