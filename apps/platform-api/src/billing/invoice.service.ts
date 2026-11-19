import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export interface InvoiceLineInput {
  description: string;
  quantity?: number;
  unitPrice: number;
}

export interface CreateInvoiceInput {
  tenantId: string;
  subscriptionId?: string;
  lines: InvoiceLineInput[];
  /** Flat discount in the invoice currency. Defaults to 0. */
  discount?: number;
  /** Tax rate percent. Defaults to the platform tax setting. */
  taxRatePercent?: number;
  dueAt?: Date;
  periodStart?: Date;
  periodEnd?: Date;
  notes?: string;
  /** Apply the tenant's open credit notes to the new invoice. Default true. */
  applyCredit?: boolean;
  /**
   * Invoice kind (pricing engine §5). Defaults to MANUAL (operator-created).
   * Renewal jobs pass SUBSCRIPTION / METERED; one-time purchases pass
   * ONE_TIME. The kind drives the approveProof extension gate — only
   * subscription-linked SUBSCRIPTION / METERED / MANUAL invoices extend
   * the subscription; ONE_TIME and TOPUP never do.
   */
  kind?: 'SUBSCRIPTION' | 'ONE_TIME' | 'METERED' | 'MANUAL' | 'TOPUP';
  /** Billing computation trace (§4), stored on the invoice for audit. */
  metadata?: Record<string, unknown>;
}

export interface InvoiceBalance {
  paidAmount: number;
  creditAmount: number;
  remaining: number;
}

type Tx = Prisma.TransactionClient;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Invoice creation, numbering, credit application and settlement. One source
 * of truth for "what does this tenant still owe on this invoice" — payments
 * plus applied credit notes, never payments alone.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Amount still owed on an invoice: total minus payments minus applied credit. */
  async balance(invoiceId: string): Promise<InvoiceBalance> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: { select: { amount: true } },
        creditNotes: { select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.balanceOf(invoice);
  }

  balanceOf(invoice: {
    total: Prisma.Decimal | number;
    payments?: { amount: Prisma.Decimal | number }[];
    creditNotes?: { amount: Prisma.Decimal | number }[];
  }): InvoiceBalance {
    const total = Number(invoice.total);
    const paidAmount = (invoice.payments ?? []).reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );
    const creditAmount = (invoice.creditNotes ?? []).reduce(
      (sum, note) => sum + Number(note.amount),
      0,
    );
    return {
      paidAmount: round2(paidAmount),
      creditAmount: round2(creditAmount),
      remaining: round2(Math.max(0, total - paidAmount - creditAmount)),
    };
  }

  /**
   * Recompute an invoice's status from its payments + applied credit. An
   * OPEN invoice whose remaining hits zero becomes PAID. Returns the
   * balance so callers can decide what else to do (extend a subscription,
   * send mail) without re-querying.
   */
  async settleInvoice(
    tx: Tx,
    invoiceId: string,
    now: Date,
  ): Promise<InvoiceBalance & { status: string; total: number }> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: { select: { amount: true } },
        creditNotes: { select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const balance = this.balanceOf(invoice);
    let status = invoice.status;
    if (status === 'OPEN' && balance.remaining <= 0) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt: now },
      });
      status = 'PAID';
    }
    return { ...balance, status, total: Number(invoice.total) };
  }

  /**
   * Apply the tenant's open credit notes (appliedInvoiceId null, oldest
   * first) to an invoice until its remaining is covered. A note larger than
   * the remaining balance is applied in full and the excess comes back as a
   * new open credit note, so no credit is ever lost to rounding or
   * over-application. Returns the credit applied.
   */
  async applyOpenCredit(
    tx: Tx,
    tenantId: string,
    invoiceId: string,
  ): Promise<{ applied: number }> {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: { select: { amount: true } },
        creditNotes: { select: { amount: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    let remaining = this.balanceOf(invoice).remaining;
    if (remaining <= 0) return { applied: 0 };

    const openNotes = await tx.creditNote.findMany({
      where: { tenantId, appliedInvoiceId: null },
      orderBy: { createdAt: 'asc' },
    });
    let applied = 0;
    for (const note of openNotes) {
      if (remaining <= 0) break;
      const amount = Number(note.amount);
      if (amount <= remaining) {
        await tx.creditNote.update({
          where: { id: note.id },
          data: { appliedInvoiceId: invoiceId },
        });
        remaining = round2(remaining - amount);
        applied = round2(applied + amount);
      } else {
        // Split: the note covers the rest of the invoice, the excess
        // survives as a fresh open credit note.
        await tx.creditNote.update({
          where: { id: note.id },
          data: { appliedInvoiceId: invoiceId },
        });
        const excess = round2(amount - remaining);
        await tx.creditNote.create({
          data: {
            tenantId,
            amount: excess,
            currency: note.currency,
            reason: `Credit remainder from invoice ${invoice.number}`,
            appliedInvoiceId: null,
          },
        });
        applied = round2(applied + remaining);
        remaining = 0;
      }
    }
    return { applied };
  }

  /**
   * Next invoice number: INV-YYMM-NNNN, sequential within the month. The
   * unique constraint is the backstop — a collision (two invoices created
   * in the same instant) retries with the next sequence number.
   */
  async nextInvoiceNumber(tx: Tx, now: Date): Promise<string> {
    const prefix = `INV-${String(now.getFullYear()).slice(2)}${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}-`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const count = await tx.invoice.count({
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = `${prefix}${String(count + 1 + attempt).padStart(4, '0')}`;
      const existing = await tx.invoice.findUnique({
        where: { number: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    // Extremely unlikely (three collisions in a row): fall back to a
    // timestamp suffix rather than failing the invoice.
    return `${prefix}${Date.now().toString().slice(-6)}`;
  }

  async createInvoice(input: CreateInvoiceInput, actorId?: string) {
    if (!input.lines?.length) {
      throw new BadRequestException('An invoice needs at least one line');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const lines = input.lines.map((line) => {
      const quantity = Math.max(1, Math.floor(line.quantity ?? 1));
      const unitPrice = round2(line.unitPrice);
      if (unitPrice < 0) {
        throw new BadRequestException('Line prices cannot be negative');
      }
      return {
        description: line.description.trim(),
        quantity,
        unitPrice,
        amount: round2(quantity * unitPrice),
      };
    });
    const subtotal = round2(
      lines.reduce((sum, line) => sum + line.amount, 0),
    );
    const discount = round2(Math.max(0, input.discount ?? 0));
    if (discount > subtotal) {
      throw new BadRequestException('Discount cannot exceed the subtotal');
    }
    const taxable = round2(subtotal - discount);
    const taxSettings = this.settings.getTax();
    const rate = input.taxRatePercent ?? taxSettings.ratePercent;
    const tax = taxSettings.inclusive ? 0 : round2((taxable * rate) / 100);
    const total = round2(taxable + tax);
    if (total < 0) {
      throw new BadRequestException('Invoice total cannot be negative');
    }
    const now = new Date();
    const dueAt = input.dueAt ?? new Date(now.getTime() + 7 * 86_400_000);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextInvoiceNumber(tx, now);
      const created = await tx.invoice.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: input.subscriptionId ?? null,
          number,
          status: 'OPEN',
          kind: input.kind ?? 'MANUAL',
          metadata: (input.metadata ?? {}) as any,
          subtotal,
          discount,
          tax,
          total,
          currency: 'BDT',
          dueAt,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          notes: input.notes ?? null,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      if (input.applyCredit !== false && total > 0) {
        await this.applyOpenCredit(tx, tenant.id, created.id);
      }
      const settled = await this.settleInvoice(tx, created.id, now);
      return { ...created, ...settled };
    });

    await this.audit.record({
      actorId,
      tenantId: tenant.id,
      action: 'billing.invoice.create',
      entity: 'Invoice',
      entityId: invoice.id,
      after: {
        number: invoice.number,
        total: invoice.total,
        status: invoice.status,
        kind: invoice.kind,
      },
    });
    return invoice;
  }
}
