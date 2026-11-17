import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma';
import { PlansService } from './plans.service';

const prisma: any = {
  plan: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  planVersion: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  subscription: {
    findMany: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  tenant: {
    update: jest.fn().mockResolvedValue({}),
  },
  // Handles both the array form (other methods) and the callback form
  // (setDefaultVersion): the callback receives the same mock as its tx client.
  $transaction: jest.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  ),
  $executeRaw: jest.fn().mockResolvedValue(1),
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

  it('lists plans with Decimal prices converted to JSON numbers', async () => {
    prisma.plan.findMany.mockResolvedValue([
      {
        id: 'plan-1',
        slug: 'growth',
        versions: [
          { id: 'v2', version: 2, price: new Prisma.Decimal('1500.50') },
          { id: 'v1', version: 1, price: new Prisma.Decimal('999') },
        ],
      },
    ]);

    const result = await service.list();

    expect(result[0].versions[0].price).toBe(1500.5);
    expect(typeof result[0].versions[0].price).toBe('number');
    expect(result[0].versions[1].price).toBe(999);
    expect(result[0].currentVersion.price).toBe(1500.5);
    expect(JSON.parse(JSON.stringify(result))[0].versions[0].price).toBe(
      1500.5,
    );
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

  describe('setDefaultVersion', () => {
    const versionRow = {
      id: 'v2',
      planId: 'plan-1',
      version: 2,
      archivedAt: null,
      plan: { id: 'plan-1', name: 'Starter', isActive: true },
    };

    it('flips the default in one locked transaction and audits the previous default', async () => {
      prisma.planVersion.findUnique.mockResolvedValue(versionRow);
      prisma.planVersion.findFirst.mockResolvedValue({ id: 'v1' });

      const result = await service.setDefaultVersion(
        'plan-1',
        'v2',
        'actor-1',
      );

      expect(result).toEqual({
        id: 'v2',
        planId: 'plan-1',
        version: 2,
        isDefault: true,
      });
      // One transaction: advisory lock, clear-all, then set the new default.
      // A single UPDATE flipping every row at once violates the partial
      // unique index (Postgres checks it per row — found live 2026-11-17).
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
      const sql = prisma.$executeRaw.mock.calls
        .map(([strings]: any[]) => strings.join(''))
        .join('\n');
      expect(sql).toContain('pg_advisory_xact_lock');
      expect(sql).toContain('SET "isDefault" = false');
      expect(prisma.planVersion.update).toHaveBeenCalledWith({
        where: { id: 'v2' },
        data: { isDefault: true },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          action: 'plan.version.setDefault',
          entity: 'PlanVersion',
          entityId: 'v2',
          before: { previousDefaultId: 'v1' },
          after: { planId: 'plan-1', version: 2, isDefault: true },
        }),
      );
    });

    it('maps a concurrent-flip unique violation to a 409, not a 500', async () => {
      prisma.planVersion.findUnique.mockResolvedValue(versionRow);
      prisma.planVersion.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.$transaction.mockRejectedValueOnce(
        new Error(
          'duplicate key value violates unique constraint "PlanVersion_single_default_idx"',
        ),
      );
      await expect(
        service.setDefaultVersion('plan-1', 'v2', 'actor-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a missing version, a foreign version, an archived version and an inactive plan', async () => {
      prisma.planVersion.findUnique.mockResolvedValue(null);
      await expect(
        service.setDefaultVersion('plan-1', 'ghost'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.planVersion.findUnique.mockResolvedValue({
        ...versionRow,
        planId: 'other-plan',
      });
      await expect(
        service.setDefaultVersion('plan-1', 'v2'),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.planVersion.findUnique.mockResolvedValue({
        ...versionRow,
        archivedAt: new Date(),
      });
      await expect(
        service.setDefaultVersion('plan-1', 'v2'),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.planVersion.findUnique.mockResolvedValue({
        ...versionRow,
        plan: { ...versionRow.plan, isActive: false },
      });
      await expect(
        service.setDefaultVersion('plan-1', 'v2'),
      ).rejects.toThrow('inactive');
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });
});
