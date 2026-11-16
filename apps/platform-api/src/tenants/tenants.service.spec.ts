import { BadRequestException, ConflictException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

const prisma: any = {
  tenant: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  planVersion: {
    findUnique: jest.fn(),
  },
  subscription: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
};

const domainConfig = {
  getConfig: () => ({ primaryDomain: 'ecomate.bd' }),
};
const audit = { record: jest.fn() };
const settings = {
  getTrialDefaults: jest.fn().mockReturnValue({ trialDays: 30, graceDays: 10 }),
};

const service = new TenantsService(
  prisma,
  domainConfig as any,
  audit as any,
  settings as any,
);

const baseTenantDto = {
  slug: 'acme',
  name: 'Acme Store',
  ownerEmail: 'owner@acme.test',
  planVersionId: 'pv-1',
};

describe('TenantsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    audit.record.mockResolvedValue(undefined);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.tenant.update.mockImplementation(async ({ data }: any) => ({
      id: 'tenant-1',
      status: data.status ?? 'TRIAL',
      ...data,
    }));
  });

  it('creates a trial tenant, primary subdomain and subscription', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'pv-1',
      version: 1,
      trialDays: 14,
      features: ['admin_products'],
      limits: { products: 100 },
    });
    prisma.tenant.create.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
      name: 'Acme Store',
      status: 'TRIAL',
    });

    const result = await service.create(baseTenantDto as any, 'platform-user-1');

    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'acme',
          status: 'TRIAL',
          domains: {
            create: expect.objectContaining({
              host: 'acme.ecomate.bd',
              isPrimary: true,
            }),
          },
          subscription: expect.objectContaining({
            create: expect.objectContaining({
              planVersionId: 'pv-1',
              status: 'TRIAL',
            }),
          }),
        }),
      }),
    );
    expect(result.id).toBe('tenant-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.create', tenantId: 'tenant-1' }),
    );
  });

  it('uses the platform trial default when the plan version has no trial days', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'pv-1',
      version: 1,
      trialDays: undefined,
      features: [],
      limits: {},
    });
    prisma.tenant.create.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
      status: 'TRIAL',
    });

    await service.create(baseTenantDto as any, 'platform-user-1');

    const data = prisma.tenant.create.mock.calls[0][0].data;
    const expected = Date.now() + 30 * 86_400_000;
    expect(Math.abs(data.trialEndsAt.getTime() - expected)).toBeLessThan(
      60_000,
    );
  });

  it('explicit DTO trial days win over the platform default', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'pv-1',
      version: 1,
      trialDays: 14,
      features: [],
      limits: {},
    });
    prisma.tenant.create.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
      status: 'TRIAL',
    });

    await service.create(
      { ...baseTenantDto, trialDays: 5 } as any,
      'platform-user-1',
    );

    const data = prisma.tenant.create.mock.calls[0][0].data;
    const expected = Date.now() + 5 * 86_400_000;
    expect(Math.abs(data.trialEndsAt.getTime() - expected)).toBeLessThan(
      60_000,
    );
  });

  it('rejects a reserved slug', async () => {
    await expect(
      service.create({ ...baseTenantDto, slug: 'admin' } as any, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate slug', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create(baseTenantDto as any, 'u1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sets suspendedAt when a tenant is suspended', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'ACTIVE',
    });

    await service.updateStatus(
      'tenant-1',
      { status: 'SUSPENDED' } as any,
      'u1',
    );

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: expect.objectContaining({
        status: 'SUSPENDED',
        suspendedAt: expect.any(Date),
      }),
    });
  });

  it('extends a trial from the later of now and the current end', async () => {
    const future = new Date(Date.now() + 86_400_000);
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      trialEndsAt: future,
    });
    prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });

    await service.extendTrial('tenant-1', 7, 'u1');

    const update = prisma.tenant.update.mock.calls[0][0];
    expect(update.data.trialEndsAt.getTime()).toBe(
      future.getTime() + 7 * 86_400_000,
    );
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
      }),
    );
  });

  it('changes the plan and refreshes the subscription snapshot', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      planVersionId: 'old',
    });
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'new-version',
      features: ['admin_products'],
      limits: { products: 500 },
    });
    prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });

    await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version' } as any,
      'u1',
    );

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
        data: expect.objectContaining({ planVersionId: 'new-version' }),
      }),
    );
  });
});
