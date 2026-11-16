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
    invoice: { id: INVOICE_ID, total: 1500, currency: 'BDT' },
  };
  const prisma: any = {
    paymentProof: {
      findUnique: jest.fn().mockResolvedValue(proof),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([proof]),
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
    paymentMethod: { findMany: jest.fn().mockResolvedValue([]) },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: TENANT_ID, name: 'Acme' }),
    },
    subscription: {
      findMany: jest.fn().mockResolvedValue([]),
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
  return {
    prisma,
    audit,
    service: new BillingService(prisma as any, audit as any),
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
    const { service, prisma, audit } = makeService();

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
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: INVOICE_ID },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
    expect(result).toMatchObject({
      paymentId: 'payment-1',
      invoiceStatus: 'PAID',
      paidAmount: 1500,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.proof.approve' }),
    );
  });

  it('leaves the invoice open for a partial payment', async () => {
    const { service, prisma } = makeService();
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 500 } });

    const result = await service.approveProof(PROOF_ID);

    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(result.invoiceStatus).toBe('OPEN');
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
});
