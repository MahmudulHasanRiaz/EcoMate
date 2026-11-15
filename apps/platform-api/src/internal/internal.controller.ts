import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { InternalServiceGuard } from './internal-service.guard';

@Controller('internal')
@UseGuards(InternalServiceGuard)
export class InternalController {
  constructor(private readonly prisma: PlatformPrismaService) {}

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
              limits: tenant.planVersion.limits,
            }
          : null,
      })),
    };
  }

  @Get('tenants/:id/entitlements')
  async entitlements(@Param('id', ParseUUIDPipe) id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        subscription: { include: { planVersion: { include: { plan: true } } } },
        planVersion: { include: { plan: true } },
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
            limits: planVersion.limits,
            trialDays: planVersion.trialDays,
            graceDays: planVersion.graceDays,
          }
        : null,
      trialEndsAt: tenant.trialEndsAt,
      graceEndsAt: tenant.graceEndsAt,
      validUntil: tenant.subscription?.currentPeriodEnd ?? tenant.trialEndsAt,
    };
  }
}
