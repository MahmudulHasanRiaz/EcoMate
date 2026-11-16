import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { BillingService } from './billing.service';

const PROOF_ID = '11111111-1111-4111-8111-111111111111';
const INVOICE_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';

function makeService() {
  const proof = {
    id: PROOF_ID,
    invoiceId: INVOICE_ID,
    tenantId: TENANT_ID,
    methodId: 'method-1',
    amount: 1500,
    transactionId: 'TX-1',
    status: 'PENDING',
    invoice: {
      id: INVOICE_ID,
      number: 'INV-2611-0001',
      total: 1500,
      currency: 'BDT',
      subscriptionId: null,
      periodStart: null,
      periodEnd: null,
    },
    tenant: {
      id: TENANT_ID,
      name: 'Acme',
      slug: 'acme',
      status: 'ACTIVE',
      ownerEmail: 'owner@acme.test',
    },
  };
  const prisma: any = {
    paymentProof: {
      findUnique: jest.fn().mockResolvedValue(proof),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([proof]),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: 'proof-new', ...data })),
    },
    payment: {
      create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1500 } }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoice: {
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    paymentMethod: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'method-1', isActive: true, name: 'bKash' }),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: TENANT_ID, name: 'Acme' }),
      update: jest.fn().mockResolvedValue({}),
    },
    subscription: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    creditNote: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue({
        id: 'note-1',
        tenantId: TENANT_ID,
        amount: 250,
        currency: 'BDT',
        reason: 'Goodwill',
        appliedInvoiceId: null,
      }),
    },
    coupon: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue({
        id: 'coupon-1',
        code: 'SAVE10',
        isActive: true,
        maxRedemptions: 10,
        redeemedCount: 2,
        expiresAt: null,
      }),
      create: jest.fn().mockResolvedValue({
        id: 'coupon-1',
        code: 'SAVE10',
      }),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'coupon-1',
        ...data,
      })),
    },
  };
  prisma.$transaction = jest.fn(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const invoices = {
    settleInvoice: jest.fn().mockResolvedValue({
      status: 'PAID',
      paidAmount: 1500,
      total: 1500,
    }),
    balanceOf: jest.fn().mockReturnValue({
      paidAmount: 1500,
      creditAmount: 0,
      remaining: 0,
    }),
    createInvoice: jest.fn(),
    applyOpenCredit: jest.fn().mockResolvedValue(0),
  };
  const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-')) };
  const mail = {
    sendPaymentApproved: jest.fn().mockResolvedValue({ delivered: false }),
    sendPaymentRejected: jest.fn().mockResolvedValue({ delivered: false }),
    sendInvoice: jest.fn().mockResolvedValue({ delivered: false }),
  };
  const refresh = {
    pushRefresh: jest.fn().mockResolvedValue({ ok: true }),
  };
  const settings = {
    getTax: jest.fn().mockReturnValue({ ratePercent: 0, inclusive: false }),
    getBranding: jest
      .fn()
      .mockReturnValue({ platformName: 'EcoMate', supportEmail: 'support@test' }),
  };
  return {
    prisma,
    audit,
    invoices,
    mail,
    refresh,
    service: new BillingService(
      prisma as any,
      audit as any,
      invoices as any,
      pdf as any,
      mail as any,
      refresh as any,
      settings as any,
    ),
  };
}

describe('BillingService', () => {
  it('lists the pending proof queue with tenant and invoice context', async () => {
    const { service, prisma } = makeService();
    const result = await service.proofQueue({ status: 'PENDING' });

    expect(prisma.paymentProof.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
        include: expect.objectContaining({
          tenant: expect.any(Object),
          invoice: expect.any(Object),
          method: expect.any(Object),
        }),
      }),
    );
    expect(result.meta.total).toBe(1);
  });

  it('approves a proof, records a payment and marks the invoice paid', async () => {
    const { service, prisma, audit, invoices, mail, refresh } = makeService();

    const result = await service.approveProof(PROOF_ID, 'admin-1');

    expect(prisma.paymentProof.updateMany).toHaveBeenCalledWith({
      where: { id: PROOF_ID, status: 'PENDING' },
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedBy: 'admin-1',
        reviewedAt: expect.any(Date),
      }),
    });
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invoiceId: INVOICE_ID,
        tenantId: TENANT_ID,
        proofId: PROOF_ID,
        amount: 1500,
        currency: 'BDT',
        reference: 'TX-1',
        recordedBy: 'admin-1',
      }),
    });
    expect(invoices.settleInvoice).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      expect.any(Date),
    );
    expect(result).toMatchObject({
      paymentId: 'payment-1',
      invoiceStatus: 'PAID',
      paidAmount: 1500,
      overpaymentCredit: 0,
      reactivated: false,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.proof.approve' }),
    );
    expect(mail.sendPaymentApproved).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@acme.test',
        invoiceNumber: 'INV-2611-0001',
      }),
    );
    expect(refresh.pushRefresh).toHaveBeenCalledWith('acme');
  });

  it('leaves the invoice open for a partial payment', async () => {
    const { service, invoices, mail, refresh } = makeService();
    invoices.settleInvoice.mockResolvedValue({
      status: 'OPEN',
      paidAmount: 500,
      total: 1500,
    });

    const result = await service.approveProof(PROOF_ID);

    expect(result.invoiceStatus).toBe('OPEN');
    expect(result.paidAmount).toBe(500);
    // Partial payment: no extension, no approval mail, no refresh push.
    expect(mail.sendPaymentApproved).not.toHaveBeenCalled();
    expect(refresh.pushRefresh).not.toHaveBeenCalled();
  });

  it('refuses a proof whose transaction id already paid another invoice', async () => {
    const { service, prisma } = makeService();
    prisma.paymentProof.findFirst.mockResolvedValue({
      id: 'other-proof',
      invoiceId: 'other-invoice',
    });

    await expect(service.approveProof(PROOF_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('turns an overpayment into open credit', async () => {
    const { service, prisma, invoices } = makeService();
    invoices.settleInvoice.mockResolvedValue({
      status: 'PAID',
      paidAmount: 2000,
      total: 1500,
    });

    const result = await service.approveProof(PROOF_ID);

    expect(result.overpaymentCredit).toBe(500);
    expect(prisma.creditNote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        amount: 500,
        reason: 'Overpayment on invoice INV-2611-0001',
        appliedInvoiceId: null,
      }),
    });
  });

  it('does not reactivate a trial tenant paying a manual invoice', async () => {
    const { service, prisma } = makeService();
    prisma.paymentProof.findUnique.mockResolvedValue({
      id: PROOF_ID,
      invoiceId: INVOICE_ID,
      tenantId: TENANT_ID,
      methodId: 'method-1',
      amount: 1500,
      transactionId: 'TX-1',
      status: 'PENDING',
      invoice: {
        id: INVOICE_ID,
        number: 'INV-2611-0001',
        total: 1500,
        currency: 'BDT',
        subscriptionId: null,
        periodStart: null,
        periodEnd: null,
      },
      tenant: {
        id: TENANT_ID,
        name: 'Acme',
        slug: 'acme',
        status: 'TRIAL',
        ownerEmail: 'owner@acme.test',
      },
    });

    const result = await service.approveProof(PROOF_ID);

    expect(result.invoiceStatus).toBe('PAID');
    expect(result.reactivated).toBe(false);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('extends the subscription and reactivates a past-due tenant on full payment', async () => {
    const { service, prisma, invoices } = makeService();
    const periodEnd = new Date('2026-12-16T00:00:00.000Z');
    prisma.paymentProof.findUnique.mockResolvedValue({
      id: PROOF_ID,
      invoiceId: INVOICE_ID,
      tenantId: TENANT_ID,
      methodId: 'method-1',
      amount: 1500,
      transactionId: 'TX-1',
      status: 'PENDING',
      invoice: {
        id: INVOICE_ID,
        number: 'INV-2611-0001',
        total: 1500,
        currency: 'BDT',
        subscriptionId: 'sub-1',
        periodStart: new Date('2026-11-16T00:00:00.000Z'),
        periodEnd,
      },
      tenant: {
        id: TENANT_ID,
        name: 'Acme',
        slug: 'acme',
        status: 'PAST_DUE',
        ownerEmail: 'owner@acme.test',
      },
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      currentPeriodEnd: new Date('2026-11-16T00:00:00.000Z'),
      planVersion: {
        interval: 'MONTHLY',
        intervalDays: null,
        features: ['a'],
        limits: {},
      },
    });

    const result = await service.approveProof(PROOF_ID);

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        status: 'ACTIVE',
        currentPeriodEnd: periodEnd,
      }),
    });
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      data: expect.objectContaining({ status: 'ACTIVE' }),
    });
    expect(result.reactivated).toBe(true);
    expect(result.currentPeriodEnd).toEqual(periodEnd);
    expect(invoices.settleInvoice).toHaveBeenCalled();
  });

  it('refuses to review an already reviewed proof', async () => {
    const { service, prisma } = makeService();
    prisma.paymentProof.findUnique.mockResolvedValue({
      id: PROOF_ID,
      invoiceId: INVOICE_ID,
      tenantId: TENANT_ID,
      status: 'APPROVED',
      amount: 1500,
      transactionId: 'TX-1',
      invoice: { total: 1500, currency: 'BDT' },
    });

    await expect(service.approveProof(PROOF_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('rejects with a required reason and audits it', async () => {
    const { service, prisma, audit } = makeService();

    const result = await service.rejectProof(PROOF_ID, 'Wrong transaction', 'admin-1');

    expect(prisma.paymentProof.updateMany).toHaveBeenCalledWith({
      where: { id: PROOF_ID, status: 'PENDING' },
      data: expect.objectContaining({
        status: 'REJECTED',
        rejectionReason: 'Wrong transaction',
        reviewedBy: 'admin-1',
      }),
    });
    expect(result.status).toBe('REJECTED');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.proof.reject' }),
    );

    await expect(service.rejectProof(PROOF_ID, '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('summarises pending proofs, open invoices and collected money', async () => {
    const { service, prisma } = makeService();
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 4200 } });

    const result = await service.summary();

    expect(result).toEqual({
      pendingProofs: 1,
      openInvoices: 2,
      overdueInvoices: 2,
      collectedAmount: 4200,
    });
  });

  it('lists subscriptions with tenant, plan and add-ons', async () => {
    const { service, prisma } = makeService();
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        tenantId: TENANT_ID,
        status: 'TRIAL',
        tenant: { name: 'Acme' },
        planVersion: { version: 1, plan: { name: 'Trial' } },
        addOns: [],
      },
    ]);

    const result = await service.subscriptions({ status: 'TRIAL' });

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'TRIAL' },
        include: expect.objectContaining({
          tenant: expect.any(Object),
          planVersion: expect.any(Object),
          addOns: expect.any(Object),
        }),
      }),
    );
    expect(result.meta.total).toBe(1);
  });

  it('creates a credit note only for the matching tenant invoice', async () => {
    const { service, prisma, audit } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
    prisma.invoice.findUnique.mockResolvedValue({
      id: INVOICE_ID,
      tenantId: TENANT_ID,
    });

    const note = await service.createCreditNote(
      {
        tenantId: TENANT_ID,
        amount: 250,
        reason: 'Goodwill',
        appliedInvoiceId: INVOICE_ID,
      },
      'admin-1',
    );

    expect(prisma.creditNote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_ID,
        amount: 250,
        currency: 'BDT',
        appliedInvoiceId: INVOICE_ID,
      }),
      include: expect.any(Object),
    });
    expect(note.id).toBe('note-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.credit_note.create' }),
    );

    prisma.invoice.findUnique.mockResolvedValue({
      id: INVOICE_ID,
      tenantId: 'other-tenant',
    });
    await expect(
      service.createCreditNote({
        tenantId: TENANT_ID,
        amount: 250,
        reason: 'Goodwill',
        appliedInvoiceId: INVOICE_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates and creates coupons', async () => {
    const { service, prisma, audit } = makeService();

    const coupon = await service.createCoupon(
      {
        code: 'save10',
        type: 'PERCENT',
        value: 10,
        duration: 'ONCE',
      },
      'admin-1',
    );

    expect(prisma.coupon.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'SAVE10',
        type: 'PERCENT',
        value: 10,
        isActive: true,
      }),
    });
    expect(coupon.id).toBe('coupon-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.coupon.create' }),
    );

    await expect(
      service.createCoupon({
        code: 'BAD',
        type: 'PERCENT',
        value: 120,
        duration: 'ONCE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createCoupon({
        code: 'MONTHLY',
        type: 'FIXED',
        value: 100,
        duration: 'MONTHS',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('toggles coupon active state', async () => {
    const { service, prisma, audit } = makeService();

    const result = await service.updateCoupon(
      'coupon-1',
      { isActive: false },
      'admin-1',
    );

    expect(prisma.coupon.update).toHaveBeenCalledWith({
      where: { id: 'coupon-1' },
      data: { isActive: false },
    });
    expect(result.isActive).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.coupon.update' }),
    );
  });

  describe('submitProof', () => {
    const dto = {
      invoiceId: INVOICE_ID,
      methodId: 'method-1',
      amount: 1150,
      transactionId: 'TX-9',
    };

    function mockOpenInvoice(prisma: any) {
      prisma.invoice.findUnique.mockResolvedValue({
        id: INVOICE_ID,
        tenantId: TENANT_ID,
        status: 'OPEN',
        number: 'INV-2611-0001',
      });
    }

    it('creates a PENDING proof and audits the submission', async () => {
      const { service, prisma, audit } = makeService();
      mockOpenInvoice(prisma);

      const proof = await service.submitProof(TENANT_ID, dto as any);

      expect(proof.status).toBe('PENDING');
      expect(prisma.paymentProof.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoiceId: INVOICE_ID,
            tenantId: TENANT_ID,
            transactionId: 'TX-9',
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.proof.submit' }),
      );
    });

    it('refuses an invoice from another tenant or one that is not OPEN', async () => {
      const { service, prisma } = makeService();
      prisma.invoice.findUnique.mockResolvedValue({
        id: INVOICE_ID,
        tenantId: 'other-tenant',
        status: 'OPEN',
        number: 'INV-2611-0001',
      });
      await expect(service.submitProof(TENANT_ID, dto as any)).rejects.toThrow(
        'does not belong to this tenant',
      );

      prisma.invoice.findUnique.mockResolvedValue({
        id: INVOICE_ID,
        tenantId: TENANT_ID,
        status: 'PAID',
        number: 'INV-2611-0001',
      });
      await expect(service.submitProof(TENANT_ID, dto as any)).rejects.toThrow(
        'cannot take a payment proof',
      );
    });

    it('refuses an inactive method and a duplicate transaction id', async () => {
      const { service, prisma } = makeService();
      mockOpenInvoice(prisma);
      prisma.paymentMethod.findUnique.mockResolvedValue({
        id: 'method-1',
        isActive: false,
        name: 'bKash',
      });
      await expect(service.submitProof(TENANT_ID, dto as any)).rejects.toThrow(
        'not active',
      );

      prisma.paymentMethod.findUnique.mockResolvedValue({
        id: 'method-1',
        isActive: true,
        name: 'bKash',
      });
      prisma.paymentProof.findFirst.mockResolvedValue({ id: 'proof-old' });
      await expect(service.submitProof(TENANT_ID, dto as any)).rejects.toThrow(
        'already submitted for this payment method',
      );
    });
  });
});
