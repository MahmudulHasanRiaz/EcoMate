import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';

const PROOF_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const INVOICE_STATUSES = ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'];

function pageArgs(page?: string, limit?: string) {
  const current = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(1, Number(limit) || 20));
  return { current, size, skip: (current - 1) * size, take: size };
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
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

  async approveProof(id: string, actorId?: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: { invoice: { select: { id: true, total: true, currency: true } } },
    });
    if (!proof) throw new NotFoundException('Payment proof not found');
    if (proof.status !== 'PENDING') {
      throw new ConflictException('This payment proof was already reviewed');
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

      const paid = await tx.payment.aggregate({
        where: { invoiceId: proof.invoiceId },
        _sum: { amount: true },
      });
      const paidAmount = Number(paid._sum.amount ?? 0);
      const total = Number(proof.invoice.total);
      const invoiceStatus = paidAmount >= total ? 'PAID' : 'OPEN';
      if (invoiceStatus === 'PAID') {
        await tx.invoice.update({
          where: { id: proof.invoiceId },
          data: { status: 'PAID', paidAt: now },
        });
      }
      return { payment, paidAmount, total, invoiceStatus };
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
        invoiceStatus: result.invoiceStatus,
      },
    });

    return {
      proofId: proof.id,
      invoiceId: proof.invoiceId,
      paymentId: result.payment.id,
      paidAmount: result.paidAmount,
      invoiceTotal: result.total,
      invoiceStatus: result.invoiceStatus,
    };
  }

  async rejectProof(id: string, reason: string, actorId?: string) {
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 3) {
      throw new BadRequestException('A rejection reason is required');
    }
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      select: { id: true, tenantId: true, status: true },
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
        tenant: { select: { id: true, name: true, slug: true } },
        lines: true,
        payments: { include: { method: true }, orderBy: { receivedAt: 'desc' } },
        proofs: { include: { method: true }, orderBy: { createdAt: 'desc' } },
        creditNotes: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const paidAmount = invoice.payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );
    return { ...invoice, paidAmount };
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
