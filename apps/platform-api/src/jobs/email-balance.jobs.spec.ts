import { BillingJobsService, JOB_NAMES } from './billing-jobs.service';

/**
 * Email-balance jobs only (email-balance-expiry + email-balance-reconcile).
 * Kept separate from billing-jobs.service.spec.ts — that file is shared
 * with the pricing worker.
 */
function buildService() {
  const emailBalance = {
    expireLots: jest.fn(async () => ({
      lotsExpired: 3,
      emailsExpired: 41,
      tenantsAffected: 2,
    })),
    warnExpiringLots: jest.fn(async () => ({ warningsSent: 5 })),
    reconcile: jest.fn(async () => ({ checked: 12, drifted: 1 })),
  };
  const service = new BillingJobsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    emailBalance as any,
  );
  return { service, emailBalance };
}

describe('BillingJobsService — email-balance jobs', () => {
  it('registers both email-balance jobs', () => {
    expect(JOB_NAMES).toContain('email-balance-expiry');
    expect(JOB_NAMES).toContain('email-balance-reconcile');
    const { service } = buildService();
    const names = service.status().jobs.map((j) => j.name);
    expect(names).toContain('email-balance-expiry');
    expect(names).toContain('email-balance-reconcile');
  });

  it('email-balance-expiry expires lots and warns, reporting counts', async () => {
    const { service, emailBalance } = buildService();
    const result = await service.runJob('email-balance-expiry');
    expect(result.errors).toEqual([]);
    expect(result.counts).toEqual({
      lotsExpired: 3,
      emailsExpired: 41,
      tenantsAffected: 2,
      expiryWarningsSent: 5,
    });
    expect(emailBalance.expireLots).toHaveBeenCalledTimes(1);
    expect(emailBalance.warnExpiringLots).toHaveBeenCalledTimes(1);
    // Both halves run with the same `now` (one argument each, same Date).
    const expireNow = emailBalance.expireLots.mock.calls[0][0];
    const warnNow = emailBalance.warnExpiringLots.mock.calls[0][0];
    expect(warnNow.getTime()).toBe(expireNow.getTime());
  });

  it('email-balance-reconcile reports checked + drifted counts', async () => {
    const { service, emailBalance } = buildService();
    const result = await service.runJob('email-balance-reconcile');
    expect(result.errors).toEqual([]);
    expect(result.counts).toEqual({
      accountsChecked: 12,
      accountsDrifted: 1,
    });
    expect(emailBalance.reconcile).toHaveBeenCalledTimes(1);
  });

  it('records the error (not a throw) when the expiry job fails', async () => {
    const { service, emailBalance } = buildService();
    emailBalance.expireLots.mockRejectedValueOnce(new Error('db down'));
    const result = await service.runJob('email-balance-expiry');
    expect(result.errors).toEqual(['db down']);
    const status = service
      .status()
      .jobs.find((j) => j.name === 'email-balance-expiry');
    expect(status?.lastError).toBe('db down');
    expect(status?.lastResult?.errors).toEqual(['db down']);
  });
});
