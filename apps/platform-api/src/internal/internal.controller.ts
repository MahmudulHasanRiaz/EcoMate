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
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { SubmitProofDto } from '../billing/dto/submit-proof.dto';
import { InvoiceService } from '../billing/invoice.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { ImpersonationService } from '../tenants/impersonation.service';
import { mergePlanLimitsWithOverrides } from '../usage/usage.limits';
import { ConsumeImpersonationDto } from './dto/consume-impersonation.dto';
import { InternalServiceGuard } from './internal-service.guard';

@Controller('internal')
@UseGuards(InternalServiceGuard)
export class InternalController {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly impersonation: ImpersonationService,
    private readonly billing: BillingService,
    private readonly invoices: InvoiceService,
  ) {}

  @Get('tenants/registry')
  async registry() {
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
          },
        },
        planVersion: {
          select: {
            features: true,
            limits: true,
            plan: { select: { name: true } },
          },
        },
        limitOverrides: {
          select: { key: true, value: true },
        },
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      tenants: tenants.map((tenant) => ({
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
        subscription: tenant.subscription,
        plan: tenant.planVersion
          ? {
              name: tenant.planVersion.plan.name,
              features: tenant.planVersion.features,
              limits: mergePlanLimitsWithOverrides(
                tenant.planVersion.limits,
                tenant.limitOverrides,
              ),
            }
          : null,
      })),
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
