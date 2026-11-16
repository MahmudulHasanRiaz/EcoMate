import { TenantBootstrapService } from './tenant-bootstrap.service';

function makeService(existing = false) {
  const prisma: any = {
    userProfile: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
        existing && where.email ? { id: 'owner-existing' } : null,
      ),
      create: jest.fn().mockResolvedValue({ id: 'owner-1' }),
    },
    accessPreset: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { id: 'preset-existing' } : null)),
      create: jest.fn().mockResolvedValue({}),
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
    storeLocation: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { id: 'loc-1' } : null)),
      create: jest.fn().mockResolvedValue({ id: 'loc-1' }),
    },
    emailTemplate: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { id: 'tpl-1' } : null)),
      create: jest.fn().mockResolvedValue({ id: 'tpl-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    product: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    category: { create: jest.fn() },
    order: { count: jest.fn().mockResolvedValue(0) },
    employee: { count: jest.fn().mockResolvedValue(0) },
    cmsPage: { deleteMany: jest.fn().mockResolvedValue({ count: 13 }) },
    orderStatusTransition: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userSettings: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    paymentOption: { upsert: jest.fn().mockResolvedValue({}) },
    paymentGateway: {
      findFirst: jest
        .fn()
        .mockImplementation(async () => (existing ? { id: 'gw-1' } : null)),
      create: jest.fn().mockResolvedValue({ id: 'gw-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.userProfile.findMany = jest
    .fn()
    .mockResolvedValue([{ id: 'owner-1' }]);
  prisma.userProfile.deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  prisma.accessPreset.deleteMany = jest.fn().mockResolvedValue({ count: 2 });
  prisma.orderStatus.deleteMany = jest.fn().mockResolvedValue({ count: 16 });
  prisma.systemSetting.deleteMany = jest.fn().mockResolvedValue({ count: 10 });
  prisma.storeLocation.deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  prisma.warehouse.deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const cmsPages = {
    ensureTemplatePages: jest.fn().mockResolvedValue(13),
  };
  return {
    prisma,
    cmsPages,
    service: new TenantBootstrapService(prisma as any, cmsPages as any),
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
  it('seeds owner, presets, statuses, settings, stores, templates and pages', async () => {
    const { service, prisma, cmsPages } = makeService();

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

    expect(prisma.accessPreset.create).toHaveBeenCalledTimes(2);
    expect(prisma.accessPreset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Manager',
        isSystem: true,
        permissions: expect.arrayContaining(['view_orders']),
      }),
    });
    expect(prisma.accessPreset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Staff',
        isSystem: true,
        permissions: ['view_media', 'view_customer_reviews', 'approve_customer_reviews', 'view_cod_mismatch'],
      }),
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
    expect(prisma.storeLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Main Store', type: 'SHOWROOM' }),
    });
    expect(prisma.emailTemplate.create).toHaveBeenCalledTimes(2);
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
    expect(cmsPages.ensureTemplatePages).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      tenantId: dto.tenantId,
      slug: 'acme',
      ownerUserId: 'owner-1',
      presetsCreated: 2,
      orderStatusesCreated: 16,
      warehousesCreated: 1,
      storeLocationsCreated: 1,
      emailTemplatesCreated: 2,
      pagesCreated: 13,
    });
  });

  it('never seeds sample catalog data', async () => {
    const { service, prisma } = makeService();
    await service.bootstrap(dto as any);
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it('is idempotent when a retry finds existing rows', async () => {
    const { service, prisma, cmsPages } = makeService(true);
    cmsPages.ensureTemplatePages.mockResolvedValue(0);

    const result = await service.bootstrap(dto as any);

    expect(prisma.userProfile.create).not.toHaveBeenCalled();
    expect(prisma.accessPreset.create).not.toHaveBeenCalled();
    expect(prisma.orderStatus.create).not.toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
    expect(prisma.warehouse.create).not.toHaveBeenCalled();
    expect(prisma.storeLocation.create).not.toHaveBeenCalled();
    expect(prisma.emailTemplate.create).not.toHaveBeenCalled();
    expect(prisma.paymentGateway.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ownerUserId: 'owner-existing',
      presetsCreated: 0,
      orderStatusesCreated: 0,
      settingsCreated: 0,
      warehousesCreated: 0,
      storeLocationsCreated: 0,
      emailTemplatesCreated: 0,
      pagesCreated: 0,
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

  it('rolls back a partial seed', async () => {
    const { service, prisma } = makeService();

    const result = await service.rollback({
      tenantId: dto.tenantId,
      slug: dto.slug,
    });

    expect(prisma.cmsPage.deleteMany).toHaveBeenCalled();
    expect(prisma.emailTemplate.deleteMany).toHaveBeenCalled();
    expect(prisma.accessPreset.deleteMany).toHaveBeenCalled();
    expect(prisma.orderStatus.deleteMany).toHaveBeenCalled();
    expect(prisma.systemSetting.deleteMany).toHaveBeenCalled();
    expect(prisma.storeLocation.deleteMany).toHaveBeenCalled();
    expect(prisma.warehouse.deleteMany).toHaveBeenCalled();
    expect(prisma.userSettings.deleteMany).toHaveBeenCalledWith({
      where: { userId: { in: ['owner-1'] } },
    });
    expect(prisma.userProfile.deleteMany).toHaveBeenCalled();
    expect(result).toMatchObject({
      tenantId: dto.tenantId,
      deleted: {
        cmsPages: 13,
        emailTemplates: 2,
        accessPresets: 2,
        orderStatuses: 16,
        systemSettings: 10,
        users: 1,
      },
    });
  });

  it('refuses rollback once the tenant has business data', async () => {
    const { service, prisma } = makeService();
    prisma.product.count.mockResolvedValue(1);

    await expect(
      service.rollback({ tenantId: dto.tenantId, slug: dto.slug }),
    ).rejects.toThrow('already contains business data');
    expect(prisma.cmsPage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userProfile.deleteMany).not.toHaveBeenCalled();
  });
});
