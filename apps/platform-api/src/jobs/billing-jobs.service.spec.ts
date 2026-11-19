import { BILLING_JOB_BATCH_SIZE, BillingJobsService } from './billing-jobs.service';

const DAY_MS = 86_400_000;

function planVersion(overrides: Record<string, unknown> = {}) {
  return {
    price: 1000,
    currency: 'BDT',
    interval: 'MONTHLY',
    intervalDays: null,
    graceDays: 7,
    features: ['admin_products'],
    limits: { products: 100 },
    plan: { name: 'Growth' },
    ...overrides,
  };
}

function makeService() {
  const prisma: any = {
    subscription: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    invoiceReminder: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'rem-1' }),
    },
  };
  prisma.$transaction = jest.fn(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const invoices = {
    createInvoice: jest.fn().mockResolvedValue({
      id: 'inv-1',
      number: 'INV-2611-0001',
      total: 1150,
      currency: 'BDT',
    }),
  };
  const tenants = {
    updateStatus: jest.fn().mockResolvedValue({}),
  };
  const mail = {
    sendTrialEnding: jest.fn().mockResolvedValue({ delivered: true }),
    sendInvoice: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const settings = {
    getTrialDefaults: jest
      .fn()
      .mockReturnValue({ trialDays: 14, graceDays: 7 }),
  };
  // Pricing resolution mirrors the real service's price-column fallback:
  // a version with no pricing doc bills its price as a fixed base fee.
  const pricing = {
    resolveForSubscription: jest.fn(
      async (_subscriptionId: string, version: any) => {
        const doc = version?.pricing ?? {};
        return {
          pricing: {
            ...doc,
            baseFee: doc.baseFee ?? {
              amount: version?.price ?? 0,
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
  // SMTP worker's param (email-balance jobs). runAll runs those jobs too,
  // so the mock stubs their entry points with zero-count results.
  const emailBalance = {
    expireLots: jest.fn().mockResolvedValue({
      lotsExpired: 0,
      emailsExpired: 0,
      tenantsAffected: 0,
    }),
    warnExpiringLots: jest.fn().mockResolvedValue({ warningsSent: 0 }),
    reconcile: jest.fn().mockResolvedValue({ checked: 0, drifted: 0 }),
  };
  return {
    prisma,
    audit,
    invoices,
    tenants,
    mail,
    pricing,
    service: new BillingJobsService(
      prisma as any,
      audit as any,
      invoices as any,
      tenants as any,
      mail as any,
      settings as any,
      pricing as any,
      emailBalance as any,
    ),
  };
}

describe('BillingJobsService', () => {
  describe('trial-expiry', () => {
    it('reminds once before expiry, then invoices and moves to PAST_DUE', async () => {
      const { service, prisma, invoices, mail, audit } = makeService();
      const now = Date.now();
      const endingSoon = {
        id: 'sub-ending',
        tenantId: 'tenant-1',
        status: 'TRIAL',
        trialEndsAt: new Date(now + 2 * DAY_MS),
        tenant: {
          id: 'tenant-1',
          name: 'Acme',
          ownerEmail: 'owner@acme.test',
          status: 'TRIAL',
        },
        planVersion: planVersion(),
      };
      const expired = {
        id: 'sub-expired',
        tenantId: 'tenant-2',
        status: 'TRIAL',
        trialEndsAt: new Date(now - DAY_MS),
        tenant: {
          id: 'tenant-2',
          name: 'Beta',
          ownerEmail: 'owner@beta.test',
          status: 'TRIAL',
        },
        planVersion: planVersion(),
      };
      prisma.subscription.findMany
        .mockResolvedValueOnce([endingSoon])
        .mockResolvedValueOnce([expired]);

      const result = await service.runJob('trial-expiry');

      expect(result.counts).toEqual({
        trialsExpired: 1,
        invoicesCreated: 1,
        trialEndingReminders: 1,
        freePeriodsStarted: 0,
      });
      expect(mail.sendTrialEnding).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@acme.test' }),
      );
      expect(invoices.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-2',
          subscriptionId: 'sub-expired',
        }),
      );
      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-2' },
          data: expect.objectContaining({
            status: 'PAST_DUE',
            graceEndsAt: expect.any(Date),
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.job.trial-expired' }),
      );
    });

    it('does not remind twice for the same trial', async () => {
      const { service, prisma, mail } = makeService();
      prisma.subscription.findMany
        .mockResolvedValueOnce([
          {
            id: 'sub-1',
            tenantId: 'tenant-1',
            status: 'TRIAL',
            trialEndsAt: new Date(Date.now() + 2 * DAY_MS),
            tenant: {
              id: 'tenant-1',
              name: 'Acme',
              ownerEmail: 'owner@acme.test',
              status: 'TRIAL',
            },
            planVersion: planVersion(),
          },
        ])
        .mockResolvedValueOnce([]);
      prisma.invoiceReminder.findUnique.mockResolvedValue({ id: 'rem-1' });

      const result = await service.runJob('trial-expiry');

      expect(result.counts.trialEndingReminders).toBe(0);
      expect(mail.sendTrialEnding).not.toHaveBeenCalled();
    });

    it('rolls a free-plan trial to ACTIVE with no invoice', async () => {
      const { service, prisma, invoices } = makeService();
      prisma.subscription.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'sub-free',
            tenantId: 'tenant-3',
            status: 'TRIAL',
            trialEndsAt: new Date(Date.now() - DAY_MS),
            tenant: {
              id: 'tenant-3',
              name: 'Free',
              ownerEmail: 'owner@free.test',
              status: 'TRIAL',
            },
            planVersion: planVersion({ price: 0 }),
          },
        ]);

      const result = await service.runJob('trial-expiry');

      expect(result.counts).toEqual({
        trialsExpired: 1,
        invoicesCreated: 0,
        trialEndingReminders: 0,
        freePeriodsStarted: 0,
      });
      expect(invoices.createInvoice).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });

    it('starts free months on trial expiry: ACTIVE, counter set, no invoice', async () => {
      const { service, prisma, invoices } = makeService();
      prisma.subscription.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'sub-freemonths',
            tenantId: 'tenant-4',
            status: 'TRIAL',
            trialEndsAt: new Date(Date.now() - DAY_MS),
            freePeriodsRemaining: 0,
            tenant: {
              id: 'tenant-4',
              name: 'FreeMonths',
              ownerEmail: 'owner@fm.test',
              status: 'TRIAL',
            },
            planVersion: planVersion({
              pricing: {
                pricingVersion: 1,
                baseFee: { amount: 1000, currency: 'BDT' },
                billingCycle: 'MONTHLY',
                freeMonths: 2,
              },
            }),
          },
        ]);

      const result = await service.runJob('trial-expiry');

      expect(result.counts).toMatchObject({
        trialsExpired: 1,
        invoicesCreated: 0,
        freePeriodsStarted: 1,
      });
      expect(invoices.createInvoice).not.toHaveBeenCalled();
      // The period starting now IS the first free period — no decrement.
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ACTIVE',
            freePeriodsRemaining: 2,
          }),
        }),
      );
      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });
  });

  describe('renewal-invoices', () => {
    function activeSub(overrides: Record<string, unknown> = {}) {
      return {
        id: 'sub-1',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        planVersionId: 'pv-1',
        currentPeriodStart: new Date(Date.now() - 28 * DAY_MS),
        currentPeriodEnd: new Date(Date.now() + 2 * DAY_MS),
        freePeriodsRemaining: 0,
        pendingPlanVersionId: null,
        pendingPlanVersion: null,
        pendingPlanEffectiveAt: null,
        tenant: {
          id: 'tenant-1',
          name: 'Acme',
          slug: 'acme',
          ownerEmail: 'owner@acme.test',
          status: 'ACTIVE',
        },
        planVersion: planVersion(),
        ...overrides,
      };
    }

    const METERED_VERSION = planVersion({
      price: 0,
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
    });

    it('invoices a period ending soon and leaves the tenant ACTIVE', async () => {
      const { service, prisma, invoices } = makeService();
      prisma.subscription.findMany.mockResolvedValue([activeSub()]);

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.invoicesCreated).toBe(1);
      expect(result.counts.expiredToPastDue).toBe(0);
      expect(invoices.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: 'sub-1' }),
      );
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('moves an ended period to PAST_DUE with a grace window', async () => {
      const { service, prisma } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({ currentPeriodEnd: new Date(Date.now() - DAY_MS) }),
      ]);

      const result = await service.runJob('renewal-invoices');

      expect(result.counts).toMatchObject({
        invoicesCreated: 1,
        expiredToPastDue: 1,
      });
      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PAST_DUE',
            graceEndsAt: expect.any(Date),
          }),
        }),
      );
    });

    it('does not create a second invoice when one is already open', async () => {
      const { service, prisma, invoices } = makeService();
      prisma.subscription.findMany.mockResolvedValue([activeSub()]);
      prisma.invoice.findFirst.mockResolvedValue({ id: 'inv-open' });

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.invoicesCreated).toBe(0);
      expect(invoices.createInvoice).not.toHaveBeenCalled();
    });

    it('applies a pending plan change before invoicing the new price', async () => {
      const { service, prisma, invoices, audit } = makeService();
      const pending = planVersion({ price: 2500, plan: { name: 'Scale' } });
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({
          pendingPlanVersionId: 'pv-2',
          pendingPlanVersion: pending,
          pendingPlanEffectiveAt: new Date(Date.now() + 2 * DAY_MS),
        }),
      ]);

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.pendingApplied).toBe(1);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planVersionId: 'pv-2',
            pendingPlanVersionId: null,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.plan.change',
          after: expect.objectContaining({ source: 'pending-plan-change' }),
        }),
      );
      const lines = invoices.createInvoice.mock.calls[0][0].lines;
      expect(lines[0].unitPrice).toBe(2500);
    });

    it('does not bill a metered plan before the period ends', async () => {
      const { service, prisma, invoices, pricing } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({ planVersion: METERED_VERSION }),
      ]);

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.invoicesCreated).toBe(0);
      expect(invoices.createInvoice).not.toHaveBeenCalled();
      expect(pricing.fetchPeriodUsage).not.toHaveBeenCalled();
    });

    it('bills a metered period at period end: max(minimum, usage)', async () => {
      const { service, prisma, invoices, pricing } = makeService();
      const ended = activeSub({
        planVersion: METERED_VERSION,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      });
      prisma.subscription.findMany.mockResolvedValue([ended]);
      pricing.fetchPeriodUsage.mockResolvedValue({ orders_per_month: 30 });

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.invoicesCreated).toBe(1);
      expect(result.counts.expiredToPastDue).toBe(1);
      expect(pricing.fetchPeriodUsage).toHaveBeenCalledWith(
        'tenant-1',
        'acme',
        ended.currentPeriodStart,
        ended.currentPeriodEnd,
      );
      const input = invoices.createInvoice.mock.calls[0][0];
      expect(input.kind).toBe('METERED');
      expect(input.periodStart).toEqual(ended.currentPeriodStart);
      expect(input.periodEnd).toEqual(ended.currentPeriodEnd);
      // 30 orders × ৳10 = ৳300, floored at the ৳500 minimum.
      const total = input.lines.reduce(
        (sum: number, line: any) => sum + line.unitPrice * line.quantity,
        0,
      );
      expect(total).toBe(500);
      // The trace records the minimum that was applied (৳500), not a flag.
      expect(input.metadata).toEqual(
        expect.objectContaining({ minimumApplied: 500 }),
      );
    });

    it('records an error and retries later when the usage fetch fails', async () => {
      const { service, prisma, invoices, pricing } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({
          planVersion: METERED_VERSION,
          currentPeriodEnd: new Date(Date.now() - DAY_MS),
        }),
      ]);
      pricing.fetchPeriodUsage.mockRejectedValue(
        new Error('backend unreachable'),
      );

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.invoicesCreated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('usage unavailable');
      expect(invoices.createInvoice).not.toHaveBeenCalled();
      // Never billed from a guessed number — and not moved to PAST_DUE.
      expect(prisma.tenant.update).not.toHaveBeenCalled();
    });

    it('does not create a second METERED invoice for the same period', async () => {
      const { service, prisma, invoices, pricing } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({
          planVersion: METERED_VERSION,
          currentPeriodEnd: new Date(Date.now() - DAY_MS),
        }),
      ]);
      pricing.fetchPeriodUsage.mockResolvedValue({ orders_per_month: 120 });
      prisma.invoice.findFirst.mockResolvedValue({ id: 'inv-open-metered' });

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.invoicesCreated).toBe(0);
      expect(invoices.createInvoice).not.toHaveBeenCalled();
    });

    it('rolls a zero-bill metered period with no invoice', async () => {
      const { service, prisma, invoices, pricing } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({
          planVersion: planVersion({
            price: 0,
            pricing: {
              pricingVersion: 1,
              baseFee: { amount: 0, currency: 'BDT' },
              billingCycle: 'MONTHLY',
              metering: {
                metric: 'orders_per_month',
                included: 0,
                ratePerUnit: 10,
                minimumMonthly: null,
              },
            },
          }),
          currentPeriodEnd: new Date(Date.now() - DAY_MS),
        }),
      ]);
      pricing.fetchPeriodUsage.mockResolvedValue({ orders_per_month: 0 });

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.zeroBillRolls).toBe(1);
      expect(result.counts.invoicesCreated).toBe(0);
      expect(invoices.createInvoice).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentPeriodStart: expect.any(Date),
            currentPeriodEnd: expect.any(Date),
          }),
        }),
      );
    });

    it('consumes a free month on renewal with no invoice (fixed plan)', async () => {
      const { service, prisma, invoices } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({ freePeriodsRemaining: 2 }),
      ]);

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.freePeriodsConsumed).toBe(1);
      expect(result.counts.invoicesCreated).toBe(0);
      expect(invoices.createInvoice).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            freePeriodsRemaining: { decrement: 1 },
          }),
        }),
      );
    });

    it('consumes a free month for a metered plan without reading usage', async () => {
      const { service, prisma, invoices, pricing } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({
          planVersion: METERED_VERSION,
          currentPeriodEnd: new Date(Date.now() - DAY_MS),
          freePeriodsRemaining: 1,
        }),
      ]);

      const result = await service.runJob('renewal-invoices');

      expect(result.counts.freePeriodsConsumed).toBe(1);
      expect(pricing.fetchPeriodUsage).not.toHaveBeenCalled();
      expect(invoices.createInvoice).not.toHaveBeenCalled();
    });

    it('uses a 1-day lead for a 7-day cycle', async () => {
      const { service, prisma, invoices } = makeService();
      const weekly = planVersion({
        interval: 'CUSTOM',
        intervalDays: 7,
      });
      // Period ends in 2 days: outside the 1-day lead, no invoice yet.
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({ planVersion: weekly }),
      ]);

      const skipped = await service.runJob('renewal-invoices');
      expect(skipped.counts.invoicesCreated).toBe(0);

      // Period ends in 12 hours: inside the lead, invoice now.
      prisma.subscription.findMany.mockResolvedValue([
        activeSub({
          planVersion: weekly,
          currentPeriodEnd: new Date(Date.now() + 12 * 3_600_000),
        }),
      ]);
      const invoiced = await service.runJob('renewal-invoices');
      expect(invoiced.counts.invoicesCreated).toBe(1);
      expect(invoices.createInvoice).toHaveBeenCalledTimes(1);
    });
  });

  describe('reminders', () => {
    it('sends DUE_SOON and OVERDUE once each and skips far-future invoices', async () => {
      const { service, prisma, mail } = makeService();
      const now = Date.now();
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-soon',
          number: 'INV-1',
          tenantId: 'tenant-1',
          total: 1000,
          currency: 'BDT',
          dueAt: new Date(now + 2 * DAY_MS),
          periodStart: null,
          periodEnd: null,
          tenant: {
            id: 'tenant-1',
            name: 'Acme',
            ownerEmail: 'owner@acme.test',
            status: 'ACTIVE',
          },
        },
        {
          id: 'inv-overdue',
          number: 'INV-2',
          tenantId: 'tenant-2',
          total: 2000,
          currency: 'BDT',
          dueAt: new Date(now - DAY_MS),
          periodStart: null,
          periodEnd: null,
          tenant: {
            id: 'tenant-2',
            name: 'Beta',
            ownerEmail: 'owner@beta.test',
            status: 'PAST_DUE',
          },
        },
        {
          id: 'inv-far',
          number: 'INV-3',
          tenantId: 'tenant-3',
          total: 3000,
          currency: 'BDT',
          dueAt: new Date(now + 30 * DAY_MS),
          periodStart: null,
          periodEnd: null,
          tenant: {
            id: 'tenant-3',
            name: 'Gamma',
            ownerEmail: 'owner@gamma.test',
            status: 'ACTIVE',
          },
        },
      ]);

      const result = await service.runJob('reminders');

      expect(result.counts).toEqual({ dueSoon: 1, overdue: 1 });
      expect(mail.sendInvoice).toHaveBeenCalledTimes(2);
      expect(prisma.invoiceReminder.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          kind: 'DUE_SOON',
          referenceId: 'inv-soon',
        },
      });
      expect(prisma.invoiceReminder.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-2',
          kind: 'OVERDUE',
          referenceId: 'inv-overdue',
        },
      });
    });
  });

  describe('grace-suspend', () => {
    it('suspends past-grace tenants and cancels long-suspended ones', async () => {
      const { service, prisma, tenants } = makeService();
      prisma.tenant.findMany
        .mockResolvedValueOnce([{ id: 'tenant-1', slug: 'acme' }])
        .mockResolvedValueOnce([{ id: 'tenant-2' }]);

      const result = await service.runJob('grace-suspend');

      expect(result.counts).toEqual({ suspended: 1, cancelled: 1 });
      expect(tenants.updateStatus).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ status: 'SUSPENDED' }),
      );
      expect(tenants.updateStatus).toHaveBeenCalledWith(
        'tenant-2',
        expect.objectContaining({ status: 'CANCELLED' }),
      );
    });
  });

  describe('cancel-at-period-end', () => {
    it('cancels subscriptions whose period ended and skips deleted tenants', async () => {
      const { service, prisma, audit } = makeService();
      prisma.subscription.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          tenantId: 'tenant-1',
          tenant: { id: 'tenant-1', status: 'ACTIVE' },
        },
        {
          id: 'sub-2',
          tenantId: 'tenant-2',
          tenant: { id: 'tenant-2', status: 'DELETED' },
        },
      ]);

      const result = await service.runJob('cancel-at-period-end');

      expect(result.counts).toEqual({ cancelled: 1 });
      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
      expect(prisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-1' },
          data: { status: 'CANCELLED' },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.job.cancelled-at-period-end',
        }),
      );
    });
  });

  describe('runAll / status', () => {
    it('runs every job and records the last runs', async () => {
      const { service } = makeService();
      const results = await service.runAll();

      expect(results).toHaveLength(7);
      expect(results.map((r) => r.job)).toEqual([
        'trial-expiry',
        'renewal-invoices',
        'reminders',
        'grace-suspend',
        'cancel-at-period-end',
        'email-balance-expiry',
        'email-balance-reconcile',
      ]);
      const status = service.status();
      expect(status.jobs).toHaveLength(7);
      expect(status.jobs.every((j) => j.lastRunAt !== null)).toBe(true);
    });
  });

  describe('scan bounds', () => {
    it('bounds every scan with take + an orderBy on the date column', async () => {
      const { service, prisma } = makeService();
      await service.runAll();

      // subscription.findMany: trial endingSoon, trial expired, renewal
      // dueSoon, cancel-at-period-end — in JOB_NAMES order.
      expect(prisma.subscription.findMany).toHaveBeenCalledTimes(4);
      expect(prisma.subscription.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          take: BILLING_JOB_BATCH_SIZE,
          orderBy: { trialEndsAt: 'asc' },
        }),
      );
      expect(prisma.subscription.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          take: BILLING_JOB_BATCH_SIZE,
          orderBy: { trialEndsAt: 'asc' },
        }),
      );
      expect(prisma.subscription.findMany).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          take: BILLING_JOB_BATCH_SIZE,
          orderBy: { currentPeriodEnd: 'asc' },
        }),
      );
      expect(prisma.subscription.findMany).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({
          take: BILLING_JOB_BATCH_SIZE,
          orderBy: { currentPeriodEnd: 'asc' },
        }),
      );

      // tenant.findMany: past-grace suspend, stale-suspended cancel.
      expect(prisma.tenant.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.tenant.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          take: BILLING_JOB_BATCH_SIZE,
          orderBy: { graceEndsAt: 'asc' },
        }),
      );
      expect(prisma.tenant.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          take: BILLING_JOB_BATCH_SIZE,
          orderBy: { suspendedAt: 'asc' },
        }),
      );
    });

    it('pushes the dueAt window into the reminders query', async () => {
      const { service, prisma } = makeService();
      const before = Date.now();
      await service.runJob('reminders');
      const after = Date.now();

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: BILLING_JOB_BATCH_SIZE,
          orderBy: { dueAt: 'asc' },
        }),
      );
      const where = prisma.invoice.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('OPEN');
      const lte = where.dueAt.lte as Date;
      // dueAt <= now + 3 days (RENEWAL_NOTICE_DAYS), measured around the run.
      expect(lte.getTime()).toBeGreaterThanOrEqual(before + 3 * DAY_MS);
      expect(lte.getTime()).toBeLessThanOrEqual(after + 3 * DAY_MS);
    });

    it('warns when a scan hits the batch cap', async () => {
      const { service, prisma } = makeService();
      const warn = jest.spyOn((service as any).logger, 'warn');
      const pastGrace = Array.from({ length: BILLING_JOB_BATCH_SIZE }, (_, i) => ({
        id: `tenant-${i}`,
        slug: `tenant-${i}`,
      }));
      prisma.tenant.findMany
        .mockResolvedValueOnce(pastGrace)
        .mockResolvedValueOnce([]);

      await service.runJob('grace-suspend');

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('hit the 500-row cap'),
      );
      warn.mockRestore();
    });

    it('does not warn when scans are under the cap', async () => {
      const { service } = makeService();
      const warn = jest.spyOn((service as any).logger, 'warn');
      await service.runAll();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
