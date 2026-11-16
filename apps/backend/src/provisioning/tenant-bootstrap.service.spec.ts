import { TenantBootstrapService } from './tenant-bootstrap.service';

function makeService(existing = false) {
  const prisma: any = {
    userProfile: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
        existing && where.email ? { id: 'owner-existing' } : null,
      ),
      create: jest.fn().mockResolvedValue({ id: 'owner-1' }),
    },
    orderStatus: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { id: 'status-existing' } : null)),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: `status-${data.name}`,
      })),
      update: jest.fn().mockResolvedValue({}),
    },
    systemSetting: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { key: 'existing' } : null)),
      upsert: jest.fn().mockResolvedValue({}),
    },
    warehouse: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { id: 'wh-1' } : null)),
      create: jest.fn().mockResolvedValue({ id: 'wh-1' }),
    },
    paymentOption: { upsert: jest.fn().mockResolvedValue({}) },
    paymentGateway: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { id: 'gw-1' } : null)),
      create: jest.fn().mockResolvedValue({ id: 'gw-1' }),
    },
  };
  return {
    prisma,
    service: new TenantBootstrapService(prisma as any),
  };
}

const dto = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  slug: 'acme',
  name: 'Acme Store',
  ownerEmail: 'owner@example.com',
  ownerPhone: '+8801700000000',
  ownerName: 'Acme Owner',
  passwordHash: '$2b$12$hash',
  canonicalDomain: 'https://acme.ecomate.bd',
};

describe('TenantBootstrapService', () => {
  it('seeds owner, statuses, settings, warehouse and cash payment', async () => {
    const { service, prisma } = makeService();

    const result = await service.bootstrap(dto as any);

    expect(prisma.userProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'owner@example.com',
        username: 'owner',
        role: 'superadmin',
        status: 'active',
        emailVerified: true,
        password: dto.passwordHash,
      }),
      select: { id: true },
    });
    expect(prisma.orderStatus.create).toHaveBeenCalledTimes(16);
    expect(prisma.orderStatus.update).toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_key: expect.objectContaining({ key: 'canonical_domain' }),
      },
      update: {},
      create: { key: 'canonical_domain', value: 'https://acme.ecomate.bd' },
    });
    expect(prisma.warehouse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'main-showroom' }),
    });
    expect(prisma.paymentOption.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'CASH_ON_DELIVERY' } }),
    );
    expect(prisma.paymentGateway.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'cash',
        paymentOptionType: 'CASH_ON_DELIVERY',
        enabled: true,
      }),
    });
    expect(result).toMatchObject({
      tenantId: dto.tenantId,
      slug: 'acme',
      ownerUserId: 'owner-1',
      orderStatusesCreated: 16,
    });
  });

  it('is idempotent when a retry finds existing rows', async () => {
    const { service, prisma } = makeService(true);

    const result = await service.bootstrap(dto as any);

    expect(prisma.userProfile.create).not.toHaveBeenCalled();
    expect(prisma.orderStatus.create).not.toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    expect(prisma.warehouse.create).not.toHaveBeenCalled();
    expect(prisma.paymentGateway.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ownerUserId: 'owner-existing',
      orderStatusesCreated: 0,
      settingsCreated: 0,
    });
  });

  it('picks a unique username when the base one is taken', async () => {
    const { service, prisma } = makeService();
    let call = 0;
    prisma.userProfile.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.email) return null;
      call++;
      return call === 1 ? { id: 'taken' } : null;
    });

    await service.bootstrap(dto as any);
    expect(prisma.userProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ username: 'owner-1' }),
      select: { id: true },
    });
  });
});
