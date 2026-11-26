import { InternalController } from './internal.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const HANDOFF_ID = '22222222-2222-4222-8222-222222222222';

function makeController() {
  const prisma: any = {
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    platformSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    auditLog: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
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
    audit,
    // Registry + entitlements only use prisma; the other services are
    // stubs (billing/invoices predate this spec; emailBalance is the
    // SMTP worker's param). Phase 4 removed the ImpersonationService
    // constructor param (the consume route is deleted), so the
    // positional args start at billing.
    controller: new InternalController(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      domainConfig as any,
      audit as any,
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

describe('InternalController — organization-limit (Phase 3, D12)', () => {
  it('returns the stored setting row when present', async () => {
    const { controller, prisma } = makeController();
    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 3 },
    });

    const result = await controller.organizationLimit();

    expect(prisma.platformSetting.findUnique).toHaveBeenCalledWith({
      where: { key: 'organization_limit' },
    });
    expect(result).toEqual({ limit: 3, source: 'setting' });
  });

  it('accepts a bare JSON number as the stored value', async () => {
    const { controller, prisma } = makeController();
    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: 7,
    });

    expect(await controller.organizationLimit()).toEqual({
      limit: 7,
      source: 'setting',
    });
  });

  it('returns the D12 default (5) when no row exists', async () => {
    const { controller } = makeController();
    expect(await controller.organizationLimit()).toEqual({
      limit: 5,
      source: 'default',
    });
  });

  it('returns the default for a malformed row and clamps out-of-range values', async () => {
    const { controller, prisma } = makeController();
    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 'abc' },
    });
    expect(await controller.organizationLimit()).toEqual({
      limit: 5,
      source: 'default',
    });

    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 0 },
    });
    expect(await controller.organizationLimit()).toEqual({
      limit: 1,
      source: 'setting',
    });

    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 2000 },
    });
    expect(await controller.organizationLimit()).toEqual({
      limit: 1000,
      source: 'setting',
    });
  });
});

describe('InternalController — impersonations/consumed (Phase 3, D8)', () => {
  const body = {
    handoffId: HANDOFF_ID,
    organizationId: TENANT_ID,
    targetUserId: 'user_target-central-id',
    adminUserId: 'user_admin-central-id',
    consumedAt: new Date().toISOString(),
  };

  it('records the consumption as an audit row and returns recorded:true', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });

    const result = await controller.impersonationConsumed(body);

    expect(result).toEqual({ ok: true, recorded: true });
    expect(audit.record).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      action: 'tenant.impersonate.consumed',
      entity: 'Tenant',
      entityId: TENANT_ID,
      after: {
        handoffId: HANDOFF_ID,
        targetUserId: 'user_target-central-id',
        adminUserId: 'user_admin-central-id',
        consumedAt: body.consumedAt,
      },
    });
    // The central admin id is recorded in `after`, never as actorId
    // (AuditLog.actorId FKs to PlatformUser, which has no such row).
    expect(audit.record.mock.calls[0][0].actorId).toBeUndefined();
  });

  it('is idempotent: a retried callback with the same handoffId writes no second row', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
    prisma.auditLog.findFirst.mockResolvedValue({ id: 'audit-1' });

    const result = await controller.impersonationConsumed(body);

    expect(result).toEqual({ ok: true, recorded: false, duplicate: true });
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
      where: {
        action: 'tenant.impersonate.consumed',
        entityId: TENANT_ID,
        after: { path: ['handoffId'], equals: HANDOFF_ID },
      },
      select: { id: true },
    });
  });

  it('404s for an unknown tenant (no audit row)', async () => {
    const { controller, audit } = makeController();
    await expect(controller.impersonationConsumed(body)).rejects.toThrow(
      'Tenant not found',
    );
    expect(audit.record).not.toHaveBeenCalled();
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
