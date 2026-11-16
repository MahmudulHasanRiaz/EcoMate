import { BadRequestException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';

const TENANT_ID = '33333333-3333-4333-8333-333333333333';

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: TENANT_ID, name: 'Acme', slug: 'acme' }),
    },
    invoice: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    creditNote: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'note-new' }),
    },
  };
  prisma.$transaction = jest.fn(async (arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
  );
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    getTax: jest.fn().mockReturnValue({
      ratePercent: 15,
      label: 'VAT',
      inclusive: false,
    }),
  };
  return {
    prisma,
    audit,
    settings,
    service: new InvoiceService(prisma as any, audit as any, settings as any),
  };
}

describe('InvoiceService', () => {
  describe('balanceOf', () => {
    it('counts payments and applied credit against the total', () => {
      const { service } = makeService();
      expect(
        service.balanceOf({
          total: 1500,
          payments: [{ amount: 500 }, { amount: 250 }],
          creditNotes: [{ amount: 100 }],
        }),
      ).toEqual({ paidAmount: 750, creditAmount: 100, remaining: 650 });
    });

    it('never reports a negative remaining balance', () => {
      const { service } = makeService();
      expect(
        service.balanceOf({
          total: 100,
          payments: [{ amount: 500 }],
          creditNotes: [],
        }).remaining,
      ).toBe(0);
    });
  });

  describe('nextInvoiceNumber', () => {
    it('numbers sequentially within the month', async () => {
      const { service, prisma } = makeService();
      prisma.invoice.count.mockResolvedValue(2);
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(
        service.nextInvoiceNumber(prisma, new Date('2026-11-16T00:00:00.000Z')),
      ).resolves.toBe('INV-2611-0003');
    });

    it('skips a number that already exists', async () => {
      const { service, prisma } = makeService();
      prisma.invoice.count.mockResolvedValue(0);
      prisma.invoice.findUnique
        .mockResolvedValueOnce({ id: 'taken' })
        .mockResolvedValueOnce(null);
      await expect(
        service.nextInvoiceNumber(prisma, new Date('2026-11-16T00:00:00.000Z')),
      ).resolves.toBe('INV-2611-0002');
    });
  });

  describe('settleInvoice', () => {
    it('marks a fully covered invoice PAID', async () => {
      const { service, prisma } = makeService();
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        status: 'OPEN',
        total: 1000,
        payments: [{ amount: 1000 }],
        creditNotes: [],
      });
      const result = await service.settleInvoice(
        prisma,
        'inv-1',
        new Date('2026-11-16T00:00:00.000Z'),
      );
      expect(result.status).toBe('PAID');
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'PAID', paidAt: expect.any(Date) },
      });
    });

    it('leaves a partly paid invoice OPEN', async () => {
      const { service, prisma } = makeService();
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        status: 'OPEN',
        total: 1000,
        payments: [{ amount: 400 }],
        creditNotes: [{ amount: 100 }],
      });
      const result = await service.settleInvoice(prisma, 'inv-1', new Date());
      expect(result.status).toBe('OPEN');
      expect(result.remaining).toBe(500);
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe('applyOpenCredit', () => {
    it('applies whole notes oldest-first and splits an oversized note', async () => {
      const { service, prisma } = makeService();
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        number: 'INV-2611-0001',
        status: 'OPEN',
        total: 1000,
        payments: [],
        creditNotes: [],
      });
      prisma.creditNote.findMany.mockResolvedValue([
        { id: 'note-1', amount: 300, currency: 'BDT' },
        { id: 'note-2', amount: 900, currency: 'BDT' },
      ]);

      const result = await service.applyOpenCredit(prisma, TENANT_ID, 'inv-1');

      expect(result.applied).toBe(1000);
      expect(prisma.creditNote.update).toHaveBeenCalledTimes(2);
      // The 900 note covered the remaining 700; the 200 excess survives.
      expect(prisma.creditNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          amount: 200,
          reason: 'Credit remainder from invoice INV-2611-0001',
          appliedInvoiceId: null,
        }),
      });
    });

    it('applies nothing when the invoice is already covered', async () => {
      const { service, prisma } = makeService();
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        number: 'INV-2611-0001',
        status: 'OPEN',
        total: 100,
        payments: [{ amount: 100 }],
        creditNotes: [],
      });
      const result = await service.applyOpenCredit(prisma, TENANT_ID, 'inv-1');
      expect(result.applied).toBe(0);
      expect(prisma.creditNote.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createInvoice', () => {
    function mockCreatedInvoice(prisma: any, total = 1150) {
      prisma.invoice.create.mockResolvedValue({
        id: 'inv-1',
        number: 'INV-2611-0001',
        status: 'OPEN',
        total,
        lines: [],
      });
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        number: 'INV-2611-0001',
        status: 'OPEN',
        total,
        payments: [],
        creditNotes: [],
      });
    }

    it('totals lines, applies the platform tax rate and defaults due in 7 days', async () => {
      const { service, prisma, audit } = makeService();
      mockCreatedInvoice(prisma);
      const before = Date.now();

      const invoice = await service.createInvoice({
        tenantId: TENANT_ID,
        lines: [
          { description: 'Plan', quantity: 1, unitPrice: 1000 },
        ],
      });

      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.subtotal).toBe(1000);
      expect(data.tax).toBe(150);
      expect(data.total).toBe(1150);
      expect(data.dueAt.getTime() - before).toBeGreaterThan(6 * 86_400_000);
      expect(data.dueAt.getTime() - before).toBeLessThan(8 * 86_400_000);
      expect(invoice.number).toBe('INV-2611-0001');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.invoice.create' }),
      );
    });

    it('adds no tax when the platform tax is inclusive', async () => {
      const { service, prisma, settings } = makeService();
      settings.getTax.mockReturnValue({
        ratePercent: 15,
        label: 'VAT',
        inclusive: true,
      });
      mockCreatedInvoice(prisma, 1000);

      await service.createInvoice({
        tenantId: TENANT_ID,
        lines: [{ description: 'Plan', quantity: 1, unitPrice: 1000 }],
      });

      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data.tax).toBe(0);
      expect(data.total).toBe(1000);
    });

    it('rejects a discount larger than the subtotal', async () => {
      const { service } = makeService();
      await expect(
        service.createInvoice({
          tenantId: TENANT_ID,
          lines: [{ description: 'Plan', quantity: 1, unitPrice: 100 }],
          discount: 200,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an invoice with no lines', async () => {
      const { service } = makeService();
      await expect(
        service.createInvoice({ tenantId: TENANT_ID, lines: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
