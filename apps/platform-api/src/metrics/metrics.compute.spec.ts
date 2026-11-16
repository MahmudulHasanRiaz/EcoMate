import {
  buildRevenue,
  churnStats,
  conversionRate,
  monthlyEquivalentCents,
  roundMoney,
  statusCounts,
  trialStats,
} from './metrics.compute';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function sub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    tenantId: TENANT_A,
    tenantName: 'Acme',
    planName: 'Growth',
    status: 'ACTIVE',
    price: 1500,
    currency: 'BDT',
    interval: 'MONTHLY',
    intervalDays: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    trialEndsAt: null,
    endedAt: null,
    canceledAt: null,
    ...overrides,
  };
}

describe('monthlyEquivalentCents', () => {
  it('keeps a monthly price as-is', () => {
    expect(monthlyEquivalentCents(1500, 'MONTHLY', null)).toBe(150000);
  });

  it('divides a yearly price by twelve', () => {
    expect(monthlyEquivalentCents(12000, 'YEARLY', null)).toBe(100000);
  });

  it('normalises a custom interval to 30 days', () => {
    expect(monthlyEquivalentCents(900, 'CUSTOM', 90)).toBe(30000);
  });

  it('falls back to the monthly price for a custom interval without days', () => {
    expect(monthlyEquivalentCents(900, 'CUSTOM', null)).toBe(90000);
  });

  it('treats a missing or invalid price as free', () => {
    expect(monthlyEquivalentCents(null, 'MONTHLY', null)).toBe(0);
    expect(monthlyEquivalentCents('abc', 'MONTHLY', null)).toBe(0);
    expect(monthlyEquivalentCents(-5, 'MONTHLY', null)).toBe(0);
  });

  it('reads a Prisma Decimal price instead of treating it as free', () => {
    const decimal = { toString: () => '1500.50' };
    expect(monthlyEquivalentCents(decimal, 'MONTHLY', null)).toBe(150050);
    expect(monthlyEquivalentCents({ toString: () => '12000' }, 'YEARLY', null)).toBe(
      100000,
    );
    expect(monthlyEquivalentCents({} as any, 'MONTHLY', null)).toBe(0);
  });
});

describe('buildRevenue', () => {
  it('counts paying subscriptions as MRR and multiplies by twelve for ARR', () => {
    const revenue = buildRevenue([
      sub({ id: 'a', price: 1500 }),
      sub({ id: 'b', tenantId: TENANT_B, price: 2500 }),
    ]);

    expect(revenue.byCurrency).toEqual([
      {
        currency: 'BDT',
        mrr: 4000,
        arr: 48000,
        subscriptions: 2,
        atRiskMrr: 0,
      },
    ]);
    expect(revenue.paying).toBe(2);
  });

  it('keeps past-due revenue out of MRR and reports it as at risk', () => {
    const revenue = buildRevenue([
      sub({ id: 'a', price: 1500, status: 'ACTIVE' }),
      sub({ id: 'b', price: 900, status: 'PAST_DUE' }),
    ]);

    expect(revenue.byCurrency[0]).toMatchObject({
      mrr: 1500,
      arr: 18000,
      subscriptions: 1,
      atRiskMrr: 900,
    });
    expect(revenue.atRisk).toBe(1);
  });

  it('never counts trial, suspended, cancelled or expired subscriptions', () => {
    const revenue = buildRevenue([
      sub({ id: 'a', status: 'TRIAL' }),
      sub({ id: 'b', status: 'SUSPENDED' }),
      sub({ id: 'c', status: 'CANCELLED' }),
      sub({ id: 'd', status: 'EXPIRED' }),
    ]);

    expect(revenue.byCurrency).toEqual([]);
    expect(revenue.paying).toBe(0);
  });

  it('counts a tenant activated by the operator even while the subscription still says trial', () => {
    const revenue = buildRevenue([
      sub({ id: 'a', status: 'TRIAL', tenantStatus: 'ACTIVE', price: 1500 }),
    ]);

    expect(revenue.byCurrency[0]).toMatchObject({
      mrr: 1500,
      arr: 18000,
      subscriptions: 1,
    });
    expect(revenue.basis.payingFromTenant).toBe(1);
    expect(revenue.basis.payingFromSubscription).toBe(0);
  });

  it('treats a suspended, cancelled or expired tenant as revenue-free', () => {
    const revenue = buildRevenue([
      sub({ id: 'a', status: 'TRIAL', tenantStatus: 'SUSPENDED' }),
      sub({ id: 'b', status: 'TRIAL', tenantStatus: 'CANCELLED' }),
      sub({ id: 'c', status: 'TRIAL', tenantStatus: 'DELETED' }),
    ]);

    expect(revenue.byCurrency).toEqual([]);
  });

  it('splits currencies instead of adding them together', () => {    const revenue = buildRevenue([
      sub({ id: 'a', price: 1500, currency: 'BDT' }),
      sub({ id: 'b', price: 20, currency: 'USD' }),
    ]);

    expect(revenue.byCurrency.map((row) => row.currency)).toEqual(['BDT', 'USD']);
    expect(revenue.byCurrency[0].mrr).toBe(1500);
    expect(revenue.byCurrency[1].mrr).toBe(20);
  });
});

describe('statusCounts', () => {
  it('counts every subscription status', () => {
    const counts = statusCounts([
      sub({ id: 'a', status: 'ACTIVE' }),
      sub({ id: 'b', status: 'ACTIVE' }),
      sub({ id: 'c', status: 'TRIAL' }),
      sub({ id: 'd', status: 'PAST_DUE' }),
    ]);

    expect(counts).toEqual({
      ACTIVE: 2,
      TRIAL: 1,
      PAST_DUE: 1,
      SUSPENDED: 0,
      CANCELLED: 0,
      EXPIRED: 0,
    });
  });
});

describe('trialStats', () => {
  const now = new Date('2026-11-16T00:00:00.000Z');

  it('counts active trials and the ones ending within the window', () => {
    const stats = trialStats(
      [
        sub({
          id: 'a',
          status: 'TRIAL',
          trialEndsAt: new Date('2026-11-20T00:00:00.000Z'),
        }),
        sub({
          id: 'b',
          status: 'TRIAL',
          trialEndsAt: new Date('2026-11-25T00:00:00.000Z'),
        }),
        sub({ id: 'c', status: 'ACTIVE', trialEndsAt: null }),
      ],
      now,
      7,
    );

    expect(stats.active).toBe(2);
    expect(stats.endingSoon).toBe(1);
    expect(stats.expired).toBe(0);
  });

  it('flags a trial whose end date passed without a conversion', () => {
    const stats = trialStats(
      [
        sub({
          id: 'a',
          status: 'TRIAL',
          trialEndsAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
      ],
      now,
      7,
    );

    expect(stats.expired).toBe(1);
  });
});

describe('churnStats', () => {
  const windowStart = new Date('2026-10-17T00:00:00.000Z');
  const windowEnd = new Date('2026-11-16T00:00:00.000Z');

  it('counts subscriptions that ended inside the window', () => {
    const stats = churnStats(
      [
        sub({
          id: 'a',
          tenantName: 'Acme',
          endedAt: new Date('2026-11-02T00:00:00.000Z'),
        }),
        sub({
          id: 'b',
          tenantName: 'Beta',
          canceledAt: new Date('2026-11-05T00:00:00.000Z'),
        }),
        sub({
          id: 'c',
          tenantName: 'Gamma',
          endedAt: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ],
      windowStart,
      windowEnd,
    );

    expect(stats.churned).toBe(2);
    expect(stats.tenants.map((row) => row.tenantName)).toEqual(['Acme', 'Beta']);
  });

  it('computes the churn rate against the subscriptions live at window start', () => {
    const stats = churnStats(
      [
        sub({ id: 'a', endedAt: new Date('2026-11-02T00:00:00.000Z') }),
        sub({ id: 'b', startedAt: new Date('2026-02-01T00:00:00.000Z') }),
        sub({ id: 'c', startedAt: new Date('2026-02-01T00:00:00.000Z') }),
        sub({ id: 'd', startedAt: new Date('2026-02-01T00:00:00.000Z') }),
      ],
      windowStart,
      windowEnd,
    );

    expect(stats.churned).toBe(1);
    expect(stats.base).toBe(4);
    expect(stats.rate).toBe(25);
  });

  it('returns a null rate instead of a fake zero when nothing was live', () => {
    const stats = churnStats(
      [
        sub({
          id: 'a',
          startedAt: new Date('2026-11-10T00:00:00.000Z'),
        }),
      ],
      windowStart,
      windowEnd,
    );

    expect(stats.base).toBe(1);
    expect(stats.rate).toBe(0);
  });

  it('reports a null rate when there is no base at all', () => {
    const stats = churnStats([], windowStart, windowEnd);
    expect(stats.base).toBe(0);
    expect(stats.rate).toBeNull();
  });
});

describe('conversionRate', () => {
  it('returns the percentage of paying subscriptions', () => {
    expect(conversionRate(3, 4)).toBe(75);
  });

  it('returns null when there is nothing to convert', () => {
    expect(conversionRate(0, 0)).toBeNull();
  });
});

describe('roundMoney', () => {
  it('rounds to two decimals', () => {
    expect(roundMoney(1499.5)).toBe(1499.5);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1234.567)).toBe(1234.57);
  });
});
