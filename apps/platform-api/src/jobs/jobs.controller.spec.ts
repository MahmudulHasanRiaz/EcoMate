import { NotFoundException } from '@nestjs/common';
import { JobsController } from './jobs.controller';

const jobs = {
  status: jest.fn(),
  runJob: jest.fn(),
  runAll: jest.fn(),
};
const tlsHealth = {
  status: jest.fn(),
  runProbe: jest.fn(),
};
const audit = { record: jest.fn() };

const controller = new JobsController(
  jobs as any,
  tlsHealth as any,
  audit as any,
);

describe('JobsController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audit.record.mockResolvedValue(undefined);
  });

  it('audits an operator-triggered single job run with its result', async () => {
    jobs.runJob.mockResolvedValue({
      job: 'trial-expiry',
      ranAt: '2026-11-17T00:00:00.000Z',
      counts: { trialsExpired: 2 },
      errors: [],
    });

    const result = await controller.run('trial-expiry', { id: 'user-1' });

    expect(result.counts.trialsExpired).toBe(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'jobs.run',
        entity: 'Job',
        entityId: 'trial-expiry',
        after: { counts: { trialsExpired: 2 }, errors: [] },
      }),
    );
  });

  it('audits a run-all with every job result', async () => {
    jobs.runAll.mockResolvedValue([
      {
        job: 'trial-expiry',
        ranAt: '2026-11-17T00:00:00.000Z',
        counts: { trialsExpired: 0 },
        errors: [],
      },
      {
        job: 'reminders',
        ranAt: '2026-11-17T00:00:00.000Z',
        counts: { remindersSent: 1 },
        errors: ['mail failed for one tenant'],
      },
    ]);

    await controller.runAll({ id: 'user-1' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'jobs.run-all',
        entityId: 'all',
        after: expect.objectContaining({
          results: [
            { job: 'trial-expiry', counts: { trialsExpired: 0 }, errors: [] },
            {
              job: 'reminders',
              counts: { remindersSent: 1 },
              errors: ['mail failed for one tenant'],
            },
          ],
        }),
      }),
    );
  });

  it('audits a TLS probe run with its summary', async () => {
    tlsHealth.runProbe.mockResolvedValue({
      ranAt: '2026-11-17T00:00:00.000Z',
      domainsChecked: 3,
      transitions: [{ host: 'a.ecomate.bd', from: 'OK', to: 'EXPIRING_SOON' }],
      alertsSent: 1,
      primaryProbed: true,
      primaryHealthy: true,
      errors: [],
    });

    await controller.runTlsProbe({ id: 'user-1' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'jobs.tls-health.run',
        entityId: 'tls-health',
        after: {
          domainsChecked: 3,
          transitions: 1,
          alertsSent: 1,
          primaryHealthy: true,
          errors: [],
        },
      }),
    );
  });

  it('rejects an unknown job name without auditing', async () => {
    await expect(controller.run('nope', { id: 'user-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(jobs.runJob).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
