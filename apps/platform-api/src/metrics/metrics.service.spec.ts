import { MetricsService } from './metrics.service';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const NOW = new Date('2026-11-16T12:00:00.000Z');

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    tenantId: TENANT_A,
    status: 'ACTIVE',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    trialEndsAt: null,
    endedAt: null,
    canceledAt: null,
    currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
    planVersion: {
      id: 'pv-1',
      version: 2,
      price: 1500,
      currency: 'BDT',
      interval: 'MONTHLY',
      intervalDays: null,
      plan: { id: 'plan-1', name: 'Growth' },
    },
    tenant: { id: TENANT_A, name: 'Acme', status: 'ACTIVE' },
    ...overrides,
  };
}

function makeService(overrides: any = {}) {
  const prisma: any = {
    subscription: {
      findMany: jest.fn().mockResolvedValue([subscription()]),
    },
    tenant: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'ACTIVE', _count: 2 },
        { status: 'TRIAL', _count: 1 },
      ]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payment: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  return { prisma, service: new MetricsService(prisma, () => NOW) };
}

describe('MetricsService.overview', () => {
  it('computes MRR, ARR and the subscription status split from stored rows', async () => {
    const { service } = makeService();

    const result = await service.overview(30);

    expect(result.revenue.byCurrency).toEqual([
      {
        currency: 'BDT',
        mrr: 1500,
        arr: 18000,
        subscriptions: 1,
        atRiskMrr: 0,
      },
    ]);
    expect(result.revenue.paying).toBe(1);
    expect(result.subscriptions.counts.ACTIVE).toBe(1);
    expect(result.subscriptions.total).toBe(1);
  });

  it('keeps the tenant status counts from the platform rows', async () => {
    const { service, prisma } = makeService();

    const result = await service.overview(30);

    expect(prisma.tenant.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['status'] }),
    );
    expect(result.tenants).toMatchObject({
      total: 3,
      active: 2,
      trial: 1,
      pastDue: 0,
    });
  });

  it('reports trials that ended without converting', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: 'sub-trial',
        status: 'TRIAL',
        trialEndsAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ]);

    const result = await service.overview(30);

    expect(result.trials).toMatchObject({ active: 1, expired: 1, endingSoon: 0 });
  });

  it('computes churn inside the window with a null rate when nothing was live', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: 'sub-churn',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-11-05T00:00:00.000Z'),
      }),
    ]);

    const result = await service.overview(30);

    expect(result.churn).toMatchObject({ churned: 1, base: 1, rate: 100 });
    expect(result.churn.tenants[0]).toMatchObject({ tenantName: 'Acme' });
  });

  it('sums collected payments per currency inside the window', async () => {
    const { service, prisma } = makeService();
    prisma.payment.findMany.mockResolvedValue([
      { amount: 1500, currency: 'BDT', receivedAt: new Date('2026-11-10T00:00:00.000Z') },
      { amount: 500, currency: 'BDT', receivedAt: new Date('2026-10-05T00:00:00.000Z') },
      { amount: 20, currency: 'USD', receivedAt: new Date('2026-11-11T00:00:00.000Z') },
    ]);

    const result = await service.overview(30);

    expect(result.collections.byCurrency).toEqual([
      { currency: 'BDT', amount: 1500, payments: 1 },
      { currency: 'USD', amount: 20, payments: 1 },
    ]);
    expect(result.collections.payments).toBe(2);
  });

  it('splits open invoices into total and overdue', async () => {
    const { service, prisma } = makeService();
    prisma.invoice.findMany.mockResolvedValue([
      { total: 1500, currency: 'BDT', dueAt: new Date('2026-11-01T00:00:00.000Z') },
      { total: 3000, currency: 'BDT', dueAt: new Date('2026-12-01T00:00:00.000Z') },
    ]);

    const result = await service.overview(30);

    expect(result.collections.outstanding.open).toEqual({
      count: 2,
      amount: 4500,
      currency: 'BDT',
    });
    expect(result.collections.outstanding.overdue).toEqual({
      count: 1,
      amount: 1500,
      currency: 'BDT',
    });
  });

  it('builds a six-month series of collections, new tenants and churn', async () => {
    const { service, prisma } = makeService();
    prisma.payment.findMany.mockResolvedValue([
      { amount: 1500, currency: 'BDT', receivedAt: new Date('2026-11-10T00:00:00.000Z') },
      { amount: 700, currency: 'BDT', receivedAt: new Date('2026-10-05T00:00:00.000Z') },
    ]);
    prisma.tenant.findMany.mockResolvedValue([
      { createdAt: new Date('2026-11-02T00:00:00.000Z') },
      { createdAt: new Date('2026-11-03T00:00:00.000Z') },
      { createdAt: new Date('2026-10-04T00:00:00.000Z') },
    ]);

    const result = await service.overview(30);

    expect(result.series.months).toHaveLength(6);
    const months = result.series.months.map((row) => row.month);
    expect(months[months.length - 1]).toBe('2026-11');
    const current = result.series.months[result.series.months.length - 1];
    expect(current).toMatchObject({ collected: 1500, newTenants: 2 });
    expect(result.series.months[months.indexOf('2026-10')]).toMatchObject({
      collected: 700,
      newTenants: 1,
    });
  });

  it('ranks plans by recurring revenue', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findMany.mockResolvedValue([
      subscription(),
      subscription({
        id: 'sub-2',
        tenantId: TENANT_B,
        planVersion: {
          id: 'pv-2',
          version: 1,
          price: 3000,
          currency: 'BDT',
          interval: 'MONTHLY',
          intervalDays: null,
          plan: { id: 'plan-2', name: 'Scale' },
        },
      }),
    ]);

    const result = await service.overview(30);

    expect(result.topPlans[0]).toMatchObject({
      plan: 'Scale',
      version: 1,
      tenants: 1,
      mrr: 3000,
    });
    expect(result.topPlans[1]).toMatchObject({ plan: 'Growth', mrr: 1500 });
  });

  it('clamps the window to 1-365 days', async () => {
    const { service } = makeService();

    const wide = await service.overview(5000);
    const narrow = await service.overview(0);

    expect(wide.windowDays).toBe(365);
    expect(narrow.windowDays).toBe(1);
  });

  it('never leaks a raw query parameter into the query', async () => {
    const { service, prisma } = makeService();

    await service.overview(Number.NaN);

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          receivedAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });
});
