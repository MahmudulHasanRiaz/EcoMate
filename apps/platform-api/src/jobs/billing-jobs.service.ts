import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { addInterval } from '../billing/billing-dates';
import { InvoiceService } from '../billing/invoice.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TenantsService } from '../tenants/tenants.service';
import { formatDhakaDate } from '../usage/usage.limits';

export const JOB_NAMES = [
  'trial-expiry',
  'renewal-invoices',
  'reminders',
  'grace-suspend',
  'cancel-at-period-end',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export interface JobResult {
  job: JobName;
  ranAt: string;
  /** Human-readable counts, e.g. { trialsExpired: 2, invoicesCreated: 2 }. */
  counts: Record<string, number>;
  errors: string[];
}

interface LastRun {
  lastRunAt: string;
  lastResult: JobResult | null;
  lastError: string | null;
}

const DAY_MS = 86_400_000;
const DEFAULT_INTERVAL_MS = 3_600_000; // 1 hour
const RENEWAL_NOTICE_DAYS = 3;
const TRIAL_ENDING_NOTICE_DAYS = 3;
const DEFAULT_CANCEL_AFTER_DAYS = 30;
/**
 * Max rows a single job scan processes per tick. Every scan is bounded by
 * this (with an orderBy on the date column so the oldest-due rows go
 * first); when a scan hits the cap it logs a warning and the next hourly
 * tick picks up the rest — all jobs are idempotent, so a partial tick is
 * safe. Without the cap a large tenant base turns each hourly tick into
 * an unbounded memory load.
 */
export const BILLING_JOB_BATCH_SIZE = 500;

/**
 * Billing lifecycle jobs. No external scheduler: a setInterval runner ticks
 * through all five jobs (single platform-api instance). Every job is
 * idempotent — it only acts on rows in the expected state, so a double run
 * (or a manual re-run) is a no-op. Operators can also trigger each job
 * individually via POST /jobs/:name/run.
 *
 * State machine driven here:
 *   TRIAL --trial ends--> PAST_DUE (grace) --grace ends--> SUSPENDED
 *   --30d--> CANCELLED
 *   ACTIVE --period ends unpaid--> PAST_DUE (grace) --grace ends--> SUSPENDED
 *   A paid invoice (approve) moves PAST_DUE/SUSPENDED back to ACTIVE.
 */
@Injectable()
export class BillingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingJobsService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly lastRuns = new Map<JobName, LastRun>();

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoiceService,
    private readonly tenants: TenantsService,
    private readonly mail: PlatformMailService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    if (process.env.BILLING_JOBS_ENABLED === 'false') {
      this.logger.log('Billing jobs disabled (BILLING_JOBS_ENABLED=false)');
      return;
    }
    const interval = Number(process.env.BILLING_JOBS_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.runAll().catch((error) => {
        this.logger.error(
          `Billing jobs tick failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, interval);
    this.timer.unref?.();
    this.logger.log(`Billing jobs scheduled every ${interval}ms`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  status(): { jobs: { name: JobName; lastRunAt: string | null; lastResult: JobResult | null; lastError: string | null }[] } {
    return {
      jobs: JOB_NAMES.map((name) => ({
        name,
        lastRunAt: this.lastRuns.get(name)?.lastRunAt ?? null,
        lastResult: this.lastRuns.get(name)?.lastResult ?? null,
        lastError: this.lastRuns.get(name)?.lastError ?? null,
      })),
    };
  }

  async runJob(name: JobName): Promise<JobResult> {
    const started = new Date();
    const result: JobResult = { job: name, ranAt: started.toISOString(), counts: {}, errors: [] };
    try {
      switch (name) {
        case 'trial-expiry':
          await this.trialExpiry(result);
          break;
        case 'renewal-invoices':
          await this.renewalInvoices(result);
          break;
        case 'reminders':
          await this.reminders(result);
          break;
        case 'grace-suspend':
          await this.graceSuspend(result);
          break;
        case 'cancel-at-period-end':
          await this.cancelAtPeriodEnd(result);
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      this.logger.error(`Billing job ${name} failed: ${message}`);
    }
    this.lastRuns.set(name, {
      lastRunAt: started.toISOString(),
      lastResult: result,
      lastError: result.errors[0] ?? null,
    });
    return result;
  }

  async runAll(): Promise<JobResult[]> {
    if (this.running) {
      this.logger.warn('Billing jobs tick skipped: a run is already in progress');
      return [];
    }
    this.running = true;
    try {
      const results: JobResult[] = [];
      for (const name of JOB_NAMES) {
        results.push(await this.runJob(name));
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  private graceDaysFor(planGraceDays?: number | null): number {
    if (typeof planGraceDays === 'number' && planGraceDays >= 0) {
      return planGraceDays;
    }
    return this.settings.getTrialDefaults().graceDays ?? 7;
  }

  private intervalLabel(
    interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM',
    intervalDays?: number | null,
  ): string {
    if (interval === 'YEARLY') return 'yearly';
    if (interval === 'CUSTOM') return `${intervalDays ?? 30}-day`;
    return 'monthly';
  }

  private async sendInvoiceMail(input: {
    to: string;
    tenantName: string;
    invoiceNumber: string;
    total: number;
    currency: string;
    dueAt: Date;
    periodStart?: Date | null;
    periodEnd?: Date | null;
  }): Promise<void> {
    const periodLabel =
      input.periodStart && input.periodEnd
        ? `${formatDhakaDate(input.periodStart)} to ${formatDhakaDate(input.periodEnd)}`
        : undefined;
    try {
      await this.mail.sendInvoice({ ...input, periodLabel });
    } catch (error) {
      this.logger.warn(
        `Invoice email failed for ${input.invoiceNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async createRenewalInvoice(input: {
    tenant: { id: string; name: string; ownerEmail: string };
    subscriptionId: string;
    planName: string;
    price: number;
    currency: string;
    interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
    intervalDays?: number | null;
    periodStart: Date;
    periodEnd: Date;
    dueAt: Date;
  }) {
    const label = this.intervalLabel(input.interval, input.intervalDays);
    const invoice = await this.invoices.createInvoice({
      tenantId: input.tenant.id,
      subscriptionId: input.subscriptionId,
      lines: [
        {
          description: `${input.planName} subscription — ${label} (${formatDhakaDate(input.periodStart)} to ${formatDhakaDate(input.periodEnd)})`,
          quantity: 1,
          unitPrice: input.price,
        },
      ],
      dueAt: input.dueAt,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
    await this.sendInvoiceMail({
      to: input.tenant.ownerEmail,
      tenantName: input.tenant.name,
      invoiceNumber: invoice.number,
      total: Number(invoice.total),
      currency: invoice.currency,
      dueAt: input.dueAt,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
    return invoice;
  }

  /**
   * A scan that returns exactly the batch size probably left rows behind.
   * The next hourly tick picks them up (jobs are idempotent), but the
   * operator should know the backlog is growing — a full batch every tick
   * means the cap, not the workload, is the bottleneck.
   */
  private warnIfCapped(job: string, scan: string, rows: unknown[]): void {
    if (rows.length >= BILLING_JOB_BATCH_SIZE) {
      this.logger.warn(
        `Billing job ${job}: ${scan} scan hit the ${BILLING_JOB_BATCH_SIZE}-row cap; remaining rows will be picked up on the next tick`,
      );
    }
  }

  private async trialExpiry(result: JobResult): Promise<void> {
    const now = new Date();
    const counts = { trialsExpired: 0, invoicesCreated: 0, trialEndingReminders: 0 };

    // Trial-ending reminders (3 days before expiry, once per subscription).
    const endingSoon = await this.prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndsAt: {
          gt: now,
          lte: new Date(now.getTime() + TRIAL_ENDING_NOTICE_DAYS * DAY_MS),
        },
      },
      orderBy: { trialEndsAt: 'asc' },
      take: BILLING_JOB_BATCH_SIZE,
      include: {
        tenant: { select: { id: true, name: true, ownerEmail: true, status: true } },
        planVersion: { include: { plan: { select: { name: true } } } },
      },
    });
    this.warnIfCapped('trial-expiry', 'trial-ending reminders', endingSoon);
    for (const subscription of endingSoon) {
      if (subscription.tenant.status === 'DELETED') continue;
      const sent = await this.prisma.invoiceReminder.findUnique({
        where: {
          tenantId_kind_referenceId: {
            tenantId: subscription.tenantId,
            kind: 'TRIAL_ENDING',
            referenceId: subscription.id,
          },
        },
      });
      if (sent) continue;
      try {
        await this.mail.sendTrialEnding({
          to: subscription.tenant.ownerEmail,
          tenantName: subscription.tenant.name,
          trialEndsAt: subscription.trialEndsAt!,
          planName: subscription.planVersion.plan.name,
        });
      } catch (error) {
        this.logger.warn(
          `Trial-ending email failed for ${subscription.tenantId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      await this.prisma.invoiceReminder.create({
        data: {
          tenantId: subscription.tenantId,
          kind: 'TRIAL_ENDING',
          referenceId: subscription.id,
        },
      });
      counts.trialEndingReminders += 1;
    }

    // Expired trials: first renewal invoice + PAST_DUE with a grace window.
    const expired = await this.prisma.subscription.findMany({
      where: { status: 'TRIAL', trialEndsAt: { lte: now } },
      orderBy: { trialEndsAt: 'asc' },
      take: BILLING_JOB_BATCH_SIZE,
      include: {
        tenant: { select: { id: true, name: true, ownerEmail: true, status: true } },
        planVersion: { include: { plan: { select: { name: true } } } },
      },
    });
    this.warnIfCapped('trial-expiry', 'expired trials', expired);
    for (const subscription of expired) {
      if (subscription.tenant.status === 'DELETED') continue;
      const price = Number(subscription.planVersion.price);
      const graceDays = this.graceDaysFor(subscription.planVersion.graceDays);
      const graceEndsAt = new Date(now.getTime() + graceDays * DAY_MS);
      try {
        if (price <= 0) {
          // Free plan: no invoice, the tenant just keeps going.
          const periodEnd = addInterval(
            now,
            subscription.planVersion.interval,
            subscription.planVersion.intervalDays,
          );
          await this.prisma.$transaction([
            this.prisma.subscription.update({
              where: { id: subscription.id },
              data: {
                status: 'ACTIVE',
                trialEndsAt: null,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
              },
            }),
            this.prisma.tenant.update({
              where: { id: subscription.tenantId },
              data: { status: 'ACTIVE', trialEndsAt: null },
            }),
          ]);
          counts.trialsExpired += 1;
          continue;
        }
        const periodStart = now;
        const periodEnd = addInterval(
          periodStart,
          subscription.planVersion.interval,
          subscription.planVersion.intervalDays,
        );
        await this.createRenewalInvoice({
          tenant: subscription.tenant,
          subscriptionId: subscription.id,
          planName: subscription.planVersion.plan.name,
          price,
          currency: subscription.planVersion.currency,
          interval: subscription.planVersion.interval,
          intervalDays: subscription.planVersion.intervalDays,
          periodStart,
          periodEnd,
          dueAt: graceEndsAt,
        });
        counts.invoicesCreated += 1;
        await this.prisma.$transaction([
          this.prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'PAST_DUE' },
          }),
          this.prisma.tenant.update({
            where: { id: subscription.tenantId },
            data: { status: 'PAST_DUE', graceEndsAt },
          }),
        ]);
        counts.trialsExpired += 1;
        await this.audit.record({
          tenantId: subscription.tenantId,
          action: 'billing.job.trial-expired',
          entity: 'Subscription',
          entityId: subscription.id,
          after: { graceEndsAt: graceEndsAt.toISOString() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`trial ${subscription.tenantId}: ${message}`);
        this.logger.error(`Trial expiry failed for ${subscription.tenantId}: ${message}`);
      }
    }
    result.counts = { ...result.counts, ...counts };
  }

  private async renewalInvoices(result: JobResult): Promise<void> {
    const now = new Date();
    const counts = { invoicesCreated: 0, expiredToPastDue: 0, pendingApplied: 0 };
    const dueSoon = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: {
          lte: new Date(now.getTime() + RENEWAL_NOTICE_DAYS * DAY_MS),
        },
      },
      orderBy: { currentPeriodEnd: 'asc' },
      take: BILLING_JOB_BATCH_SIZE,
      include: {
        tenant: { select: { id: true, name: true, ownerEmail: true, status: true } },
        planVersion: { include: { plan: { select: { name: true } } } },
        pendingPlanVersion: { include: { plan: { select: { name: true } } } },
      },
    });
    this.warnIfCapped('renewal-invoices', 'renewals due soon', dueSoon);
    for (const subscription of dueSoon) {
      if (subscription.tenant.status === 'DELETED') continue;
      const periodEnded = subscription.currentPeriodEnd <= now;
      try {
        // Apply a pending next-period plan change before invoicing, so the
        // renewal invoice prices the new plan.
        let planVersion = subscription.planVersion;
        if (
          subscription.pendingPlanVersionId &&
          subscription.pendingPlanVersion &&
          subscription.pendingPlanEffectiveAt &&
          subscription.pendingPlanEffectiveAt <= subscription.currentPeriodEnd
        ) {
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              planVersionId: subscription.pendingPlanVersionId,
              pendingPlanVersionId: null,
              pendingPlanEffectiveAt: null,
              entitlementsSnapshot: {
                features: subscription.pendingPlanVersion.features,
                limits: subscription.pendingPlanVersion.limits,
                changedAt: now.toISOString(),
              } as any,
            },
          });
          await this.prisma.tenant.update({
            where: { id: subscription.tenantId },
            data: { planVersionId: subscription.pendingPlanVersionId },
          });
          await this.audit.record({
            tenantId: subscription.tenantId,
            action: 'tenant.plan.change',
            entity: 'Tenant',
            entityId: subscription.tenantId,
            before: { planVersionId: subscription.planVersionId },
            after: {
              planVersionId: subscription.pendingPlanVersionId,
              source: 'pending-plan-change',
            },
          });
          planVersion = subscription.pendingPlanVersion;
          counts.pendingApplied += 1;
        }

        const price = Number(planVersion.price);
        if (price <= 0) {
          // Free plan: roll the period forward, no invoice.
          const periodEnd = addInterval(
            subscription.currentPeriodEnd > now ? subscription.currentPeriodEnd : now,
            planVersion.interval,
            planVersion.intervalDays,
          );
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: { currentPeriodStart: now, currentPeriodEnd: periodEnd },
          });
          continue;
        }

        const periodStart = subscription.currentPeriodEnd;
        const periodEnd = addInterval(
          periodStart,
          planVersion.interval,
          planVersion.intervalDays,
        );
        const existing = await this.prisma.invoice.findFirst({
          where: {
            subscriptionId: subscription.id,
            status: 'OPEN',
            periodStart: { gte: periodStart },
          },
          select: { id: true },
        });
        const graceDays = this.graceDaysFor(planVersion.graceDays);
        if (!existing) {
          await this.createRenewalInvoice({
            tenant: subscription.tenant,
            subscriptionId: subscription.id,
            planName: planVersion.plan.name,
            price,
            currency: planVersion.currency,
            interval: planVersion.interval,
            intervalDays: planVersion.intervalDays,
            periodStart,
            periodEnd,
            dueAt: periodEnded
              ? new Date(now.getTime() + graceDays * DAY_MS)
              : periodStart,
          });
          counts.invoicesCreated += 1;
        }
        if (periodEnded) {
          const graceEndsAt = new Date(now.getTime() + graceDays * DAY_MS);
          await this.prisma.$transaction([
            this.prisma.subscription.update({
              where: { id: subscription.id },
              data: { status: 'PAST_DUE' },
            }),
            this.prisma.tenant.update({
              where: { id: subscription.tenantId },
              data: { status: 'PAST_DUE', graceEndsAt },
            }),
          ]);
          counts.expiredToPastDue += 1;
          await this.audit.record({
            tenantId: subscription.tenantId,
            action: 'billing.job.period-expired',
            entity: 'Subscription',
            entityId: subscription.id,
            after: { graceEndsAt: graceEndsAt.toISOString() },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`renewal ${subscription.tenantId}: ${message}`);
        this.logger.error(`Renewal failed for ${subscription.tenantId}: ${message}`);
      }
    }
    result.counts = { ...result.counts, ...counts };
  }

  private async reminders(result: JobResult): Promise<void> {
    const now = new Date();
    const counts = { dueSoon: 0, overdue: 0 };
    // Push the dueAt window into the query: the old code loaded EVERY open
    // invoice and filtered in memory. The (status, dueAt) index serves this
    // shape. The in-memory classifier below still decides OVERDUE vs
    // DUE_SOON per invoice.
    const open = await this.prisma.invoice.findMany({
      where: {
        status: 'OPEN',
        dueAt: { lte: new Date(now.getTime() + RENEWAL_NOTICE_DAYS * DAY_MS) },
      },
      orderBy: { dueAt: 'asc' },
      take: BILLING_JOB_BATCH_SIZE,
      include: {
        tenant: { select: { id: true, name: true, ownerEmail: true, status: true } },
      },
    });
    this.warnIfCapped('reminders', 'open invoices due soon/overdue', open);
    for (const invoice of open) {
      if (invoice.tenant.status === 'DELETED') continue;
      const kind =
        invoice.dueAt <= now
          ? 'OVERDUE'
          : invoice.dueAt.getTime() - now.getTime() <= RENEWAL_NOTICE_DAYS * DAY_MS
            ? 'DUE_SOON'
            : null;
      if (!kind) continue;
      const sent = await this.prisma.invoiceReminder.findUnique({
        where: {
          tenantId_kind_referenceId: {
            tenantId: invoice.tenantId,
            kind,
            referenceId: invoice.id,
          },
        },
      });
      if (sent) continue;
      try {
        await this.sendInvoiceMail({
          to: invoice.tenant.ownerEmail,
          tenantName: invoice.tenant.name,
          invoiceNumber: invoice.number,
          total: Number(invoice.total),
          currency: invoice.currency,
          dueAt: invoice.dueAt,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`reminder ${invoice.number}: ${message}`);
        continue;
      }
      await this.prisma.invoiceReminder.create({
        data: { tenantId: invoice.tenantId, kind, referenceId: invoice.id },
      });
      counts[kind === 'OVERDUE' ? 'overdue' : 'dueSoon'] += 1;
    }
    result.counts = { ...result.counts, ...counts };
  }

  private async graceSuspend(result: JobResult): Promise<void> {
    const now = new Date();
    const counts = { suspended: 0, cancelled: 0 };
    const cancelAfterDays =
      Number(process.env.BILLING_CANCEL_AFTER_DAYS) || DEFAULT_CANCEL_AFTER_DAYS;

    const pastGrace = await this.prisma.tenant.findMany({
      where: {
        status: 'PAST_DUE',
        graceEndsAt: { lte: now },
      },
      orderBy: { graceEndsAt: 'asc' },
      take: BILLING_JOB_BATCH_SIZE,
      select: { id: true, slug: true },
    });
    this.warnIfCapped('grace-suspend', 'tenants past grace', pastGrace);
    for (const tenant of pastGrace) {
      try {
        await this.tenants.updateStatus(
          tenant.id,
          { status: 'SUSPENDED', reason: 'Grace period ended with an unpaid invoice' } as any,
        );
        counts.suspended += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`suspend ${tenant.id}: ${message}`);
      }
    }

    // No dedicated (status, suspendedAt) index: the existing
    // (status, createdAt) index narrows to the SUSPENDED subset (tiny by
    // nature), and the sort runs over that subset only. Revisit if
    // suspended tenants ever number in the thousands.
    const stale = await this.prisma.tenant.findMany({
      where: {
        status: 'SUSPENDED',
        suspendedAt: { lte: new Date(now.getTime() - cancelAfterDays * DAY_MS) },
      },
      orderBy: { suspendedAt: 'asc' },
      take: BILLING_JOB_BATCH_SIZE,
      select: { id: true },
    });
    this.warnIfCapped('grace-suspend', 'stale suspended tenants', stale);
    for (const tenant of stale) {
      try {
        await this.tenants.updateStatus(
          tenant.id,
          { status: 'CANCELLED', reason: `Suspended for ${cancelAfterDays} days without payment` } as any,
        );
        counts.cancelled += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`cancel ${tenant.id}: ${message}`);
      }
    }
    result.counts = { ...result.counts, ...counts };
  }

  private async cancelAtPeriodEnd(result: JobResult): Promise<void> {
    const now = new Date();
    const counts = { cancelled: 0 };
    const due = await this.prisma.subscription.findMany({
      where: { cancelAtPeriodEnd: true, currentPeriodEnd: { lte: now } },
      orderBy: { currentPeriodEnd: 'asc' },
      take: BILLING_JOB_BATCH_SIZE,
      include: { tenant: { select: { id: true, status: true } } },
    });
    this.warnIfCapped('cancel-at-period-end', 'subscriptions due to cancel', due);
    for (const subscription of due) {
      if (subscription.tenant.status === 'DELETED') continue;
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
          where: { id: subscription.tenantId },
          data: { status: 'CANCELLED' },
        }),
      ]);
      counts.cancelled += 1;
      await this.audit.record({
        tenantId: subscription.tenantId,
        action: 'billing.job.cancelled-at-period-end',
        entity: 'Subscription',
        entityId: subscription.id,
        after: { endedAt: now.toISOString() },
      });
    }
    result.counts = { ...result.counts, ...counts };
  }
}
