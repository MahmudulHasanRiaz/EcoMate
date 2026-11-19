import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchasesService } from './purchases.service';

const PLAN_VERSION = {
  id: 'v1',
  price: 1000,
  currency: 'BDT',
  pricing: {
    pricingVersion: 1,
    baseFee: { amount: 1000, currency: 'BDT' },
    billingCycle: 'MONTHLY',
    oneTimeFees: [
      {
        key: 'extra-products',
        label: 'Extra products pack',
        amount: 500,
        effect: {
          type: 'limit_increase',
          limits: { products: 200 },
        },
      },
      {
        key: 'lifetime-pro',
        label: 'Lifetime pro rate',
        amount: 20000,
        effect: { type: 'rate_tier', perOrderRate: 1.5 },
      },
    ],
  },
};

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(),
    },
    tenantPurchase: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    invoice: {
      update: jest.fn(),
    },
  };
  // The cancel path runs inside $transaction; hand the callback the same
  // mock prisma so the inner calls land on the mocks above.
  prisma.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(prisma));
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const invoiceService = { createInvoice: jest.fn() };
  const service = new PurchasesService(
    prisma,
    audit as any,
    invoiceService as any,
  );
  return { service, prisma, invoiceService, audit };
}

function tenantWithPlan() {
  return {
    id: 'tenant-1',
    slug: 'acme',
    subscription: { id: 'sub-1', planVersion: PLAN_VERSION },
  };
}

describe('PurchasesService.createPurchase', () => {
  it('creates a PENDING purchase and a ONE_TIME invoice from a plan fee', async () => {
    const { service, prisma, invoiceService, audit } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(tenantWithPlan());
    prisma.tenantPurchase.create.mockResolvedValue({
      id: 'pur-1',
      feeKey: 'extra-products',
      status: 'PENDING',
    });
    invoiceService.createInvoice.mockResolvedValue({
      id: 'inv-1',
      number: 'INV-1',
      total: 500,
      status: 'OPEN',
      paidAt: null,
    });
    prisma.tenantPurchase.update.mockResolvedValue({
      id: 'pur-1',
      feeKey: 'extra-products',
      status: 'PENDING',
      invoice: { id: 'inv-1', number: 'INV-1', status: 'OPEN', total: 500 },
    });

    const result = await service.createPurchase(
      'tenant-1',
      { feeKey: 'extra-products' },
      'admin-1',
    );

    expect(prisma.tenantPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        subscriptionId: 'sub-1',
        feeKey: 'extra-products',
        label: 'Extra products pack',
        status: 'PENDING',
        type: 'LIMIT_INCREASE',
      }),
    });
    const invoiceInput = invoiceService.createInvoice.mock.calls[0][0];
    expect(invoiceInput).toMatchObject({
      tenantId: 'tenant-1',
      subscriptionId: 'sub-1',
      kind: 'ONE_TIME',
      metadata: {
        purchaseId: 'pur-1',
        feeKey: 'extra-products',
        effectType: 'limit_increase',
      },
    });
    expect(invoiceInput.lines).toEqual([
      {
        description: 'One-time purchase — Extra products pack',
        quantity: 1,
        unitPrice: 500,
      },
    ]);
    expect(prisma.tenantPurchase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pur-1' },
        data: { invoiceId: 'inv-1' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.purchase.create' }),
    );
    expect(result.invoice?.total).toBe(500);
  });

  it('creates an ad-hoc purchase from a custom fee', async () => {
    const { service, prisma, invoiceService } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(tenantWithPlan());
    prisma.tenantPurchase.create.mockResolvedValue({
      id: 'pur-2',
      feeKey: 'custom-xyz',
      status: 'PENDING',
    });
    invoiceService.createInvoice.mockResolvedValue({
      id: 'inv-2',
      number: 'INV-2',
      total: 3000,
      status: 'OPEN',
    });
    prisma.tenantPurchase.update.mockResolvedValue({
      id: 'pur-2',
      invoice: { id: 'inv-2', total: 3000 },
    });

    await service.createPurchase(
      'tenant-1',
      {
        custom: {
          label: 'One-off onboarding',
          amount: 3000,
          effect: { type: 'setup' },
        },
      },
      'admin-1',
    );

    expect(prisma.tenantPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'SETUP_FEE',
        label: 'One-off onboarding',
        amount: 3000,
      }),
    });
    const invoiceInput = invoiceService.createInvoice.mock.calls[0][0];
    expect(invoiceInput.lines).toEqual([
      {
        description: 'One-time purchase — One-off onboarding',
        quantity: 1,
        unitPrice: 3000,
      },
    ]);
  });

  it('rejects a custom rate_tier with an invalid rate', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(tenantWithPlan());

    await expect(
      service.createPurchase(
        'tenant-1',
        {
          custom: {
            label: 'Bad rate',
            amount: 100,
            effect: { type: 'rate_tier', perOrderRate: -1 },
          },
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a feeKey that is not on the current plan version', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(tenantWithPlan());

    await expect(
      service.createPurchase('tenant-1', { feeKey: 'no-such-fee' }, 'admin-1'),
    ).rejects.toThrow('No one-time fee "no-such-fee"');
  });

  it('rejects feeKey and custom together', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(tenantWithPlan());

    await expect(
      service.createPurchase(
        'tenant-1',
        {
          feeKey: 'extra-products',
          custom: { label: 'X', amount: 1, effect: { type: 'setup' } },
        },
        'admin-1',
      ),
    ).rejects.toThrow('Provide exactly one of feeKey or custom');
  });

  it('rejects a purchase for an unknown tenant', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue(null);

    await expect(
      service.createPurchase('tenant-1', { feeKey: 'extra-products' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a custom purchase without a subscription (subscriptionId null)', async () => {
    const { service, prisma, invoiceService } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      subscription: null,
    });
    prisma.tenantPurchase.create.mockResolvedValue({
      id: 'pur-3',
      status: 'PENDING',
    });
    invoiceService.createInvoice.mockResolvedValue({
      id: 'inv-3',
      number: 'INV-3',
      total: 100,
      status: 'OPEN',
    });
    prisma.tenantPurchase.update.mockResolvedValue({
      id: 'pur-3',
      invoice: { id: 'inv-3', total: 100 },
    });

    await service.createPurchase(
      'tenant-1',
      {
        custom: {
          label: 'Setup',
          amount: 100,
          effect: { type: 'setup' },
        },
      },
      'admin-1',
    );

    expect(prisma.tenantPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ subscriptionId: null }),
    });
    expect(invoiceService.createInvoice.mock.calls[0][0].subscriptionId).toBe(
      undefined,
    );
  });
});

describe('PurchasesService.cancelPurchase', () => {
  it('voids the OPEN invoice and marks the purchase CANCELLED', async () => {
    const { service, prisma, audit } = makeService();
    prisma.tenantPurchase.findUnique.mockResolvedValue({
      id: 'pur-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      invoiceId: 'inv-1',
      invoice: { id: 'inv-1', status: 'OPEN', number: 'INV-1' },
    });
    prisma.tenantPurchase.update.mockResolvedValue({
      id: 'pur-1',
      status: 'CANCELLED',
    });

    const result = await service.cancelPurchase('tenant-1', 'pur-1', 'admin-1');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'VOID' },
    });
    expect(prisma.tenantPurchase.update).toHaveBeenCalledWith({
      where: { id: 'pur-1' },
      data: { status: 'CANCELLED' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.purchase.cancel' }),
    );
    expect(result.status).toBe('CANCELLED');
  });

  it('refuses to cancel a non-PENDING purchase', async () => {
    const { service, prisma } = makeService();
    prisma.tenantPurchase.findUnique.mockResolvedValue({
      id: 'pur-1',
      tenantId: 'tenant-1',
      status: 'APPLIED',
      invoiceId: 'inv-1',
      invoice: { id: 'inv-1', status: 'PAID' },
    });

    await expect(
      service.cancelPurchase('tenant-1', 'pur-1', 'admin-1'),
    ).rejects.toThrow('Only a PENDING purchase can be cancelled');
  });

  it('refuses to cancel when the invoice is no longer OPEN', async () => {
    const { service, prisma } = makeService();
    prisma.tenantPurchase.findUnique.mockResolvedValue({
      id: 'pur-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      invoiceId: 'inv-1',
      invoice: { id: 'inv-1', status: 'PAID' },
    });

    await expect(
      service.cancelPurchase('tenant-1', 'pur-1', 'admin-1'),
    ).rejects.toThrow('cannot be voided');
  });
});
