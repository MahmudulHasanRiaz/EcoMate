import { BillingJobsService } from './billing-jobs.service';

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
  return {
    prisma,
    audit,
    invoices,
    tenants,
    mail,
    service: new BillingJobsService(
      prisma as any,
      audit as any,
      invoices as any,
      tenants as any,
      mail as any,
      settings as any,
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
      });
      expect(invoices.createInvoice).not.toHaveBeenCalled();
      expect(prisma.subscription.update).toHaveBeenCalledWith(
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
        currentPeriodEnd: new Date(Date.now() + 2 * DAY_MS),
        pendingPlanVersionId: null,
        pendingPlanVersion: null,
        pendingPlanEffectiveAt: null,
        tenant: {
          id: 'tenant-1',
          name: 'Acme',
          ownerEmail: 'owner@acme.test',
          status: 'ACTIVE',
        },
        planVersion: planVersion(),
        ...overrides,
      };
    }

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

      expect(results).toHaveLength(5);
      expect(results.map((r) => r.job)).toEqual([
        'trial-expiry',
        'renewal-invoices',
        'reminders',
        'grace-suspend',
        'cancel-at-period-end',
      ]);
      const status = service.status();
      expect(status.jobs).toHaveLength(5);
      expect(status.jobs.every((j) => j.lastRunAt !== null)).toBe(true);
    });
  });
});
