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
  subscriptionAddOn: {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  creditNote: {
    create: jest.fn().mockResolvedValue({ id: 'note-1' }),
  },
  signupRequest: {
    create: jest.fn(),
  },
  provisioningJob: {
    findFirst: jest.fn(),
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
const provisioning = {
  startForSignup: jest.fn(),
  retry: jest.fn(),
};
// Pricing resolution mirrors the real service's price-column fallback.
const pricing = {
  resolveForSubscription: jest.fn(
    async (_subscriptionId: string, version: any) => {
      const doc = version?.pricing ?? {};
      return {
        pricing: {
          ...doc,
          baseFee: doc.baseFee ?? {
            amount: Number(version?.price ?? 0),
            currency: version?.currency ?? 'BDT',
          },
          billingCycle: doc.billingCycle ?? 'MONTHLY',
        },
        addOns: [],
        sources: {},
      };
    },
  ),
  fetchPeriodUsage: jest.fn().mockResolvedValue({}),
};
// SMTP worker's service; create() grants the free email allowance.
const emailBalance = {
  grantFreeAllowance: jest.fn().mockResolvedValue(undefined),
};

const service = new TenantsService(
  prisma,
  domainConfig as any,
  audit as any,
  settings as any,
  invoices as any,
  mail as any,
  refresh as any,
  provisioning as any,
  pricing as any,
  emailBalance as any,
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
    // clearAllMocks keeps implementations, but a per-test override of the
    // usage read would leak into later tests — reset it explicitly.
    pricing.fetchPeriodUsage.mockResolvedValue({});
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
    expect((result as any).pendingPlanVersionId).toBe('new-version');
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

  it('applies a trial add-on selection on conversion: confirms kept, ends dropped, invoices kept', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
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
      status: 'PAST_DUE',
      currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-11-15T00:00:00.000Z'),
      planVersion: {
        price: 0,
        currency: 'BDT',
        plan: { name: 'Trial' },
      },
    });
    prisma.subscriptionAddOn.findMany.mockResolvedValue([
      {
        addOnId: 'addon-keep',
        confirmedAt: null,
        addOn: {
          id: 'addon-keep',
          name: 'Storefront',
          price: 999,
          currency: 'BDT',
        },
      },
      {
        addOnId: 'addon-drop',
        confirmedAt: null,
        addOn: {
          id: 'addon-drop',
          name: 'POS System',
          price: 499,
          currency: 'BDT',
        },
      },
    ]);

    const result = await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version', keepAddOnIds: ['addon-keep'] } as any,
      'u1',
    );

    // Kept: confirmed. Dropped: ended.
    expect(prisma.subscriptionAddOn.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscriptionId: 'sub-1',
          addOnId: { in: ['addon-keep'] },
          confirmedAt: null,
        }),
        data: { confirmedAt: expect.any(Date) },
      }),
    );
    expect(prisma.subscriptionAddOn.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscriptionId: 'sub-1',
          addOnId: { in: ['addon-drop'] },
          endedAt: null,
        }),
        data: { endedAt: expect.any(Date) },
      }),
    );
    // The conversion invoice is exactly what the tenant reviewed:
    // base fee + the kept add-on's fee (the dropped one is not billed).
    expect(invoices.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        subscriptionId: 'sub-1',
        lines: [
          {
            description: 'Growth subscription — plan change',
            quantity: 1,
            unitPrice: 2000,
          },
          {
            description: 'Storefront add-on — monthly',
            quantity: 1,
            unitPrice: 999,
          },
        ],
      }),
    );
    expect((result as any).keptAddOns).toEqual([
      { id: 'addon-keep', name: 'Storefront', price: 999, currency: 'BDT' },
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.addon.trial-selection' }),
    );
  });

  it('invoices kept add-ons even when the new plan is free', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
      planVersionId: 'old',
    });
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'new-version',
      features: ['admin_products'],
      limits: {},
      price: 0,
      currency: 'BDT',
      interval: 'MONTHLY',
      intervalDays: null,
      plan: { name: 'Free' },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'PAST_DUE',
      currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-11-15T00:00:00.000Z'),
      planVersion: { price: 0, currency: 'BDT', plan: { name: 'Trial' } },
    });
    prisma.subscriptionAddOn.findMany.mockResolvedValue([
      {
        addOnId: 'addon-keep',
        confirmedAt: null,
        addOn: {
          id: 'addon-keep',
          name: 'Storefront',
          price: 999,
          currency: 'BDT',
        },
      },
    ]);

    await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version', keepAddOnIds: ['addon-keep'] } as any,
      'u1',
    );

    expect(invoices.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          {
            description: 'Storefront add-on — monthly',
            quantity: 1,
            unitPrice: 999,
          },
        ],
      }),
    );
  });

  it('applies a trial add-on selection during a trial switch, with no invoice', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
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
      planVersion: { price: 0, currency: 'BDT', plan: { name: 'Trial' } },
    });
    prisma.subscriptionAddOn.findMany.mockResolvedValue([
      {
        addOnId: 'addon-keep',
        confirmedAt: null,
        addOn: {
          id: 'addon-keep',
          name: 'Storefront',
          price: 999,
          currency: 'BDT',
        },
      },
      {
        addOnId: 'addon-drop',
        confirmedAt: null,
        addOn: {
          id: 'addon-drop',
          name: 'POS System',
          price: 499,
          currency: 'BDT',
        },
      },
    ]);

    await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version', keepAddOnIds: ['addon-keep'] } as any,
      'u1',
    );

    expect(prisma.subscriptionAddOn.updateMany).toHaveBeenCalledTimes(2);
    expect(invoices.createInvoice).not.toHaveBeenCalled();
  });

  it('leaves trial add-ons untouched on a plain plan change (no selection)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
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
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
      planVersion: { price: 1000, currency: 'BDT', plan: { name: 'Starter' } },
    });

    await service.changePlan(
      'tenant-1',
      { planVersionId: 'new-version' } as any,
      'u1',
    );

    expect(prisma.subscriptionAddOn.findMany).not.toHaveBeenCalled();
    expect(prisma.subscriptionAddOn.updateMany).not.toHaveBeenCalled();
  });

  it('closes out a metered plan on change: prorated minimum, standalone invoice', async () => {
    // Freeze "now" mid-period: 15 of 30 days used, so the ৳500 minimum
    // prorates to ৳250.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-16T00:00:00.000Z'));
    try {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        slug: 'acme',
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
        freePeriodsRemaining: 2,
        planVersion: {
          price: 0,
          currency: 'BDT',
          plan: { name: 'Metered' },
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
      });
      pricing.fetchPeriodUsage.mockResolvedValue({ orders_per_month: 20 });

      const result = await service.changePlan(
        'tenant-1',
        { planVersionId: 'new-version' } as any,
        'u1',
      );

      expect(pricing.fetchPeriodUsage).toHaveBeenCalledWith(
        'tenant-1',
        'acme',
        new Date('2026-11-01T00:00:00.000Z'),
        new Date('2026-11-16T00:00:00.000Z'),
      );
      // Two invoices: the new plan (SUBSCRIPTION) + the close-out (METERED).
      expect(invoices.createInvoice).toHaveBeenCalledTimes(2);
      const newPlan = invoices.createInvoice.mock.calls[0][0];
      expect(newPlan).toMatchObject({
        kind: 'SUBSCRIPTION',
        subscriptionId: 'sub-1',
      });
      const closeOut = invoices.createInvoice.mock.calls[1][0];
      expect(closeOut.kind).toBe('METERED');
      // Standalone: paying it must not move the new subscription period.
      expect(closeOut).not.toHaveProperty('subscriptionId');
      expect(closeOut.periodStart).toEqual(
        new Date('2026-11-01T00:00:00.000Z'),
      );
      expect(closeOut.periodEnd).toEqual(
        new Date('2026-11-16T00:00:00.000Z'),
      );
      // 20 orders × ৳10 = ৳200, floored at the prorated ৳250 minimum.
      const total = closeOut.lines.reduce(
        (sum: number, line: any) => sum + line.unitPrice * line.quantity,
        0,
      );
      expect(total).toBe(250);
      expect((result as any).usageInvoice).toBeDefined();
      // Free months belong to the subscription, not the version: untouched.
      for (const call of prisma.subscription.update.mock.calls) {
        expect(call[0].data).not.toHaveProperty('freePeriodsRemaining');
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('aborts a metered plan change when the usage fetch fails', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
      planVersionId: 'old',
    });
    prisma.planVersion.findUnique.mockResolvedValue({
      id: 'new-version',
      features: [],
      limits: {},
      price: 2000,
      currency: 'BDT',
      interval: 'MONTHLY',
      intervalDays: null,
      plan: { name: 'Growth' },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
      currentPeriodStart: new Date(Date.now() - 10 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
      planVersion: {
        price: 0,
        currency: 'BDT',
        plan: { name: 'Metered' },
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
    });
    pricing.fetchPeriodUsage.mockRejectedValue(new Error('backend down'));

    await expect(
      service.changePlan('tenant-1', { planVersionId: 'new-version' } as any, 'u1'),
    ).rejects.toThrow('backend down');

    // The close-out read happens BEFORE any write — nothing moved.
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(invoices.createInvoice).not.toHaveBeenCalled();
    expect(prisma.creditNote.create).not.toHaveBeenCalled();
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

  it('provisions immediately when an owner password is given', async () => {
    prisma.tenant.findUnique
      .mockResolvedValueOnce(null) // slug check
      .mockResolvedValueOnce({
        // detail() re-fetch after the provisioning run
        id: 'tenant-1',
        slug: 'acme',
        status: 'TRIAL',
        provisioningJobs: [
          { id: 'job-1', status: 'SUCCEEDED', step: 'completed' },
        ],
      });
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
      ownerEmail: 'owner@acme.test',
      ownerPhone: null,
      status: 'PROVISIONING',
    });
    prisma.signupRequest.create.mockResolvedValue({ id: 'signup-1' });
    provisioning.startForSignup.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCEEDED',
      step: 'completed',
      error: null,
    });

    const result = await service.create(
      { ...baseTenantDto, ownerPassword: 'OwnerPass123' } as any,
      'platform-user-1',
    );

    // The tenant starts PROVISIONING — the run flips it to TRIAL.
    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROVISIONING' }),
      }),
    );
    // A synthetic VERIFIED signup carries the hashed owner password.
    expect(prisma.signupRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'acme',
          ownerEmail: 'owner@acme.test',
          status: 'VERIFIED',
        }),
      }),
    );
    const hash = prisma.signupRequest.create.mock.calls[0][0].data
      .passwordHash as string;
    expect(hash).not.toBe('OwnerPass123');
    expect(hash.startsWith('$2')).toBe(true);
    expect(provisioning.startForSignup).toHaveBeenCalledWith('signup-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.provisioning',
        tenantId: 'tenant-1',
      }),
    );
    // The caller sees the post-run state, not the pre-run snapshot.
    expect(result.status).toBe('TRIAL');
    expect((result as any).provisioningJobs[0].status).toBe('SUCCEEDED');
  });

  it('does not provision without an owner password', async () => {
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

    await service.create(baseTenantDto as any, 'platform-user-1');

    expect(prisma.signupRequest.create).not.toHaveBeenCalled();
    expect(provisioning.startForSignup).not.toHaveBeenCalled();
  });

  it('retries a failed provisioning job and audits it', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'PROVISIONING',
    });
    prisma.provisioningJob.findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
    });
    provisioning.retry.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCEEDED',
      step: 'completed',
    });

    const result = await service.retryProvisioning('tenant-1', 'u1');

    expect(provisioning.retry).toHaveBeenCalledWith('job-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.provisioning.retry',
        tenantId: 'tenant-1',
      }),
    );
    expect(result?.status).toBe('SUCCEEDED');
  });

  it('retry returns a succeeded job without re-running it', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.provisioningJob.findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCEEDED',
    });

    const result = await service.retryProvisioning('tenant-1', 'u1');

    expect(provisioning.retry).not.toHaveBeenCalled();
    expect(result?.status).toBe('SUCCEEDED');
  });

  it('retry with no job fails with a clear error', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    prisma.provisioningJob.findFirst.mockResolvedValue(null);

    await expect(service.retryProvisioning('tenant-1', 'u1')).rejects.toThrow(
      'no provisioning job',
    );
    expect(provisioning.retry).not.toHaveBeenCalled();
  });
});
