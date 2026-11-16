import { ConflictException } from '@nestjs/common';
import { PlansService } from './plans.service';

const prisma: any = {
  plan: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  planVersion: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  subscription: {
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  tenant: {
    update: jest.fn().mockResolvedValue({}),
  },
  $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
};

const audit = { record: jest.fn() };
const settings = {
  getTrialDefaults: jest.fn().mockReturnValue({ trialDays: 30, graceDays: 10 }),
};
const refresh = {
  pushRefresh: jest.fn().mockResolvedValue({ ok: true }),
};
const service = new PlansService(
  prisma,
  audit as any,
  settings as any,
  refresh as any,
);

const basePlanDto = {
  slug: 'starter',
  name: 'Starter',
  price: 999,
  features: ['admin_products'],
  limits: { products: 100 },
};

describe('PlansService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audit.record.mockResolvedValue(undefined);
  });

  it('creates a plan with version 1 and writes an audit row', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    prisma.plan.create.mockResolvedValue({
      id: 'plan-1',
      slug: 'starter',
      name: 'Starter',
      versions: [{ id: 'v1', version: 1 }],
    });

    const result = await service.create(basePlanDto as any, 'platform-user-1');

    expect(prisma.plan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'starter',
          versions: expect.objectContaining({
            create: expect.objectContaining({
              version: 1,
              price: 999,
              features: ['admin_products'],
              limits: { products: 100 },
            }),
          }),
        }),
      }),
    );
    expect(result.id).toBe('plan-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'plan.create', entityId: 'plan-1' }),
    );
  });

  it('rejects a duplicate plan slug', async () => {
    prisma.plan.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create(basePlanDto as any, 'platform-user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses the platform trial defaults when the DTO omits trial/grace days', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    prisma.plan.create.mockResolvedValue({
      id: 'plan-1',
      slug: 'starter',
      versions: [{ id: 'v1', version: 1 }],
    });

    await service.create(basePlanDto as any, 'platform-user-1');

    const data = prisma.plan.create.mock.calls[0][0].data;
    expect(data.versions.create.trialDays).toBe(30);
    expect(data.versions.create.graceDays).toBe(10);
  });

  it('explicit DTO trial/grace days win over the platform defaults', async () => {
    prisma.plan.findUnique.mockResolvedValue(null);
    prisma.plan.create.mockResolvedValue({
      id: 'plan-1',
      slug: 'starter',
      versions: [{ id: 'v1', version: 1 }],
    });

    await service.create(
      { ...basePlanDto, trialDays: 5, graceDays: 3 } as any,
      'platform-user-1',
    );

    const data = prisma.plan.create.mock.calls[0][0].data;
    expect(data.versions.create.trialDays).toBe(5);
    expect(data.versions.create.graceDays).toBe(3);
  });

  it('falls back to the platform defaults for a new version without a previous value', async () => {
    prisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', slug: 'starter' });
    prisma.planVersion.findFirst.mockResolvedValue({
      version: 2,
      currency: 'BDT',
      interval: 'MONTHLY',
      trialDays: undefined,
      graceDays: undefined,
      features: [],
      limits: {},
    });
    prisma.planVersion.create.mockResolvedValue({
      id: 'v3',
      version: 3,
      planId: 'plan-1',
    });

    await service.addVersion('plan-1', { price: 1499 } as any, 'u1');

    const data = prisma.planVersion.create.mock.calls[0][0].data;
    expect(data.trialDays).toBe(30);
    expect(data.graceDays).toBe(10);
  });

  it('creates the next immutable version', async () => {
    prisma.plan.findUnique.mockResolvedValue({
      id: 'plan-1',
      slug: 'starter',
    });
    prisma.planVersion.findFirst.mockResolvedValue({
      version: 2,
      currency: 'BDT',
      interval: 'MONTHLY',
      trialDays: 14,
      features: ['admin_products'],
      limits: { products: 100 },
      graceDays: 7,
    });
    prisma.planVersion.create.mockResolvedValue({
      id: 'v3',
      version: 3,
      planId: 'plan-1',
    });

    const result = await service.addVersion(
      'plan-1',
      { price: 1499 } as any,
      'platform-user-1',
    );

    expect(prisma.planVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ planId: 'plan-1', version: 3 }),
      }),
    );
    expect(result.version).toBe(3);
  });

  describe('applyVersion', () => {
    const version = {
      id: 'v2',
      version: 2,
      planId: 'plan-1',
      archivedAt: null,
      features: ['admin_products'],
      limits: { products: 500 },
      plan: { id: 'plan-1', name: 'Growth' },
    };
    const affected = [
      {
        id: 'sub-1',
        tenantId: 'tenant-1',
        planVersionId: 'v1',
        status: 'ACTIVE',
        tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' },
      },
      {
        id: 'sub-2',
        tenantId: 'tenant-2',
        planVersionId: 'v1',
        status: 'TRIAL',
        tenant: { id: 'tenant-2', name: 'Beta', slug: 'beta' },
      },
    ];

    it('dry-run reports the affected tenants without changing anything', async () => {
      prisma.planVersion.findUnique.mockResolvedValue(version);
      prisma.subscription.findMany.mockResolvedValue(affected);

      const result = await service.applyVersion(
        'plan-1',
        'v2',
        { dryRun: true },
        'u1',
      );

      expect(result).toMatchObject({
        dryRun: true,
        affected: 2,
        version: 2,
      });
      expect(result.tenants[0]).toMatchObject({
        tenantSlug: 'acme',
        fromVersionId: 'v1',
        status: 'ACTIVE',
      });
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(refresh.pushRefresh).not.toHaveBeenCalled();
    });

    it('moves every affected subscription and refreshes entitlements', async () => {
      prisma.planVersion.findUnique.mockResolvedValue(version);
      prisma.subscription.findMany.mockResolvedValue(affected);

      const result = await service.applyVersion(
        'plan-1',
        'v2',
        { dryRun: false },
        'u1',
      );

      expect(result.affected).toBe(2);
      expect(prisma.subscription.update).toHaveBeenCalledTimes(2);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({ planVersionId: 'v2' }),
        }),
      );
      expect(prisma.tenant.update).toHaveBeenCalledTimes(2);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.plan.version.apply',
          tenantId: 'tenant-1',
        }),
      );
      expect(refresh.pushRefresh).toHaveBeenCalledWith('*');
    });

    it('refuses a version from another plan or an archived version', async () => {
      prisma.planVersion.findUnique.mockResolvedValue({
        ...version,
        planId: 'other-plan',
      });
      await expect(
        service.applyVersion('plan-1', 'v2', { dryRun: true }),
      ).rejects.toThrow('Plan version not found');

      prisma.planVersion.findUnique.mockResolvedValue({
        ...version,
        archivedAt: new Date(),
      });
      await expect(
        service.applyVersion('plan-1', 'v2', { dryRun: true }),
      ).rejects.toThrow('This plan version is archived');
    });
  });
});
