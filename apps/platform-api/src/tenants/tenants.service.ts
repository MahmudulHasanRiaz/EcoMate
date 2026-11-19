import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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
import { EmailBalanceService } from '../email-balance/email-balance.service';
import { parsePricingDocument } from '../pricing/pricing-document';
import { PricingEngine } from '../pricing/pricing-engine';
import { PricingService } from '../pricing/pricing.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import {
  DEFAULT_TRIAL_DAYS,
  SettingsService,
} from '../settings/settings.service';
import { formatDhakaDate } from '../usage/usage.limits';
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
    // ProvisioningModule is @Global(), so no module wiring is needed.
    private readonly provisioning: ProvisioningService,
    private readonly pricing: PricingService,
    private readonly emailBalance: EmailBalanceService,
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
        // The latest provisioning job drives the console's provisioning
        // status banner + retry button (F1).
        provisioningJobs: { orderBy: { createdAt: 'desc' }, take: 1 },
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
    // With an owner password the tenant is provisioned immediately (below):
    // it starts PROVISIONING and the provisioning run flips it to TRIAL on
    // success — or leaves it PROVISIONING with a FAILED job on failure, so
    // the operator can retry. Without a password the old behaviour stands
    // (TRIAL/PENDING_VERIFICATION, unprovisioned).
    const shouldProvision = !!dto.ownerPassword;
    const status = shouldProvision
      ? 'PROVISIONING'
      : planVersion
        ? 'TRIAL'
        : 'PENDING_VERIFICATION';

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
                  // Free months (§4.6): set from the version's freeMonths
                  // at provisioning; consumed by the renewal job after
                  // the trial ends. Trial expiry also honours the
                  // version value as a fallback.
                  freePeriodsRemaining:
                    parsePricingDocument(planVersion.pricing).freeMonths ??
                    0,
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

    // Free email starter grant (§6): once per tenant, idempotent — the
    // provisioning run calls the same grant, so a tenant created with a
    // password is granted here and the provisioning call is a no-op.
    // Best-effort with a loud log: a grant failure must never fail the
    // tenant create (the operator can grant the same count via the
    // console balance adjustment).
    try {
      await this.emailBalance.grantFreeAllowance(tenant.id);
    } catch (err) {
      this.logger.error(
        `Free email grant failed for tenant ${slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!shouldProvision) return tenant;

    // Provision through the SAME path as a verified public signup: create a
    // synthetic VERIFIED signup request (the operator has already verified
    // the owner by creating the tenant) and run the provisioning job
    // synchronously so the operator gets the definitive outcome. The job's
    // ensureTenant reuses this tenant (same slug + owner email), and run()
    // flips the tenant to TRIAL + the primary domain to ACTIVE on success.
    // The welcome email is best-effort inside run() — provisioning still
    // succeeds when SMTP is unconfigured.
    const passwordHash = await bcrypt.hash(dto.ownerPassword as string, 12);
    const signup = await this.prisma.signupRequest.create({
      data: {
        tenantName: tenant.name,
        slug,
        ownerEmail: tenant.ownerEmail,
        ownerPhone: tenant.ownerPhone ?? null,
        passwordHash,
        status: 'VERIFIED',
        verifiedAt: now,
      },
    });
    const job = await this.provisioning.startForSignup(signup.id);
    await this.audit.record({
      actorId,
      tenantId: tenant.id,
      action: 'tenant.provisioning',
      entity: 'Tenant',
      entityId: tenant.id,
      after: job
        ? {
            jobId: job.id,
            status: job.status,
            step: job.step,
            error: job.error ?? null,
          }
        : { status: 'NOT_STARTED' },
    });

    // Re-fetch so the caller sees the post-run status (TRIAL on success,
    // PROVISIONING with the FAILED job on failure) instead of the
    // pre-provisioning snapshot.
    return this.detail(tenant.id);
  }

  /**
   * Retry the tenant's latest provisioning job (F1). Only FAILED/PENDING
   * jobs re-run — a SUCCEEDED job is returned as-is, and a tenant with no
   * job (created without a password) gets a clear 400 instead of a silent
   * no-op.
   */
  async retryProvisioning(id: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const job = await this.prisma.provisioningJob.findFirst({
      where: { tenantId: id },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) {
      throw new BadRequestException(
        'This tenant has no provisioning job to retry',
      );
    }
    if (job.status === 'SUCCEEDED') return job;
    const retried = await this.provisioning.retry(job.id);
    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.provisioning.retry',
      entity: 'Tenant',
      entityId: id,
      after: {
        jobId: job.id,
        status: retried?.status ?? null,
        step: retried?.step ?? null,
      },
    });
    return retried;
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
    if (dto.status === 'ACTIVE' || dto.status === 'TRIAL') {
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
      } else if (
        dto.status === 'TRIAL' &&
        subscription.status === 'SUSPENDED'
      ) {
        // Restoring a suspended trial tenant to TRIAL must restore its
        // subscription too — otherwise the tenant stays write-blocked
        // forever: the subscription guard blocks SUSPENDED subscriptions
        // regardless of tenant status, and no other operator path moves
        // a subscription out of SUSPENDED for a trial tenant.
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'TRIAL' },
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
    let usageInvoice: { id: string; number: string } | null = null;

    // Metered close-out (§4.5): an old metered plan closes out with a
    // metered invoice for usage-to-date (minimum pro-rata by days used).
    // The usage read + compute happen FIRST, before any write, so a
    // failed usage fetch aborts the change cleanly instead of leaving a
    // half-switched subscription. The close-out bills USAGE ONLY — the
    // base fee's unused portion is the proration credit below, and the
    // add-ons stay attached (their base fees bill at the next renewal).
    // freePeriodsRemaining survives the change untouched (it belongs to
    // the subscription, not the version); the new version's freeMonths
    // does NOT re-grant.
    const oldPricing = subscription
      ? parsePricingDocument(subscription.planVersion.pricing)
      : null;
    let closeOut: {
      lines: Array<{ description: string; quantity: number; unitPrice: number }>;
      total: number;
      trace: Record<string, unknown>;
    } | null = null;
    if (
      subscription &&
      oldPricing?.metering &&
      subscription.status !== 'TRIAL' &&
      subscription.currentPeriodEnd > now
    ) {
      const resolved = await this.pricing.resolveForSubscription(
        subscription.id,
        subscription.planVersion,
      );
      const usage = await this.pricing.fetchPeriodUsage(
        id,
        tenant.slug,
        subscription.currentPeriodStart,
        now,
      );
      const totalDays = Math.max(
        1,
        wholeDaysBetween(
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
        ),
      );
      const usedDays = wholeDaysBetween(
        subscription.currentPeriodStart,
        now,
      );
      const computed = PricingEngine.compute({
        pricing: {
          ...resolved.pricing,
          baseFee: { amount: 0, currency: 'BDT' },
        },
        sources: resolved.sources,
        addOns: resolved.addOns.map((addOn) => ({
          ...addOn,
          baseFee: 0,
        })),
        usage,
        period: { start: subscription.currentPeriodStart, end: now },
        planName: subscription.planVersion.plan.name,
        intervalLabel: 'metered usage',
        periodLabel: `${formatDhakaDate(subscription.currentPeriodStart)} to ${formatDhakaDate(now)}`,
        minimumProrationFactor: usedDays / totalDays,
      });
      if (computed.total > 0) {
        closeOut = {
          lines: computed.lines,
          total: computed.total,
          trace: computed.trace as unknown as Record<string, unknown>,
        };
      }
    }

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
            kind: 'SUBSCRIPTION',
            periodStart,
            periodEnd,
          });
        }
      }
    }

    // The usage invoice stands alone (kind METERED, NO subscriptionId):
    // paying it must not move the subscription's new period, and it does
    // not clear PAST_DUE. The proration credit auto-applies to the
    // new-plan invoice as today — never to this invoice.
    if (closeOut && subscription) {
      usageInvoice = await this.invoices.createInvoice(
        {
          tenantId: id,
          lines: closeOut.lines,
          kind: 'METERED',
          metadata: closeOut.trace,
          periodStart: subscription.currentPeriodStart,
          periodEnd: now,
          notes: `Metered close-out — plan change from ${subscription.planVersion.plan.name} to ${planVersion.plan.name}`,
        },
        actorId,
      );
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
        usageInvoiceId: usageInvoice?.id ?? null,
      },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return { ...updated, prorationCredit, invoice, usageInvoice };
  }
}
