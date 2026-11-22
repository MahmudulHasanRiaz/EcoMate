import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';

const METERED_PRICING = {
  pricingVersion: 1,
  baseFee: { amount: 0, currency: 'BDT' },
  billingCycle: 'MONTHLY',
  metering: {
    metric: 'orders_per_month',
    included: 0,
    ratePerUnit: 10,
    minimumMonthly: 500,
  },
};

function makeService() {
  const prisma: any = {
    subscription: {
      findUnique: jest.fn(),
    },
    tenantPricingOverride: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    tenantPurchase: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenantBlockingOverride: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
    },
    planVersion: {
      findUnique: jest.fn(),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const refresh = {
    pushRefresh: jest.fn().mockResolvedValue({ ok: true }),
  };
  const service = new PricingService(prisma, audit as any, refresh as any);
  return { service, prisma, audit, refresh };
}

describe('PricingService.resolveForSubscription', () => {
  it('resolves plan pricing with overrides and rate-tier purchases', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      addOns: [],
    });
    prisma.tenantPricingOverride.findMany.mockResolvedValue([
      { key: 'minimum_monthly', value: '250' },
    ]);
    prisma.tenantPurchase.findMany.mockResolvedValue([
      {
        feeKey: 'lifetime-pro',
        effect: { type: 'rate_tier', perOrderRate: 1.5 },
      },
    ]);

    const resolved = await service.resolveForSubscription('sub-1', {
      id: 'v1',
      price: 0,
      currency: 'BDT',
      pricing: METERED_PRICING,
    });

    expect(resolved.pricing.metering?.ratePerUnit).toBe(1.5);
    expect(resolved.pricing.metering?.minimumMonthly).toBe(250);
    expect(resolved.sources.ratePerUnit).toBe('purchase:lifetime-pro');
    expect(resolved.sources.minimumMonthly).toBe('override');
  });

  it('falls back to the price column for a legacy empty pricing doc', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      addOns: [],
    });

    const resolved = await service.resolveForSubscription('sub-1', {
      id: 'v1',
      price: 1500,
      currency: 'BDT',
      pricing: {},
    });

    expect(resolved.pricing.baseFee).toEqual({
      amount: 1500,
      currency: 'BDT',
    });
  });

  it('resolves active add-ons with their metering', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      addOns: [
        {
          addOn: {
            name: 'Extra Orders',
            price: 0,
            metering: {
              metric: 'orders_per_month',
              included: 100,
              ratePerUnit: 5,
              minimumMonthly: null,
            },
          },
        },
        { addOn: { name: 'Inbox', price: 500, metering: null } },
      ],
    });

    const resolved = await service.resolveForSubscription('sub-1', {
      id: 'v1',
      price: 0,
      currency: 'BDT',
      pricing: METERED_PRICING,
    });

    expect(resolved.addOns).toEqual([
      {
        name: 'Extra Orders',
        baseFee: 0,
        metering: {
          metric: 'orders_per_month',
          included: 100,
          ratePerUnit: 5,
          minimumMonthly: null,
        },
      },
      { name: 'Inbox', baseFee: 500, metering: undefined },
    ]);
  });

  it('throws when the subscription does not exist', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findUnique.mockResolvedValue(null);
    await expect(
      service.resolveForSubscription('missing', {
        id: 'v1',
        pricing: {},
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('excludes unconfirmed trial-granted add-ons from billing', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findUnique.mockResolvedValue({
      tenantId: 'tenant-1',
      addOns: [
        // Trial-granted, never confirmed: never billed.
        {
          trialGranted: true,
          confirmedAt: null,
          addOn: { name: 'Storefront', price: 999, metering: null },
        },
        // Trial-granted, confirmed at conversion: billed.
        {
          trialGranted: true,
          confirmedAt: new Date('2026-11-22T00:00:00Z'),
          addOn: { name: 'POS', price: 499, metering: null },
        },
        // Operator-attached (not trial-granted): billed as before.
        {
          trialGranted: false,
          confirmedAt: null,
          addOn: { name: 'Inbox', price: 500, metering: null },
        },
      ],
    });

    const resolved = await service.resolveForSubscription('sub-1', {
      id: 'v1',
      price: 0,
      currency: 'BDT',
      pricing: METERED_PRICING,
    });

    expect(resolved.addOns).toEqual([
      { name: 'POS', baseFee: 499, metering: undefined },
      { name: 'Inbox', baseFee: 500, metering: undefined },
    ]);
  });
});

describe('PricingService.preview', () => {
  it('dry-runs the bill for a hypothetical order count', async () => {
    const { service, prisma } = makeService();
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'v1',
      planId: 'plan-1',
      version: 1,
      price: 0,
      currency: 'BDT',
      interval: 'MONTHLY',
      intervalDays: null,
      pricing: METERED_PRICING,
      plan: { id: 'plan-1', name: 'Growth' },
    });

    const result = await service.preview('plan-1', 'v1', { orders: 30 });

    expect(result.bill.total).toBe(500);
    expect(result.bill.lines).toHaveLength(2);
    expect(result.hypotheticalOrders).toBe(30);
    expect(result.effectivePricing.metering?.ratePerUnit).toBe(10);
  });

  it('applies the tenant resolution when a tenantId is given', async () => {
    const { service, prisma } = makeService();
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'v1',
      planId: 'plan-1',
      version: 1,
      price: 0,
      currency: 'BDT',
      interval: 'MONTHLY',
      intervalDays: null,
      pricing: METERED_PRICING,
      plan: { id: 'plan-1', name: 'Growth' },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      tenantId: 'tenant-1',
      addOns: [],
    });
    prisma.tenantPricingOverride.findMany.mockResolvedValue([
      { key: 'per_order_rate', value: '2' },
    ]);

    const result = await service.preview('plan-1', 'v1', {
      tenantId: 'tenant-1',
      orders: 120,
    });

    // 120 × ৳2 = ৳240, floored at ৳500.
    expect(result.bill.total).toBe(500);
    expect(result.sources.ratePerUnit).toBe('override');
  });
});

describe('PricingService.fetchPeriodUsage', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, INTERNAL_SERVICE_SECRET: 'secret' };
    global.fetch = jest.fn() as any;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('reads the live count for the period window', async () => {
    const { service } = makeService();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        limits: [
          { key: 'orders_per_month', used: 42 },
          { key: 'products', used: 10 },
        ],
      }),
    });

    const usage = await service.fetchPeriodUsage(
      'tenant-1',
      'acme',
      new Date('2026-11-01T00:00:00.000Z'),
      new Date('2026-12-01T00:00:00.000Z'),
    );

    expect(usage).toEqual({ orders_per_month: 42, products: 10 });
    const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('tenantId=tenant-1');
    expect(url).toContain('slug=acme');
    expect(url).toContain('from=2026-11-01T00%3A00%3A00.000Z');
    expect(url).toContain('to=2026-12-01T00%3A00%3A00.000Z');
  });

  it('throws BadGateway when the backend is unreachable', async () => {
    const { service } = makeService();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      service.fetchPeriodUsage(
        'tenant-1',
        'acme',
        new Date('2026-11-01T00:00:00.000Z'),
        new Date('2026-12-01T00:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGateway on a non-200 response', async () => {
    const { service } = makeService();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'down',
    });

    await expect(
      service.fetchPeriodUsage(
        'tenant-1',
        'acme',
        new Date('2026-11-01T00:00:00.000Z'),
        new Date('2026-12-01T00:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('PricingService overrides', () => {
  it('lists overrides with the plan values alongside', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      subscription: {
        planVersion: { pricing: METERED_PRICING },
      },
    });
    prisma.tenantPricingOverride.findMany.mockResolvedValue([
      {
        key: 'per_order_rate',
        value: '2',
        note: 'VIP deal',
        createdBy: 'admin-1',
        updatedBy: null,
        updatedAt: new Date(),
      },
    ]);

    const result = await service.listOverrides('tenant-1');

    expect(result.planValues).toEqual({
      per_order_rate: 10,
      minimum_monthly: 500,
    });
    expect(result.overrides[0]).toMatchObject({
      key: 'per_order_rate',
      value: 2,
      planValue: 10,
    });
  });

  it('upserts an override, audits it and pushes a refresh', async () => {
    const { service, prisma, audit, refresh } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.tenantPricingOverride.findUnique.mockResolvedValue(null);
    prisma.tenantPricingOverride.upsert.mockResolvedValue({
      id: 'ov-1',
      key: 'per_order_rate',
      value: 2,
    });

    await service.setOverride(
      'tenant-1',
      { key: 'per_order_rate', value: 2, note: 'VIP' },
      'admin-1',
    );

    expect(prisma.tenantPricingOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_key: { tenantId: 'tenant-1', key: 'per_order_rate' },
        },
        create: expect.objectContaining({ value: 2, note: 'VIP' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.pricing.override.set' }),
    );
    expect(refresh.pushRefresh).toHaveBeenCalledWith('acme');
  });

  it('deletes an override (plan value applies again)', async () => {
    const { service, prisma, audit } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.tenantPricingOverride.findUnique.mockResolvedValue({
      id: 'ov-1',
      key: 'per_order_rate',
      value: '2',
    });
    prisma.tenantPricingOverride.delete.mockResolvedValue({});

    const result = await service.deleteOverride(
      'tenant-1',
      'per_order_rate',
      'admin-1',
    );

    expect(result).toEqual({
      tenantId: 'tenant-1',
      key: 'per_order_rate',
      deleted: true,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.pricing.override.delete' }),
    );
  });
});

describe('PricingService blocking overrides', () => {
  it('reports the effective config and the areas blocked right now', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'PAST_DUE',
      graceEndsAt: new Date('2026-11-01T00:00:00.000Z'),
      blockingOverride: {
        mode: 'block_immediately',
        blockedAreas: ['orders'],
      },
      subscription: {
        status: 'PAST_DUE',
        planVersion: { pricing: {} },
      },
    });

    const result = await service.getBlockingOverride('tenant-1');

    expect(result.effective).toEqual({
      mode: 'block_immediately',
      blockedAreas: ['orders'],
    });
    expect(result.blockedAreasNow).toEqual(['orders']);
  });

  it('rejects an unknown blocking area', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });

    await expect(
      service.setBlockingOverride(
        'tenant-1',
        { mode: 'block_immediately', blockedAreas: ['teleport'] },
        'admin-1',
      ),
    ).rejects.toThrow('Unknown blocking area "teleport"');
  });
});
