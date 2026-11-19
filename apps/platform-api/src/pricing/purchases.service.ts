import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { InvoiceService } from '../billing/invoice.service';
import { PurchaseStatus, PurchaseType } from '../generated/prisma/client';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  OneTimeFeeEffect,
  parsePricingDocument,
  validateOneTimeFeeEffect,
} from './pricing-document';
import { CreatePurchaseDto } from './dto/create-purchase.dto';

const EFFECT_TO_PURCHASE_TYPE: Record<string, PurchaseType> = {
  setup: 'SETUP_FEE',
  limit_increase: 'LIMIT_INCREASE',
  rate_tier: 'RATE_TIER',
  feature_unlock: 'FEATURE_UNLOCK',
};

/**
 * One-time purchases (design §6). A purchase is a fee from the tenant's
 * version oneTimeFees[] (or a custom one-off) + a ONE_TIME invoice. The
 * effect is applied by BillingService.approveProof when the invoice
 * becomes PAID — never here. Paying a one-time invoice does not extend
 * the subscription and does not clear PAST_DUE.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoiceService,
  ) {}

  async listPurchases(tenantId: string, status?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const where: { tenantId: string; status?: PurchaseStatus } = {
      tenantId,
    };
    if (status) {
      const upper = status.toUpperCase();
      if (!['PENDING', 'PAID', 'APPLIED', 'CANCELLED'].includes(upper)) {
        throw new BadRequestException('Unknown purchase status');
      }
      where.status = upper as PurchaseStatus;
    }
    return this.prisma.tenantPurchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            currency: true,
          },
        },
      },
    });
  }

  async createPurchase(
    tenantId: string,
    dto: CreatePurchaseDto,
    actorId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        subscription: {
          select: {
            id: true,
            planVersion: { select: { id: true, pricing: true } },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const hasFeeKey = !!dto.feeKey;
    const hasCustom = !!dto.custom;
    if (hasFeeKey === hasCustom) {
      throw new BadRequestException(
        'Provide exactly one of feeKey or custom',
      );
    }

    let feeKey: string;
    let label: string;
    let amount: number;
    let effect: OneTimeFeeEffect;

    if (hasFeeKey) {
      const pricing = parsePricingDocument(
        tenant.subscription?.planVersion?.pricing,
      );
      const fee = pricing.oneTimeFees?.find((item) => item.key === dto.feeKey);
      if (!fee) {
        throw new BadRequestException(
          `No one-time fee "${dto.feeKey}" on the tenant's plan version`,
        );
      }
      feeKey = fee.key;
      label = fee.label;
      amount = fee.amount;
      effect = fee.effect;
    } else {
      const custom = dto.custom!;
      const errors = validateOneTimeFeeEffect(custom.effect);
      if (errors.length > 0) {
        throw new BadRequestException(errors.join('; '));
      }
      feeKey = `custom-${Date.now().toString(36)}`;
      label = custom.label.trim();
      amount = custom.amount;
      effect = custom.effect as OneTimeFeeEffect;
    }

    const type = EFFECT_TO_PURCHASE_TYPE[effect.type];
    if (!type) {
      throw new BadRequestException(`Unknown fee effect "${effect.type}"`);
    }
    const purchaseType: PurchaseType = type;

    // Purchase first, then the invoice, then link them: if invoice
    // creation fails the PENDING purchase (no invoice) is visible to the
    // operator and cancellable, instead of an orphan invoice.
    const purchase = await this.prisma.tenantPurchase.create({
      data: {
        tenantId,
        subscriptionId: tenant.subscription?.id ?? null,
        type: purchaseType,
        feeKey,
        label,
        amount,
        effect: effect as any,
        status: 'PENDING',
        createdBy: actorId ?? null,
      },
    });

    const invoice = await this.invoices.createInvoice(
      {
        tenantId,
        subscriptionId: tenant.subscription?.id ?? undefined,
        lines: [
          {
            description: `One-time purchase — ${label}`,
            quantity: 1,
            unitPrice: amount,
          },
        ],
        kind: 'ONE_TIME',
        metadata: {
          purchaseId: purchase.id,
          feeKey,
          effectType: effect.type,
        },
        notes: `One-time purchase ${label} (${feeKey})`,
      },
      actorId,
    );

    const linked = await this.prisma.tenantPurchase.update({
      where: { id: purchase.id },
      data: { invoiceId: invoice.id },
      include: {
        invoice: {
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            currency: true,
          },
        },
      },
    });

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.purchase.create',
      entity: 'TenantPurchase',
      entityId: purchase.id,
      after: {
        feeKey,
        label,
        amount,
        type,
        invoiceId: invoice.id,
      },
    });
    return linked;
  }

  /**
   * Cancel a PENDING purchase: void its OPEN invoice, mark CANCELLED. A
   * PAID/APPLIED purchase is never auto-reversed — reversing a limit
   * increase or rate tier is a manual operator action (delete the
   * override row, audited).
   */
  async cancelPurchase(
    tenantId: string,
    purchaseId: string,
    actorId?: string,
  ) {
    const purchase = await this.prisma.tenantPurchase.findUnique({
      where: { id: purchaseId },
      include: {
        invoice: { select: { id: true, status: true, number: true } },
      },
    });
    if (!purchase || purchase.tenantId !== tenantId) {
      throw new NotFoundException('Purchase not found');
    }
    if (purchase.status !== 'PENDING') {
      throw new ConflictException(
        `Only a PENDING purchase can be cancelled (this one is ${purchase.status})`,
      );
    }
    if (purchase.invoice && purchase.invoice.status !== 'OPEN') {
      throw new ConflictException(
        `The purchase invoice is ${purchase.invoice.status} and cannot be voided`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (purchase.invoiceId) {
        await tx.invoice.update({
          where: { id: purchase.invoiceId },
          data: { status: 'VOID' },
        });
      }
      return tx.tenantPurchase.update({
        where: { id: purchase.id },
        data: { status: 'CANCELLED' },
      });
    });

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.purchase.cancel',
      entity: 'TenantPurchase',
      entityId: purchase.id,
      before: { status: 'PENDING', invoiceId: purchase.invoiceId },
      after: { status: 'CANCELLED' },
    });
    return result;
  }
}
