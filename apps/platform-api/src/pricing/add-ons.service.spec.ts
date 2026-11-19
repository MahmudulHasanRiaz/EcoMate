import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AddOnsService } from './add-ons.service';

function makeService() {
  const prisma: any = {
    addOn: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    subscriptionAddOn: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscription: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenant: {
      findUnique: jest.fn(),
    },
    plan: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    feature: {
      findUnique: jest.fn(),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const invoiceService = { createInvoice: jest.fn() };
  const refresh = {
    pushRefresh: jest.fn().mockResolvedValue({ ok: true }),
  };
  const plansService = {
    addVersion: jest.fn(),
    applyVersion: jest.fn(),
  };
  const service = new AddOnsService(
    prisma,
    audit as any,
    invoiceService as any,
    refresh as any,
    plansService as any,
  );
  return { service, prisma, invoiceService, plansService, audit, refresh };
}

const ADD_ON = {
  id: 'addon-1',
  slug: 'unified-inbox',
  name: 'Unified Inbox',
  price: 1000,
  currency: 'BDT',
  features: ['inbox'],
  limits: { inbox_accounts: 5 },
  metering: null,
  isPublic: true,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
};

function subscription(daysLeft = 15, totalDays = 30) {
  const start = new Date('2026-11-01T00:00:00.000Z');
  const end = new Date(start.getTime() + totalDays * 86_400_000);
  const now = new Date(end.getTime() - daysLeft * 86_400_000);
  return {
    id: 'sub-1',
    tenantId: 'tenant-1',
    status: 'ACTIVE',
    currentPeriodStart: start,
    currentPeriodEnd: end,
    planVersion: { id: 'v1', price: 1000, currency: 'BDT', pricing: {} },
    tenant: { slug: 'acme' },
    _now: now,
  };
}

describe('AddOnsService.attach', () => {
  it('attaches immediately with a prorated MANUAL invoice', async () => {
    const { service, prisma, invoiceService } = makeService();
    const sub = subscription(15, 30);
    // Fake timers: `new Date()` inside the service ignores a Date.now mock.
    jest.useFakeTimers();
    jest.setSystemTime(sub._now);
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.addOn.findUnique.mockResolvedValue(ADD_ON);
    prisma.subscription.findUnique.mockResolvedValue(sub);
    prisma.subscriptionAddOn.findUnique.mockResolvedValue(null);
    prisma.subscriptionAddOn.create.mockResolvedValue({
      id: 'sa-1',
      addOnId: 'addon-1',
      subscriptionId: 'sub-1',
      startedAt: sub._now,
    });
    invoiceService.createInvoice.mockResolvedValue({
      id: 'inv-1',
      number: 'INV-1',
      total: 500,
      status: 'OPEN',
    });

    const result = await service.attach('tenant-1', 'addon-1', {
      effectiveAt: 'immediate',
    });

    // Half the period remains: 1000 × 15/30 = 500.
    const invoiceInput = invoiceService.createInvoice.mock.calls[0][0];
    expect(invoiceInput).toMatchObject({
      tenantId: 'tenant-1',
      kind: 'MANUAL',
      metadata: { addOnId: 'addon-1', attachProration: true },
    });
    expect(invoiceInput.lines).toEqual([
      {
        description:
          'Unified Inbox add-on — prorated (15 of 30 days remaining)',
        quantity: 1,
        unitPrice: 500,
      },
    ]);
    // A proration invoice must NOT extend the subscription.
    expect(invoiceInput).not.toHaveProperty('subscriptionId');
    expect(result.invoice?.id).toBe('inv-1');
    jest.useRealTimers();
  });

  it('attaches next_period with no invoice and a future start', async () => {
    const { service, prisma, invoiceService } = makeService();
    const sub = subscription(15, 30);
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.addOn.findUnique.mockResolvedValue(ADD_ON);
    prisma.subscription.findUnique.mockResolvedValue(sub);
    prisma.subscriptionAddOn.findUnique.mockResolvedValue(null);
    prisma.subscriptionAddOn.create.mockResolvedValue({
      id: 'sa-1',
      startedAt: sub.currentPeriodEnd,
    });

    const result = await service.attach('tenant-1', 'addon-1', {
      effectiveAt: 'next_period',
    });

    expect(prisma.subscriptionAddOn.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startedAt: sub.currentPeriodEnd,
      }),
    });
    expect(invoiceService.createInvoice).not.toHaveBeenCalled();
    expect(result.invoice).toBeNull();
  });

  it('rejects attaching an already-active add-on', async () => {
    const { service, prisma } = makeService();
    const sub = subscription();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.addOn.findUnique.mockResolvedValue(ADD_ON);
    prisma.subscription.findUnique.mockResolvedValue(sub);
    prisma.subscriptionAddOn.findUnique.mockResolvedValue({
      id: 'sa-0',
      startedAt: new Date('2026-11-01T00:00:00.000Z'),
      endedAt: null,
    });

    await expect(
      service.attach('tenant-1', 'addon-1', { effectiveAt: 'immediate' }),
    ).rejects.toThrow('already attached');
  });

  it('throws 404 for an unknown add-on', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.addOn.findUnique.mockResolvedValue(null);

    await expect(
      service.attach('tenant-1', 'nope', { effectiveAt: 'immediate' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects attaching an archived add-on', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.addOn.findUnique.mockResolvedValue({ ...ADD_ON, isActive: false });
    prisma.subscription.findUnique.mockResolvedValue(subscription());

    await expect(
      service.attach('tenant-1', 'addon-1', { effectiveAt: 'immediate' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AddOnsService.detach', () => {
  function attachedRow() {
    return {
      id: 'sa-1',
      startedAt: new Date('2026-11-01T00:00:00.000Z'),
      endedAt: null,
    };
  }

  it('ends an immediate detach now and pushes a refresh', async () => {
    const { service, prisma, refresh } = makeService();
    const sub = subscription();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.subscription.findUnique.mockResolvedValue(sub);
    prisma.subscriptionAddOn.findUnique.mockResolvedValue(attachedRow());
    prisma.subscriptionAddOn.update.mockResolvedValue({
      id: 'sa-1',
      endedAt: new Date(),
    });

    const result = await service.detach('tenant-1', 'addon-1', {
      effectiveAt: 'immediate',
    });

    expect(prisma.subscriptionAddOn.update).toHaveBeenCalledWith({
      where: { id: 'sa-1' },
      data: expect.objectContaining({ endedAt: expect.any(Date) }),
    });
    expect(refresh.pushRefresh).toHaveBeenCalledWith('acme');
    expect(result.endedAt).toBeInstanceOf(Date);
  });

  it('schedules a next-period detach at the period end', async () => {
    const { service, prisma } = makeService();
    const sub = subscription();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.subscription.findUnique.mockResolvedValue(sub);
    prisma.subscriptionAddOn.findUnique.mockResolvedValue(attachedRow());
    prisma.subscriptionAddOn.update.mockResolvedValue({
      id: 'sa-1',
      endedAt: sub.currentPeriodEnd,
    });

    await service.detach('tenant-1', 'addon-1', {
      effectiveAt: 'next_period',
    });

    expect(prisma.subscriptionAddOn.update).toHaveBeenCalledWith({
      where: { id: 'sa-1' },
      data: { endedAt: sub.currentPeriodEnd },
    });
  });

  it('throws 404 when the add-on is not attached', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      slug: 'acme',
    });
    prisma.subscription.findUnique.mockResolvedValue(subscription());
    prisma.subscriptionAddOn.findUnique.mockResolvedValue(null);

    await expect(
      service.detach('tenant-1', 'addon-1', { effectiveAt: 'immediate' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AddOnsService.convertFromFeature', () => {
  const FEATURE = { key: 'inbox', name: 'Unified Inbox' };
  const PLANS = [
    {
      id: 'plan-1',
      name: 'Growth',
      versions: [
        {
          id: 'v1',
          planId: 'plan-1',
          version: 1,
          price: 1000,
          currency: 'BDT',
          interval: 'MONTHLY',
          intervalDays: null,
          trialDays: 14,
          graceDays: 3,
          features: ['inbox', 'pos'],
          limits: {},
        },
      ],
    },
    {
      id: 'plan-2',
      name: 'Starter',
      versions: [
        {
          id: 'v9',
          planId: 'plan-2',
          version: 1,
          features: ['pos'],
        },
      ],
    },
  ];
  const SUBSCRIPTIONS = [
    {
      id: 'sub-1',
      tenantId: 'tenant-1',
      tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' },
      planVersion: { id: 'v1', planId: 'plan-1' },
    },
  ];

  function mockScope(prisma: any) {
    prisma.feature.findUnique.mockResolvedValue(FEATURE);
    prisma.plan.findMany.mockResolvedValue(PLANS);
    prisma.subscription.findMany.mockResolvedValue(SUBSCRIPTIONS);
  }

  it('dry-run reports the plan versions and tenants without writing', async () => {
    const { service, prisma, plansService } = makeService();
    mockScope(prisma);

    const result = await service.convertFromFeature({
      featureKey: 'inbox',
      price: 1000,
      name: 'Unified Inbox',
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.affectedPlans).toHaveLength(1);
    expect(result.affectedPlans?.[0]).toEqual({
      planId: 'plan-1',
      planName: 'Growth',
      latestVersionId: 'v1',
    });
    expect(result.affectedTenants).toBe(1);
    expect(result.tenants[0]).toMatchObject({
      tenantId: 'tenant-1',
      tenantSlug: 'acme',
    });
    expect(prisma.addOn.create).not.toHaveBeenCalled();
    expect(plansService.applyVersion).not.toHaveBeenCalled();
  });

  it('apply creates the add-on, grandfather-attaches tenants, then re-versions', async () => {
    const { service, prisma, plansService } = makeService();
    mockScope(prisma);
    prisma.addOn.findUnique.mockResolvedValue(null);
    prisma.addOn.create.mockResolvedValue({ ...ADD_ON, id: 'addon-new' });

    const order: string[] = [];
    prisma.subscriptionAddOn.upsert.mockImplementation(async () => {
      order.push('attach');
      return { id: 'sa-1' };
    });
    plansService.addVersion.mockImplementation(async () => {
      order.push('addVersion');
      return { id: 'v2', version: 2 };
    });
    plansService.applyVersion.mockImplementation(async () => {
      order.push('applyVersion');
      return {};
    });

    const result = await service.convertFromFeature({
      featureKey: 'inbox',
      price: 1000,
      name: 'Unified Inbox',
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    expect(result.addOnId).toBe('addon-new');
    expect(result.attached).toBe(1);
    expect(result.plans).toEqual([
      { planId: 'plan-1', versionId: 'v2', version: 2 },
    ]);
    // Attach-first: grandfathered tenants get the add-on BEFORE the plan
    // loses the feature, so there is no window without access.
    expect(order).toEqual(['attach', 'addVersion', 'applyVersion']);
    // The new version drops the feature but keeps everything else.
    expect(plansService.addVersion).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({
        features: ['pos'],
        price: 1000,
        trialDays: 14,
        graceDays: 3,
      }),
      undefined,
    );
    // Grandfathered attach is free — no invoice is created.
    expect(prisma.addOn.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'inbox',
        features: ['inbox'],
        price: 1000,
      }),
    });
  });

  it('refuses to convert a feature that does not exist', async () => {
    const { service, prisma } = makeService();
    prisma.feature.findUnique.mockResolvedValue(null);

    await expect(
      service.convertFromFeature({ featureKey: 'ghost', price: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses when an add-on with the same slug already exists', async () => {
    const { service, prisma } = makeService();
    mockScope(prisma);
    prisma.addOn.findUnique.mockResolvedValue(ADD_ON);

    await expect(
      service.convertFromFeature({
        featureKey: 'inbox',
        price: 1000,
        dryRun: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
