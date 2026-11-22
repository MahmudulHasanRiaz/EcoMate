import { InternalController } from './internal.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeController() {
  const prisma: any = {
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const domainConfig = {
    getConfig: jest.fn().mockReturnValue({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd'],
      landingUrl: 'https://www.ecomate.bd',
      adminUrl: 'https://saas.ecomate.bd',
      customDomainCname: 'cname.ecomate.bd',
      allowExternalFallback: false,
      primaryHealthy: true,
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
        platformApi: 'api.ecomate.bd',
        webhooks: 'api.ecomate.bd',
      },
    }),
  };
  return {
    prisma,
    domainConfig,
    // Registry + entitlements only use prisma; the other services are
    // stubs (billing/invoices predate this spec; emailBalance is the
    // SMTP worker's param).
    controller: new InternalController(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      domainConfig as any,
    ),
  };
}

function tenantFixture(overrides: any[] = []) {
  return {
    id: TENANT_ID,
    slug: 'acme',
    status: 'ACTIVE',
    domains: [],
    subscription: {
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: null,
    },
    planVersion: {
      id: 'pv-1',
      version: 1,
      features: ['admin_products'],
      limits: { products: 100, staff_users: 5 },
      plan: { name: 'Growth' },
    },
    limitOverrides: overrides,
  };
}

describe('InternalController — registry domain config', () => {
  it('includes the live domain config in the registry payload', async () => {
    const { controller } = makeController();
    const result = await controller.registry();

    expect(result.domains).toMatchObject({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd'],
      customDomainCname: 'cname.ecomate.bd',
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
      },
    });
  });
});

describe('InternalController — effective limits', () => {
  it('applies per-tenant overrides to the registry limits', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findMany.mockResolvedValue([
      tenantFixture([
        { key: 'products', value: 250 },
        { key: 'storage_mb', value: 2048 },
      ]),
    ]);

    const result = await controller.registry();

    expect(result.tenants[0].plan?.limits).toEqual({
      products: 250,
      staff_users: 5,
      storage_mb: 2048,
    });
  });

  it('keeps plan limits for tenants without overrides', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findMany.mockResolvedValue([tenantFixture()]);

    const result = await controller.registry();

    expect(result.tenants[0].plan?.limits).toEqual({
      products: 100,
      staff_users: 5,
    });
  });

  it('applies overrides to the entitlement snapshot used by tenant refresh', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenantFixture([{ key: 'products', value: 7 }]),
      subscription: {
        status: 'ACTIVE',
        trialEndsAt: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        planVersion: {
          id: 'pv-1',
          version: 1,
          features: ['admin_products'],
          limits: { products: 100, staff_users: 5 },
          trialDays: 14,
          graceDays: 7,
          plan: { name: 'Growth' },
        },
      },
      planVersion: null,
      trialEndsAt: null,
      graceEndsAt: null,
    });

    const result = await controller.entitlements(TENANT_ID);

    expect(result.plan?.limits).toEqual({ products: 7, staff_users: 5 });
    expect(result.overrides).toEqual([
      { key: 'products', value: 7, note: null },
    ]);
  });
});

describe('InternalController — registry pricing + blocking', () => {
  const PAST = new Date(Date.now() - 86_400_000);
  const FUTURE = new Date(Date.now() + 86_400_000);

  function registryFixture(overrides: Record<string, unknown> = {}): any {
    return {
      ...tenantFixture(),
      graceEndsAt: null,
      blockingOverride: null,
      pricingOverrides: [],
      purchases: [],
      planVersion: {
        ...tenantFixture().planVersion,
        price: 0,
        currency: 'BDT',
        pricing: {
          pricingVersion: 1,
          baseFee: { amount: 0, currency: 'BDT' },
          billingCycle: 'MONTHLY',
          metering: {
            metric: 'orders_per_month',
            included: 0,
            ratePerUnit: 10,
            minimumMonthly: 500,
          },
        },
      },
      ...overrides,
    };
  }

  it('blocks the plan areas once a PAST_DUE tenant is past grace', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture({
      status: 'PAST_DUE',
      graceEndsAt: PAST,
      subscription: {
        status: 'PAST_DUE',
        trialEndsAt: null,
        currentPeriodEnd: null,
      },
    });
    fixture.planVersion.pricing.blocking = {
      mode: 'grace_then_block',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].blockedAreas).toEqual(['orders', 'pos']);
  });

  it('does not block a PAST_DUE tenant still inside grace (grace_then_block)', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture({
      status: 'PAST_DUE',
      graceEndsAt: FUTURE,
      subscription: {
        status: 'PAST_DUE',
        trialEndsAt: null,
        currentPeriodEnd: null,
      },
    });
    fixture.planVersion.pricing.blocking = {
      mode: 'grace_then_block',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].blockedAreas).toEqual([]);
  });

  it('lets a per-tenant blocking override win over the plan config', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture({
      status: 'PAST_DUE',
      graceEndsAt: FUTURE,
      subscription: {
        status: 'PAST_DUE',
        trialEndsAt: null,
        currentPeriodEnd: null,
      },
      blockingOverride: {
        mode: 'block_immediately',
        blockedAreas: ['storefront_checkout'],
      },
    });
    fixture.planVersion.pricing.blocking = {
      mode: 'grace_then_block',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    // block_immediately applies even inside the grace window.
    expect(result.tenants[0].blockedAreas).toEqual(['storefront_checkout']);
  });

  it('never blocks an ACTIVE tenant', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture();
    fixture.planVersion.pricing.blocking = {
      mode: 'block_immediately',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].blockedAreas).toEqual([]);
  });

  it('resolves effective pricing: override beats purchase beats plan', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findMany.mockResolvedValue([
      registryFixture({
        pricingOverrides: [{ key: 'per_order_rate', value: 2 }],
        purchases: [
          {
            type: 'RATE_TIER',
            feeKey: 'lifetime-pro',
            effect: { type: 'rate_tier', perOrderRate: 1.5 },
          },
        ],
      }),
      registryFixture({
        purchases: [
          {
            type: 'RATE_TIER',
            feeKey: 'lifetime-pro',
            effect: { type: 'rate_tier', perOrderRate: 1.5 },
          },
        ],
      }),
      registryFixture(),
    ]);

    const result = await controller.registry();

    expect(result.tenants[0].effectivePricing).toEqual({
      baseFee: 0,
      ratePerUnit: 2,
      minimumMonthly: 500,
      currency: 'BDT',
    });
    expect(result.tenants[1].effectivePricing.ratePerUnit).toBe(1.5);
    expect(result.tenants[2].effectivePricing.ratePerUnit).toBe(10);
  });

  it('unions add-on + unlock features and merges add-on limits with max()', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture();
    fixture.subscription = {
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: null,
      addOns: [
        {
          addOn: {
            features: ['inbox'],
            limits: { products: 500, inbox_accounts: 5 },
          },
        },
      ],
    };
    fixture.purchases = [
      {
        type: 'FEATURE_UNLOCK',
        feeKey: 'unlock-analytics',
        effect: { type: 'feature_unlock', features: ['analytics'] },
      },
    ];
    fixture.limitOverrides = [{ key: 'products', value: 250 }];
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].plan?.features).toEqual(
      expect.arrayContaining(['admin_products', 'inbox', 'analytics']),
    );
    // Plan 100, override 250, add-on 500 → the max wins (500).
    expect(result.tenants[0].plan?.limits).toEqual({
      products: 500,
      staff_users: 5,
      inbox_accounts: 5,
    });
  });
});
