import { InternalController } from './internal.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeController() {
  const prisma: any = {
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  return {
    prisma,
    controller: new InternalController(prisma, {} as any),
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

    expect(result.tenants[0].plan.limits).toEqual({
      products: 250,
      staff_users: 5,
      storage_mb: 2048,
    });
  });

  it('keeps plan limits for tenants without overrides', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findMany.mockResolvedValue([tenantFixture()]);

    const result = await controller.registry();

    expect(result.tenants[0].plan.limits).toEqual({
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
