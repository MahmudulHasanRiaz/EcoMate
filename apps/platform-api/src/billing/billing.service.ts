import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { TenantRefreshService } from '../common/tenant-refresh.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { addInterval } from './billing-dates';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { SubmitProofDto } from './dto/submit-proof.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceService } from './invoice.service';

const PROOF_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const INVOICE_STATUSES = ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'];
const SUBSCRIPTION_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
];

function pageArgs(page?: string, limit?: string) {
  const current = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(1, Number(limit) || 20));
  return { current, size, skip: (current - 1) * size, take: size };
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly invoiceService: InvoiceService,
    private readonly pdf: InvoicePdfService,
    private readonly mail: PlatformMailService,
    private readonly refresh: TenantRefreshService,
    private readonly settings: SettingsService,
  ) {}

  async proofQueue(query: {
    status?: string;
    tenantId?: string;
    page?: string;
    limit?: string;
  }) {
    const page = pageArgs(query.page, query.limit);
    const status = (query.status || 'PENDING').toUpperCase();
    if (!PROOF_STATUSES.includes(status)) {
      throw new BadRequestException('Unknown payment proof status');
    }
    const where: any = { status };
    if (query.tenantId) where.tenantId = query.tenantId;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.paymentProof.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: page.skip,
        take: page.take,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          invoice: {
            select: {
              id: true,
              number: true,
              status: true,
              total: true,
              currency: true,
            },
          },
          method: {
            select: { id: true, type: true, name: true },
          },
        },
      }),
      this.prisma.paymentProof.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: page.current,
        limit: page.size,
        total,
        totalPages: Math.ceil(total / page.size),
      },
    };
  }

  async proofDetail(id: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        invoice: {
          include: {
            payments: { include: { method: true } },
            proofs: { include: { method: true } },
          },
        },
        method: true,
        payments: true,
      },
    });
    if (!proof) throw new NotFoundException('Payment proof not found');
    return proof;
  }

  /**
   * Approve a payment proof. One transaction: claim the proof, record the
   * payment, settle the invoice (payments + applied credit), bank any
   * overpayment as open credit, and — when the invoice is fully paid —
   * extend the subscription, reactivate the tenant and refresh entitlements.
   * A partial payment settles nothing: the invoice stays OPEN and the
   * subscription is untouched.
   */
  async approveProof(id: string, actorId?: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            total: true,
            currency: true,
            subscriptionId: true,
            periodStart: true,
            periodEnd: true,
          },
        },
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            ownerEmail: true,
          },
        },
      },
    });
    if (!proof) throw new NotFoundException('Payment proof not found');
    if (proof.status !== 'PENDING') {
      throw new ConflictException('This payment proof was already reviewed');
    }
    // Duplicate transaction detection: the same transaction id on the same
    // method must never pay twice. The partial unique index is the backstop;
    // this query gives the friendly error.
    const duplicate = await this.prisma.paymentProof.findFirst({
      where: {
        id: { not: id },
        methodId: proof.methodId,
        transactionId: proof.transactionId,
        status: 'APPROVED',
      },
      select: { id: true, invoiceId: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'This transaction id was already used for another approved payment',
      );
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentProof.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedBy: actorId ?? null,
          reviewedAt: now,
          rejectionReason: null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This payment proof was already reviewed');
      }

      const payment = await tx.payment.create({
        data: {
          invoiceId: proof.invoiceId,
          tenantId: proof.tenantId,
          methodId: proof.methodId,
          proofId: proof.id,
          amount: proof.amount,
          currency: proof.invoice.currency,
          reference: proof.transactionId,
          recordedBy: actorId ?? null,
        },
      });

      const settled = await this.invoiceService.settleInvoice(tx, proof.invoiceId, now);

      // Overpayment: the excess is not refunded automatically — it becomes
      // open credit for the tenant's next invoice.
      let overpaymentCredit = 0;
      if (settled.paidAmount > settled.total) {
        overpaymentCredit = Math.round(
          (settled.paidAmount - settled.total + Number.EPSILON) * 100,
        ) / 100;
        await tx.creditNote.create({
          data: {
            tenantId: proof.tenantId,
            amount: overpaymentCredit,
            currency: proof.invoice.currency,
            reason: `Overpayment on invoice ${proof.invoice.number}`,
            appliedInvoiceId: null,
          },
        });
      }

      // Full payment: extend the subscription and reactivate the tenant.
      let extended: {
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
      } | null = null;
      if (settled.status === 'PAID' && proof.invoice.subscriptionId) {
        const subscription = await tx.subscription.findUnique({
          where: { id: proof.invoice.subscriptionId },
          include: { planVersion: true },
        });
        if (subscription) {
          const periodStart =
            proof.invoice.periodStart ??
            (subscription.currentPeriodEnd > now
              ? subscription.currentPeriodEnd
              : now);
          const periodEnd =
            proof.invoice.periodEnd ??
            addInterval(
              periodStart,
              subscription.planVersion.interval,
              subscription.planVersion.intervalDays,
            );
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'ACTIVE',
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              trialEndsAt: null,
              cancelAtPeriodEnd: false,
              canceledAt: null,
              endedAt: null,
              entitlementsSnapshot: {
                features: subscription.planVersion.features,
                limits: subscription.planVersion.limits,
                changedAt: now.toISOString(),
              } as any,
            },
          });
          extended = { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd };
        }
      }
      // Reactivation only follows a subscription extension: paying a manual
      // invoice (setup fee, no subscription) must not flip a TRIAL tenant
      // to ACTIVE and strand the subscription in TRIAL.
      let reactivated = false;
      if (
        settled.status === 'PAID' &&
        extended &&
        (proof.tenant.status === 'PAST_DUE' ||
          proof.tenant.status === 'SUSPENDED' ||
          proof.tenant.status === 'TRIAL')
      ) {
        await tx.tenant.update({
          where: { id: proof.tenantId },
          data: {
            status: 'ACTIVE',
            graceEndsAt: null,
            suspendedAt: null,
          },
        });
        reactivated = true;
      }
      return { payment, settled, overpaymentCredit, extended, reactivated };
    });

    await this.audit.record({
      actorId,
      tenantId: proof.tenantId,
      action: 'billing.proof.approve',
      entity: 'PaymentProof',
      entityId: proof.id,
      after: {
        invoiceId: proof.invoiceId,
        paymentId: result.payment.id,
        amount: String(proof.amount),
        invoiceStatus: result.settled.status,
        overpaymentCredit: result.overpaymentCredit,
        reactivated: result.reactivated,
      },
    });

    if (result.settled.status === 'PAID') {
      // Best-effort: mail + refresh must never fail an approved payment.
      try {
        await this.mail.sendPaymentApproved({
          to: proof.tenant.ownerEmail,
          tenantName: proof.tenant.name,
          invoiceNumber: proof.invoice.number,
          amount: Number(proof.amount),
          currency: proof.invoice.currency,
        });
      } catch (error) {
        this.logger.warn(
          `Payment-approved email failed for ${proof.invoice.number}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const pushed = await this.refresh.pushRefresh(proof.tenant.slug);
      if (!pushed.ok) {
        this.logger.warn(
          `Entitlement refresh push failed for ${proof.tenant.slug}: ${pushed.error}`,
        );
      }
    }

    return {
      proofId: proof.id,
      invoiceId: proof.invoiceId,
      paymentId: result.payment.id,
      paidAmount: result.settled.paidAmount,
      invoiceTotal: result.settled.total,
      invoiceStatus: result.settled.status,
      overpaymentCredit: result.overpaymentCredit,
      reactivated: result.reactivated,
      currentPeriodEnd: result.extended?.currentPeriodEnd ?? null,
    };
  }

  async rejectProof(id: string, reason: string, actorId?: string) {
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 3) {
      throw new BadRequestException('A rejection reason is required');
    }
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: {
        invoice: { select: { id: true, number: true } },
        tenant: { select: { id: true, name: true, ownerEmail: true } },
      },
    });
    if (!proof) throw new NotFoundException('Payment proof not found');

    const reviewedAt = new Date();
    const result = await this.prisma.paymentProof.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedBy: actorId ?? null,
        reviewedAt,
        rejectionReason: cleanReason,
      },
    });
    if (result.count === 0) {
      throw new ConflictException('This payment proof was already reviewed');
    }

    await this.audit.record({
      actorId,
      tenantId: proof.tenantId,
      action: 'billing.proof.reject',
      entity: 'PaymentProof',
      entityId: proof.id,
      after: { reason: cleanReason },
    });
    try {
      await this.mail.sendPaymentRejected({
        to: proof.tenant.ownerEmail,
        tenantName: proof.tenant.name,
        invoiceNumber: proof.invoice.number,
        reason: cleanReason,
      });
    } catch (error) {
      this.logger.warn(
        `Payment-rejected email failed for ${proof.invoice.number}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { proofId: proof.id, status: 'REJECTED' };
  }

  async invoices(query: {
    status?: string;
    tenantId?: string;
    search?: string;
    page?: string;
    limit?: string;
  }) {
    const page = pageArgs(query.page, query.limit);
    const where: any = {};
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!INVOICE_STATUSES.includes(status)) {
        throw new BadRequestException('Unknown invoice status');
      }
      where.status = status;
    }
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.search?.trim()) {
      where.number = { contains: query.search.trim(), mode: 'insensitive' };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          payments: { select: { amount: true } },
          _count: { select: { lines: true, proofs: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      data: data.map((invoice) => {
        const paidAmount = invoice.payments.reduce(
          (sum, payment) => sum + Number(payment.amount),
          0,
        );
        const { payments: _payments, ...rest } = invoice;
        return { ...rest, paidAmount };
      }),
      meta: {
        page: page.current,
        limit: page.size,
        total,
        totalPages: Math.ceil(total / page.size),
      },
    };
  }

  async invoiceDetail(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        tenant: {
          select: { id: true, name: true, slug: true, ownerEmail: true },
        },
        lines: true,
        payments: { include: { method: true }, orderBy: { receivedAt: 'desc' } },
        proofs: { include: { method: true }, orderBy: { createdAt: 'desc' } },
        creditNotes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const balance = this.invoiceService.balanceOf(invoice);
    return { ...invoice, ...balance };
  }

  async createInvoice(dto: CreateInvoiceDto, actorId?: string) {
    return this.invoiceService.createInvoice(
      {
        tenantId: dto.tenantId,
        subscriptionId: dto.subscriptionId,
        lines: dto.lines,
        discount: dto.discount,
        taxRatePercent: dto.taxRatePercent,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        notes: dto.notes,
      },
      actorId,
    );
  }

  async invoicePdf(id: string) {
    const detail = await this.invoiceDetail(id);
    const branding = this.settings.getBranding();
    const buffer = await this.pdf.render({
      number: detail.number,
      status: detail.status,
      tenantName: detail.tenant.name,
      tenantSlug: detail.tenant.slug,
      ownerEmail: detail.tenant.ownerEmail ?? '',
      createdAt: detail.createdAt,
      dueAt: detail.dueAt,
      periodStart: detail.periodStart,
      periodEnd: detail.periodEnd,
      lines: detail.lines.map((line: any) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: Number(line.unitPrice),
        amount: Number(line.amount),
      })),
      subtotal: Number(detail.subtotal),
      discount: Number(detail.discount),
      tax: Number(detail.tax),
      total: Number(detail.total),
      currency: detail.currency,
      payments: detail.payments.map((payment: any) => ({
        amount: Number(payment.amount),
        receivedAt: payment.receivedAt,
        reference: payment.reference,
      })),
      creditAmount: detail.creditAmount,
      platformName: branding.platformName,
      supportEmail: branding.supportEmail || 'support@ecomate.bd',
    });
    return { buffer, filename: `invoice-${detail.number}.pdf` };
  }

  /**
   * Tenant proof submission (called by the internal endpoint, which the
   * tenant backend proxies with the tenant id from its own context). The
   * invoice must belong to the tenant and be OPEN; the method must be
   * active; the transaction id must not already be PENDING or APPROVED on
   * this method (the partial unique index enforces the same rule).
   */
  async submitProof(tenantId: string, dto: SubmitProofDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      select: { id: true, tenantId: true, status: true, number: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.tenantId !== tenantId) {
      throw new BadRequestException('The invoice does not belong to this tenant');
    }
    if (invoice.status !== 'OPEN') {
      throw new ConflictException(
        `This invoice is ${invoice.status} and cannot take a payment proof`,
      );
    }
    const method = await this.prisma.paymentMethod.findUnique({
      where: { id: dto.methodId },
      select: { id: true, isActive: true, name: true },
    });
    if (!method) throw new NotFoundException('Payment method not found');
    if (!method.isActive) {
      throw new BadRequestException('This payment method is not active');
    }
    const existing = await this.prisma.paymentProof.findFirst({
      where: {
        methodId: dto.methodId,
        transactionId: dto.transactionId.trim(),
        status: { in: ['PENDING', 'APPROVED'] },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'This transaction id was already submitted for this payment method',
      );
    }

    const proof = await this.prisma.paymentProof.create({
      data: {
        invoiceId: invoice.id,
        tenantId,
        methodId: dto.methodId,
        amount: dto.amount,
        transactionId: dto.transactionId.trim(),
        senderNumber: dto.senderNumber ?? null,
        note: dto.note ?? null,
        status: 'PENDING',
      },
      include: { method: { select: { id: true, name: true, type: true } } },
    });

    await this.audit.record({
      tenantId,
      action: 'billing.proof.submit',
      entity: 'PaymentProof',
      entityId: proof.id,
      after: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amount: String(dto.amount),
        transactionId: dto.transactionId.trim(),
      },
    });
    return proof;
  }

  async payments(query: {
    tenantId?: string;
    page?: string;
    limit?: string;
  }) {
    const page = pageArgs(query.page, query.limit);
    const where: any = {};
    if (query.tenantId) where.tenantId = query.tenantId;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          invoice: { select: { id: true, number: true } },
          method: { select: { id: true, type: true, name: true } },
          proof: { select: { id: true, transactionId: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: page.current,
        limit: page.size,
        total,
        totalPages: Math.ceil(total / page.size),
      },
    };
  }

  async methods() {
    return this.prisma.paymentMethod.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createMethod(dto: CreatePaymentMethodDto, actorId?: string) {
    const method = await this.prisma.paymentMethod.create({
      data: {
        type: dto.type as any,
        name: dto.name.trim(),
        accountName: dto.accountName?.trim() || null,
        accountNumber: dto.accountNumber?.trim() || null,
        instructions: dto.instructions?.trim() || null,
        qrMediaUrl: dto.qrMediaUrl?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.record({
      actorId,
      action: 'billing.method.create',
      entity: 'PaymentMethod',
      entityId: method.id,
      after: method as any,
    });
    return method;
  }

  async updateMethod(
    id: string,
    dto: UpdatePaymentMethodDto,
    actorId?: string,
  ) {
    const before = await this.prisma.paymentMethod.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Payment method not found');
    const data: any = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.accountName !== undefined)
      data.accountName = dto.accountName.trim() || null;
    if (dto.accountNumber !== undefined)
      data.accountNumber = dto.accountNumber.trim() || null;
    if (dto.instructions !== undefined)
      data.instructions = dto.instructions.trim() || null;
    if (dto.qrMediaUrl !== undefined)
      data.qrMediaUrl = dto.qrMediaUrl.trim() || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    const method = await this.prisma.paymentMethod.update({
      where: { id },
      data,
    });
    await this.audit.record({
      actorId,
      action: 'billing.method.update',
      entity: 'PaymentMethod',
      entityId: method.id,
      before: before as any,
      after: method as any,
    });
    return method;
  }

  async deleteMethod(id: string, actorId?: string) {
    const before = await this.prisma.paymentMethod.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Payment method not found');
    const [proofCount, paymentCount] = await Promise.all([
      this.prisma.paymentProof.count({ where: { methodId: id } }),
      this.prisma.payment.count({ where: { methodId: id } }),
    ]);
    if (proofCount > 0 || paymentCount > 0) {
      throw new ConflictException(
        'Payment method is referenced by payment proofs or payments; deactivate it instead of deleting',
      );
    }
    await this.prisma.paymentMethod.delete({ where: { id } });
    await this.audit.record({
      actorId,
      action: 'billing.method.delete',
      entity: 'PaymentMethod',
      entityId: id,
      before: before as any,
    });
    return { id, deleted: true };
  }

  async subscriptions(query: {
    status?: string;
    page?: string;
    limit?: string;
  }) {
    const page = pageArgs(query.page, query.limit);
    const where: any = {};
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!SUBSCRIPTION_STATUSES.includes(status)) {
        throw new BadRequestException('Unknown subscription status');
      }
      where.status = status;
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        orderBy: { currentPeriodEnd: 'asc' },
        skip: page.skip,
        take: page.take,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          planVersion: {
            include: { plan: { select: { id: true, name: true, slug: true } } },
          },
          addOns: { include: { addOn: true } },
        },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: page.current,
        limit: page.size,
        total,
        totalPages: Math.ceil(total / page.size),
      },
    };
  }

  async creditNotes(query: {
    tenantId?: string;
    page?: string;
    limit?: string;
  }) {
    const page = pageArgs(query.page, query.limit);
    const where: any = {};
    if (query.tenantId) where.tenantId = query.tenantId;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.creditNote.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          appliedInvoice: { select: { id: true, number: true } },
        },
      }),
      this.prisma.creditNote.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: page.current,
        limit: page.size,
        total,
        totalPages: Math.ceil(total / page.size),
      },
    };
  }

  async createCreditNote(dto: CreateCreditNoteDto, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (dto.appliedInvoiceId) {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: dto.appliedInvoiceId },
        select: { id: true, tenantId: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.tenantId !== dto.tenantId) {
        throw new BadRequestException(
          'The invoice does not belong to this tenant',
        );
      }
    }

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.creditNote.create({
        data: {
          tenantId: dto.tenantId,
          amount: dto.amount,
          currency: (dto.currency || 'BDT').toUpperCase(),
          reason: dto.reason.trim(),
          appliedInvoiceId: dto.appliedInvoiceId ?? null,
        },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          appliedInvoice: { select: { id: true, number: true } },
        },
      });
      // A credit note applied to an invoice reduces what the tenant owes:
      // settle the invoice so a fully-covered invoice becomes PAID. A
      // credit-paid invoice does NOT extend the subscription — only a real
      // payment does (see approveProof).
      if (dto.appliedInvoiceId) {
        await this.invoiceService.settleInvoice(tx, dto.appliedInvoiceId, new Date());
      }
      return created;
    });

    await this.audit.record({
      actorId,
      tenantId: dto.tenantId,
      action: 'billing.credit_note.create',
      entity: 'CreditNote',
      entityId: note.id,
      after: {
        amount: String(dto.amount),
        appliedInvoiceId: dto.appliedInvoiceId ?? null,
      },
    });
    return note;
  }

  async coupons(query: {
    active?: string;
    page?: string;
    limit?: string;
  }) {
    const page = pageArgs(query.page, query.limit);
    const where: any = {};
    if (query.active === 'true') where.isActive = true;
    if (query.active === 'false') where.isActive = false;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        include: { _count: { select: { redemptions: true } } },
      }),
      this.prisma.coupon.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: page.current,
        limit: page.size,
        total,
        totalPages: Math.ceil(total / page.size),
      },
    };
  }

  async createCoupon(dto: CreateCouponDto, actorId?: string) {
    if (dto.type === 'PERCENT' && dto.value > 100) {
      throw new BadRequestException('Percent coupons cannot exceed 100');
    }
    if (dto.duration === 'MONTHS' && !dto.durationMonths) {
      throw new BadRequestException(
        'durationMonths is required for MONTHS coupons',
      );
    }

    const code = dto.code.trim().toUpperCase();
    try {
      const coupon = await this.prisma.coupon.create({
        data: {
          code,
          type: dto.type,
          value: dto.value,
          duration: dto.duration,
          durationMonths:
            dto.duration === 'MONTHS' ? dto.durationMonths : null,
          planIds: dto.planIds ?? [],
          maxRedemptions: dto.maxRedemptions ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          isActive: dto.isActive ?? true,
        },
      });
      await this.audit.record({
        actorId,
        action: 'billing.coupon.create',
        entity: 'Coupon',
        entityId: coupon.id,
        after: { code, type: dto.type, value: dto.value },
      });
      return coupon;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('A coupon with this code already exists');
      }
      throw err;
    }
  }

  async updateCoupon(id: string, dto: UpdateCouponDto, actorId?: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    if (
      dto.maxRedemptions !== undefined &&
      dto.maxRedemptions < coupon.redeemedCount
    ) {
      throw new BadRequestException(
        'maxRedemptions cannot be below the redeemed count',
      );
    }

    const data: any = {};
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.maxRedemptions !== undefined) {
      data.maxRedemptions = dto.maxRedemptions;
    }
    if (dto.expiresAt !== undefined) data.expiresAt = new Date(dto.expiresAt);

    const updated = await this.prisma.coupon.update({ where: { id }, data });
    await this.audit.record({
      actorId,
      action: 'billing.coupon.update',
      entity: 'Coupon',
      entityId: id,
      before: {
        isActive: coupon.isActive,
        maxRedemptions: coupon.maxRedemptions,
        expiresAt: coupon.expiresAt,
      },
      after: data,
    });
    return updated;
  }

  async summary() {
    const now = new Date();
    const [pendingProofs, openInvoices, overdueInvoices, collected] =
      await Promise.all([
        this.prisma.paymentProof.count({ where: { status: 'PENDING' } }),
        this.prisma.invoice.count({ where: { status: 'OPEN' } }),
        this.prisma.invoice.count({
          where: { status: 'OPEN', dueAt: { lt: now } },
        }),
        this.prisma.payment.aggregate({ _sum: { amount: true } }),
      ]);

    return {
      pendingProofs,
      openInvoices,
      overdueInvoices,
      collectedAmount: Number(collected._sum.amount ?? 0),
    };
  }
}
