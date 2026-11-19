import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { SubmitProofDto } from '../billing/dto/submit-proof.dto';
import { InvoiceService } from '../billing/invoice.service';
import { CreateTopUpDto } from '../email-balance/dto/create-top-up.dto';
import { EmailBalanceService } from '../email-balance/email-balance.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { resolveBlockedAreas, resolveBlockingConfig } from '../pricing/blocking';
import {
  parsePricingDocument,
  resolveVersionPricing,
} from '../pricing/pricing-document';
import { resolveEffectivePricing } from '../pricing/pricing-engine';
import { ImpersonationService } from '../tenants/impersonation.service';
import { mergePlanLimitsWithOverrides } from '../usage/usage.limits';
import { ConsumeImpersonationDto } from './dto/consume-impersonation.dto';
import { SaasSmtpSendDto } from './dto/saas-smtp-send.dto';
import { InternalServiceGuard } from './internal-service.guard';

@Controller('internal')
@UseGuards(InternalServiceGuard)
export class InternalController {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly impersonation: ImpersonationService,
    private readonly billing: BillingService,
    private readonly invoices: InvoiceService,
    private readonly emailBalance: EmailBalanceService,
  ) {}

  @Get('tenants/registry')
  async registry() {
    const now = new Date();
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { not: 'DELETED' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        slug: true,
        status: true,
        trialEndsAt: true,
        graceEndsAt: true,
        domains: {
          select: {
            host: true,
            type: true,
            status: true,
          },
        },
        subscription: {
          select: {
            status: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            addOns: {
              where: {
                startedAt: { lte: now },
                OR: [{ endedAt: null }, { endedAt: { gt: now } }],
              },
              select: {
                addOn: { select: { features: true, limits: true } },
              },
            },
          },
        },
        planVersion: {
          select: {
            price: true,
            currency: true,
            features: true,
            limits: true,
            pricing: true,
            plan: { select: { name: true } },
          },
        },
        limitOverrides: {
          select: { key: true, value: true },
        },
        blockingOverride: {
          select: { mode: true, blockedAreas: true },
        },
        pricingOverrides: {
          select: { key: true, value: true },
        },
        purchases: {
          where: {
            status: 'APPLIED',
            type: { in: ['RATE_TIER', 'FEATURE_UNLOCK'] },
          },
          orderBy: { appliedAt: 'asc' },
          select: { type: true, feeKey: true, effect: true },
        },
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      tenants: tenants.map((tenant) => {
        const planPricing = parsePricingDocument(
          tenant.planVersion?.pricing,
        );
        // Strict blocking (§9): the platform computes blockedAreas here;
        // the backend only enforces what the registry says.
        const blockingConfig = resolveBlockingConfig({
          planBlocking: planPricing.blocking ?? null,
          override: tenant.blockingOverride ?? null,
        });
        const blockedAreas = resolveBlockedAreas({
          subscriptionStatus: tenant.subscription?.status ?? null,
          tenantStatus: tenant.status,
          graceEndsAt: tenant.graceEndsAt,
          config: blockingConfig,
          now,
        });

        // Features: plan + active add-ons + applied feature-unlock
        // purchases (§10.3 step 4). The unlock lives on the purchase
        // row, so it survives plan changes (which rewrite the snapshot).
        const unlockFeatures: string[] = [];
        const rateTierPurchases: Array<{
          feeKey: string;
          perOrderRate: number;
        }> = [];
        for (const purchase of tenant.purchases ?? []) {
          const effect = (purchase.effect ?? {}) as {
            features?: unknown;
            perOrderRate?: unknown;
          };
          if (purchase.type === 'FEATURE_UNLOCK' && Array.isArray(effect.features)) {
            for (const feature of effect.features) {
              if (typeof feature === 'string') unlockFeatures.push(feature);
            }
          }
          if (
            purchase.type === 'RATE_TIER' &&
            typeof effect.perOrderRate === 'number'
          ) {
            rateTierPurchases.push({
              feeKey: purchase.feeKey,
              perOrderRate: effect.perOrderRate,
            });
          }
        }
        const addOnFeatures: string[] = [];
        const addOnLimits: Record<string, unknown> = {};
        for (const row of tenant.subscription?.addOns ?? []) {
          for (const feature of row.addOn.features ?? []) {
            addOnFeatures.push(feature);
          }
          const limits = row.addOn.limits as Record<string, unknown> | null;
          if (limits && typeof limits === 'object') {
            for (const [key, value] of Object.entries(limits)) {
              // An add-on never REDUCES a limit: the max wins.
              if (typeof value === 'number' && Number.isFinite(value)) {
                const current = addOnLimits[key];
                addOnLimits[key] =
                  typeof current === 'number'
                    ? Math.max(current, value)
                    : value;
              }
            }
          }
        }
        const features = [
          ...new Set([
            ...(tenant.planVersion?.features ?? []),
            ...addOnFeatures,
            ...unlockFeatures,
          ]),
        ];
        const limits = mergePlanLimitsWithOverrides(
          tenant.planVersion?.limits,
          tenant.limitOverrides,
        );
        for (const [key, value] of Object.entries(addOnLimits)) {
          const current = limits[key];
          limits[key] =
            typeof current === 'number'
              ? Math.max(current, value as number)
              : value;
        }

        // Effective pricing for the tenant plan page (display only —
        // the backend never computes money).
        const { pricing: effectivePricing } = resolveEffectivePricing({
          versionPricing: tenant.planVersion
            ? resolveVersionPricing(tenant.planVersion)
            : {},
          overrides: (tenant.pricingOverrides ?? []).map((row) => ({
            key: row.key,
            value: Number(row.value),
          })),
          rateTierPurchases,
        });

        return {
          id: tenant.id,
          slug: tenant.slug,
          status: tenant.status,
          trialEndsAt: tenant.trialEndsAt,
          graceEndsAt: tenant.graceEndsAt,
          hosts: tenant.domains
            .filter(
              (domain) =>
                domain.type === 'SUBDOMAIN' ||
                domain.status === 'VERIFIED' ||
                domain.status === 'ACTIVE',
            )
            .map((domain) => domain.host),
          subscription: tenant.subscription
            ? {
                status: tenant.subscription.status,
                trialEndsAt: tenant.subscription.trialEndsAt,
                currentPeriodEnd: tenant.subscription.currentPeriodEnd,
              }
            : null,
          plan: tenant.planVersion
            ? {
                name: tenant.planVersion.plan.name,
                features,
                limits,
              }
            : null,
          blockedAreas,
          effectivePricing: {
            baseFee: effectivePricing.baseFee?.amount ?? null,
            ratePerUnit: effectivePricing.metering?.ratePerUnit ?? null,
            minimumMonthly: effectivePricing.metering?.minimumMonthly ?? null,
            currency: effectivePricing.baseFee?.currency ?? 'BDT',
          },
        };
      }),
    };
  }

  @Post('impersonations/consume')
  @HttpCode(200)
  consumeImpersonation(@Body() dto: ConsumeImpersonationDto) {
    return this.impersonation.consume(dto.token, dto.tenantId);
  }

  /** Active payment methods, for the tenant billing page (via the backend). */
  @Get('payment-methods')
  async paymentMethods() {
    return this.prisma.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        type: true,
        name: true,
        accountNumber: true,
        accountName: true,
        instructions: true,
      },
    });
  }

  /** A tenant's invoices with balances, for the tenant billing page. */
  @Get('tenants/:id/invoices')
  async tenantInvoices(@Param('id', ParseUUIDPipe) id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        lines: true,
        payments: { select: { amount: true } },
        creditNotes: { select: { amount: true } },
        proofs: {
          select: {
            id: true,
            status: true,
            amount: true,
            transactionId: true,
            createdAt: true,
            rejectionReason: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return invoices.map((invoice) => {
      const balance = this.invoices.balanceOf(invoice);
      const { payments: _payments, creditNotes: _notes, ...rest } = invoice;
      return { ...rest, ...balance };
    });
  }

  /** Tenant proof submission, proxied by the tenant backend. */
  @Post('tenants/:id/proofs')
  async submitProof(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitProofDto,
  ) {
    return this.billing.submitProof(id, dto);
  }

  /**
   * SaaS SMTP relay (§8.2): the tenant backend calls this when the
   * tenant's mode is SAAS. Consumes 1 email from the balance and sends
   * via the shared platform transport. The backend is the authority on
   * mode — the relay trusts the service token + tenantId and checks the
   * platform-side kill switch + tenant status itself.
   */
  @Post('saas-smtp/send')
  @HttpCode(200)
  async saasSmtpSend(@Body() dto: SaasSmtpSendDto) {
    return this.emailBalance.relaySend(dto);
  }

  /** Email balance summary for the tenant admin, proxied by the backend. Counts only. */
  @Get('email-balance')
  async tenantEmailBalance(@Query('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.emailBalance.getInternalBalance(tenantId);
  }

  /** Tenant top-up creation, proxied by the tenant backend (same flow as the console endpoint). */
  @Post('tenants/:id/email-topups')
  async createTenantTopUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTopUpDto,
  ) {
    return this.emailBalance.createTopUp(id, dto.amountBDT);
  }

  /** Tenant invoice PDF, proxied by the tenant backend. */
  @Get('tenants/:id/invoices/:invoiceId/pdf')
  @Header('Content-Type', 'application/pdf')
  async tenantInvoicePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, tenantId: true },
    });
    if (!invoice || invoice.tenantId !== id) {
      throw new NotFoundException('Invoice not found');
    }
    const { buffer, filename } = await this.billing.invoicePdf(invoiceId);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('tenants/:id/entitlements')
  async entitlements(@Param('id', ParseUUIDPipe) id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        subscription: { include: { planVersion: { include: { plan: true } } } },
        planVersion: { include: { plan: true } },
        limitOverrides: {
          select: { key: true, value: true, note: true },
          orderBy: { key: 'asc' },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const planVersion =
      tenant.subscription?.planVersion ?? tenant.planVersion ?? null;

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
      subscription: tenant.subscription
        ? {
            status: tenant.subscription.status,
            trialEndsAt: tenant.subscription.trialEndsAt,
            currentPeriodStart: tenant.subscription.currentPeriodStart,
            currentPeriodEnd: tenant.subscription.currentPeriodEnd,
          }
        : null,
      plan: planVersion
        ? {
            id: planVersion.id,
            version: planVersion.version,
            name: planVersion.plan.name,
            features: planVersion.features,
            limits: mergePlanLimitsWithOverrides(
              planVersion.limits,
              tenant.limitOverrides,
            ),
            trialDays: planVersion.trialDays,
            graceDays: planVersion.graceDays,
          }
        : null,
      overrides: tenant.limitOverrides.map((override) => ({
        key: override.key,
        value: override.value,
        note: override.note ?? null,
      })),
      trialEndsAt: tenant.trialEndsAt,
      graceEndsAt: tenant.graceEndsAt,
      validUntil: tenant.subscription?.currentPeriodEnd ?? tenant.trialEndsAt,
    };
  }
}
