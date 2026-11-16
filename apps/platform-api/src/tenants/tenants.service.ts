import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { addInterval, wholeDaysBetween } from '../billing/billing-dates';
import { InvoiceService } from '../billing/invoice.service';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { TenantRefreshService } from '../common/tenant-refresh.service';
import {
  DomainConfigService,
  RESERVED_SLUGS,
} from '../config/domain-config.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_TRIAL_DAYS,
  SettingsService,
} from '../settings/settings.service';
import { CancelTenantDto } from './dto/cancel-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domainConfig: DomainConfigService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly invoices: InvoiceService,
    private readonly mail: PlatformMailService,
    private readonly refresh: TenantRefreshService,
  ) {}

  async list(query: {
    page?: string;
    limit?: string;
    status?: string;
    search?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = query.search?.trim();

    const where: any = {};
    if (query.status) where.status = query.status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { ownerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          domains: true,
          planVersion: true,
          subscription: { include: { planVersion: true } },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async detail(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        domains: true,
        planVersion: true,
        subscription: { include: { planVersion: true } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { invoices: true, payments: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto, actorId?: string) {
    const slug = dto.slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException('This slug is reserved');
    }

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Tenant slug already exists');

    const planVersion = dto.planVersionId
      ? await this.prisma.planVersion.findUnique({
          where: { id: dto.planVersionId },
        })
      : null;
    if (dto.planVersionId && !planVersion) {
      throw new NotFoundException('Plan version not found');
    }

    const primaryDomain = this.domainConfig.getConfig().primaryDomain;
    const now = new Date();
    let defaultTrialDays = DEFAULT_TRIAL_DAYS;
    try {
      defaultTrialDays = this.settings.getTrialDefaults().trialDays;
    } catch {
      // Settings unavailable: fall back to the hardcoded default.
    }
    const trialDays = dto.trialDays ?? planVersion?.trialDays ?? defaultTrialDays;
    const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);
    const status = planVersion ? 'TRIAL' : 'PENDING_VERIFICATION';

    const tenant = await this.prisma.tenant.create({
      data: {
        slug,
        name: dto.name,
        ownerEmail: dto.ownerEmail.trim().toLowerCase(),
        ownerPhone: dto.ownerPhone,
        status: status as any,
        planVersionId: planVersion?.id,
        trialEndsAt,
        currentPeriodStart: planVersion ? now : null,
        currentPeriodEnd: planVersion ? trialEndsAt : null,
        domains: {
          create: {
            host: `${slug}.${primaryDomain}`,
            type: 'SUBDOMAIN',
            baseDomain: primaryDomain,
            isPrimary: true,
            status: 'PENDING',
          },
        },
        ...(planVersion
          ? {
              subscription: {
                create: {
                  planVersionId: planVersion.id,
                  status: 'TRIAL',
                  currentPeriodStart: now,
                  currentPeriodEnd: trialEndsAt,
                  trialEndsAt,
                  entitlementsSnapshot: {
                    features: planVersion.features,
                    limits: planVersion.limits,
                    trialEndsAt,
                  } as any,
                },
              },
            }
          : {}),
      },
      include: {
        domains: true,
        planVersion: true,
        subscription: true,
      },
    });

    await this.audit.record({
      actorId,
      tenantId: tenant.id,
      action: 'tenant.create',
      entity: 'Tenant',
      entityId: tenant.id,
      after: { slug, name: tenant.name, status: tenant.status },
    });

    return tenant;
  }

  /**
   * Operator (or job) status change. The subscription follows the tenant:
   * SUSPENDED/CANCELLED/PAST_DUE move both, and reactivating a suspended
   * tenant restores a suspended subscription to ACTIVE. Suspension and
   * reactivation emails go out here, so the jobs get them for free by
   * calling this method. A status change is pushed to the tenant backend
   * (best-effort) because the backend's subscription guard reads it.
   */
  async updateStatus(
    id: string,
    dto: UpdateTenantStatusDto,
    actorId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const now = new Date();
    const data: any = { status: dto.status as any };
    if (dto.status === 'SUSPENDED') data.suspendedAt = now;
    if (dto.status === 'ACTIVE') {
      data.suspendedAt = null;
      data.graceEndsAt = null;
    }
    if (dto.status === 'DELETED') data.deletedAt = now;

    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: id },
    });
    if (subscription) {
      if (dto.status === 'SUSPENDED' && subscription.status !== 'CANCELLED') {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'SUSPENDED' },
        });
      } else if (dto.status === 'PAST_DUE' && subscription.status === 'ACTIVE') {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'PAST_DUE' },
        });
      } else if (
        dto.status === 'ACTIVE' &&
        subscription.status === 'SUSPENDED'
      ) {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'ACTIVE' },
        });
      } else if (dto.status === 'CANCELLED') {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'CANCELLED',
            cancelAtPeriodEnd: false,
            canceledAt: now,
            endedAt: now,
          },
        });
      }
    }

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.status.update',
      entity: 'Tenant',
      entityId: id,
      before: { status: tenant.status },
      after: { status: updated.status, reason: dto.reason },
    });

    try {
      if (dto.status === 'SUSPENDED' && tenant.status !== 'SUSPENDED') {
        await this.mail.sendSuspension({
          to: tenant.ownerEmail,
          tenantName: tenant.name,
          reason: dto.reason,
        });
      } else if (
        dto.status === 'ACTIVE' &&
        (tenant.status === 'SUSPENDED' || tenant.status === 'PAST_DUE')
      ) {
        await this.mail.sendReactivation({
          to: tenant.ownerEmail,
          tenantName: tenant.name,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Status email failed for ${tenant.slug}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }

    return updated;
  }

  /**
   * Cancel a tenant. At period end (default): access continues until the
   * current period ends, then the cancel-at-period-end job cancels it.
   * Immediate: tenant + subscription are CANCELLED now.
   */
  async cancel(id: string, dto: CancelTenantDto, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: id },
    });
    if (!subscription) {
      throw new BadRequestException('This tenant has no subscription to cancel');
    }
    if (subscription.status === 'CANCELLED') {
      throw new ConflictException('This subscription is already cancelled');
    }

    const atPeriodEnd = dto.atPeriodEnd ?? true;
    if (atPeriodEnd) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true },
      });
    } else {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'CANCELLED',
            cancelAtPeriodEnd: false,
            canceledAt: now,
            endedAt: now,
          },
        }),
        this.prisma.tenant.update({
          where: { id },
          data: { status: 'CANCELLED' },
        }),
      ]);
    }

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.cancel',
      entity: 'Tenant',
      entityId: id,
      after: { atPeriodEnd },
    });
    return { tenantId: id, atPeriodEnd };
  }

  async extendTrial(id: string, days: number, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const now = new Date();
    const base =
      tenant.trialEndsAt && tenant.trialEndsAt > now
        ? tenant.trialEndsAt
        : now;
    const trialEndsAt = new Date(base.getTime() + days * 86_400_000);

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { trialEndsAt },
    });

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: id },
    });
    if (subscription) {
      await this.prisma.subscription.updateMany({
        where: { tenantId: id },
        data: { trialEndsAt, currentPeriodEnd: trialEndsAt },
      });
    }

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.trial.extend',
      entity: 'Tenant',
      entityId: id,
      before: { trialEndsAt: tenant.trialEndsAt },
      after: { trialEndsAt, days },
    });

    return updated;
  }

  /**
   * Plan change with effective dates and proration (manual credit first).
   *
   * immediate: the unused portion of the current paid period becomes a
   * credit note (no automatic refunds — the credit applies to the next
   * invoice), the version switches now, a new period starts, and the new
   * plan is invoiced (the credit applies to that invoice). Trial
   * subscriptions switch version with no proration and no invoice.
   *
   * next_period: nothing switches yet — the change is recorded as pending
   * and the renewal job applies it at period end.
   */
  async changePlan(id: string, dto: ChangePlanDto, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const planVersion = await this.prisma.planVersion.findUnique({
      where: { id: dto.planVersionId },
      include: { plan: { select: { name: true } } },
    });
    if (!planVersion) throw new NotFoundException('Plan version not found');
    if (planVersion.archivedAt) {
      throw new BadRequestException('This plan version is archived');
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: id },
      include: { planVersion: { include: { plan: { select: { name: true } } } } },
    });
    const now = new Date();
    const effectiveAt = dto.effectiveAt ?? 'immediate';

    if (effectiveAt === 'next_period') {
      if (!subscription) {
        throw new BadRequestException(
          'This tenant has no subscription to schedule a plan change for',
        );
      }
      if (subscription.status === 'CANCELLED') {
        throw new BadRequestException('This subscription is cancelled');
      }
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          pendingPlanVersionId: planVersion.id,
          pendingPlanEffectiveAt: subscription.currentPeriodEnd,
        },
      });
      await this.audit.record({
        actorId,
        tenantId: id,
        action: 'tenant.plan.change.scheduled',
        entity: 'Tenant',
        entityId: id,
        before: { planVersionId: tenant.planVersionId },
        after: {
          planVersionId: planVersion.id,
          effectiveAt: subscription.currentPeriodEnd.toISOString(),
        },
      });
      return {
        ...tenant,
        pendingPlanVersionId: planVersion.id,
        pendingPlanEffectiveAt: subscription.currentPeriodEnd,
      };
    }

    // Immediate change.
    let prorationCredit = 0;
    let invoice: { id: string; number: string } | null = null;
    const oldPrice =
      subscription && subscription.status !== 'TRIAL'
        ? Number(subscription.planVersion.price)
        : 0;
    if (subscription && oldPrice > 0 && subscription.currentPeriodEnd > now) {
      const totalDays = Math.max(
        1,
        wholeDaysBetween(
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
        ),
      );
      const unusedDays = wholeDaysBetween(now, subscription.currentPeriodEnd);
      prorationCredit =
        Math.round((oldPrice * (unusedDays / totalDays) + Number.EPSILON) * 100) /
        100;
      if (prorationCredit > 0) {
        await this.prisma.creditNote.create({
          data: {
            tenantId: id,
            amount: prorationCredit,
            currency: subscription.planVersion.currency,
            reason: `Proration credit — plan change from ${subscription.planVersion.plan.name} to ${planVersion.plan.name}`,
            appliedInvoiceId: null,
          },
        });
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { planVersionId: planVersion.id },
    });

    if (subscription) {
      const snapshot = {
        features: planVersion.features,
        limits: planVersion.limits,
        changedAt: now.toISOString(),
      } as any;
      if (subscription.status === 'TRIAL') {
        // Trial: switch the version, keep the trial dates, no money moves.
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            planVersionId: planVersion.id,
            pendingPlanVersionId: null,
            pendingPlanEffectiveAt: null,
            entitlementsSnapshot: snapshot,
          },
        });
      } else {
        const periodStart = now;
        const periodEnd = addInterval(
          periodStart,
          planVersion.interval,
          planVersion.intervalDays,
        );
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            planVersionId: planVersion.id,
            pendingPlanVersionId: null,
            pendingPlanEffectiveAt: null,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            entitlementsSnapshot: snapshot,
          },
        });
        const newPrice = Number(planVersion.price);
        if (newPrice > 0) {
          invoice = await this.invoices.createInvoice({
            tenantId: id,
            subscriptionId: subscription.id,
            lines: [
              {
                description: `${planVersion.plan.name} subscription — plan change`,
                quantity: 1,
                unitPrice: newPrice,
              },
            ],
            periodStart,
            periodEnd,
          });
        }
      }
    }

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.plan.change',
      entity: 'Tenant',
      entityId: id,
      before: { planVersionId: tenant.planVersionId },
      after: {
        planVersionId: planVersion.id,
        prorationCredit,
        invoiceId: invoice?.id ?? null,
      },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return { ...updated, prorationCredit, invoice };
  }
}
