import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
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
