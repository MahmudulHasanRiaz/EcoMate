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
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn(),
  },
  creditNote: {
    create: jest.fn().mockResolvedValue({ id: 'note-1' }),
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
const invoices = {
  createInvoice: jest
    .fn()
    .mockResolvedValue({ id: 'inv-1', number: 'INV-2611-0001' }),
};
const mail = {
  sendSuspension: jest.fn().mockResolvedValue({ delivered: false }),
  sendReactivation: jest.fn().mockResolvedValue({ delivered: false }),
};
const refresh = {
  pushRefresh: jest.fn().mockResolvedValue({ ok: true }),
};

const service = new TenantsService(
  prisma,
  domainConfig as any,
  audit as any,
  settings as any,
  invoices as any,
  mail as any,
  refresh as any,
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

  it('restores a suspended trial subscription when the tenant returns to TRIAL', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'SUSPENDED',
      suspendedAt: new Date(),
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'SUSPENDED',
    });

    await service.updateStatus('tenant-1', { status: 'TRIAL' } as any, 'u1');

    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: expect.objectContaining({
        status: 'TRIAL',
        suspendedAt: null,
        graceEndsAt: null,
      }),
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { status: 'TRIAL' },
    });
  });

  it('leaves a non-suspended subscription alone on a TRIAL restore', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'TRIAL',
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'TRIAL',
    });

    await service.updateStatus('tenant-1', { status: 'TRIAL' } as any, 'u1');

    expect(prisma.subscription.update).not.toHaveBeenCalled();
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
      price: 2000,
      currency: 'BDT',
      interval: 'MONTHLY',
      intervalDays: null,
      plan: { name: 'Growth' },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
      planVersion: {
        price: 1000,
        currency: 'BDT',
        plan: { name: 'Starter' },
      },
    });

    await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version' } as any,
      'u1',
    );

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          planVersionId: 'new-version',
          entitlementsSnapshot: expect.objectContaining({
            features: ['admin_products'],
            limits: { products: 500 },
          }),
        }),
      }),
    );
    // Paid plan change: a new invoice is issued for the new plan price.
    expect(invoices.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
    );
  });

  it('schedules a next-period plan change instead of applying it now', async () => {
    const periodEnd = new Date('2026-12-01T00:00:00.000Z');
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      planVersionId: 'old',
    });
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'new-version',
      features: [],
      limits: {},
      plan: { name: 'Growth' },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
      currentPeriodEnd: periodEnd,
    });

    const result = await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version', effectiveAt: 'next_period' } as any,
      'u1',
    );

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: {
        pendingPlanVersionId: 'new-version',
        pendingPlanEffectiveAt: periodEnd,
      },
    });
    expect(result.pendingPlanVersionId).toBe('new-version');
    expect(invoices.createInvoice).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.plan.change.scheduled' }),
    );
  });

  it('switches a trial subscription without invoicing or proration', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      planVersionId: 'old',
    });
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'new-version',
      features: ['admin_products'],
      limits: {},
      price: 2000,
      currency: 'BDT',
      interval: 'MONTHLY',
      intervalDays: null,
      plan: { name: 'Growth' },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'TRIAL',
      currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-11-15T00:00:00.000Z'),
      planVersion: {
        price: 1000,
        currency: 'BDT',
        plan: { name: 'Starter' },
      },
    });

    await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version' } as any,
      'u1',
    );

    expect(prisma.creditNote.create).not.toHaveBeenCalled();
    expect(invoices.createInvoice).not.toHaveBeenCalled();
    // Trial dates are kept: no new period on the subscription update.
    const data = prisma.subscription.update.mock.calls[0][0].data;
    expect(data.currentPeriodStart).toBeUndefined();
    expect(data.currentPeriodEnd).toBeUndefined();
  });

  it('cancels at period end by default and immediately when asked', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'ACTIVE',
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
    });

    await service.cancel('tenant-1', {} as any, 'u1');
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { cancelAtPeriodEnd: true },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.cancel' }),
    );

    jest.clearAllMocks();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'ACTIVE',
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
    });
    await service.cancel('tenant-1', { atPeriodEnd: false } as any, 'u1');
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });
});
