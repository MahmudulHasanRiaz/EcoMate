import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DomainConfigService } from '../config/domain-config.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { EmailBalanceService } from '../email-balance/email-balance.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { parsePricingDocument } from '../pricing/pricing-document';
import { SettingsService } from '../settings/settings.service';

/** Slug of the seeded trial plan (prisma/seed.ts) — the only plan whose
 * trial period gets the full-product add-on attach (Boss 2026-11-21).
 * The billing jobs share this: a trial-plan trial never auto-renews
 * into ACTIVE at trial end (trial-end design 2026-11-22). */
export const TRIAL_PLAN_SLUG = 'trial';

/** Add-on slugs NEVER attached to a trial, even when the operator lists
 * them in the trial settings:
 * - 'custom-domain' (Boss 2026-11-19: trial tenants don't get custom
 *   domains; the 2026-11-21 "trial = full product" decision covered
 *   storefront + POS only and did not reverse this exclusion).
 * - 'external-stores' (Phase 9 ruling D3: central commerce is a heavy
 *   paid add-on; trial = full product covered storefront + POS only).
 *   Boss can enable it from the console later (trial contents are
 *   console-configurable) — but the default attach never includes it.
 */
const TRIAL_EXCLUDED_ADD_ON_SLUGS = ['custom-domain', 'external-stores'];

const TRIAL_DAYS_FALLBACK = 14;
const FETCH_TIMEOUT_MS = 15_000;
const STALE_JOB_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

function staleAfterMs(): number {
  const raw = Number(process.env.PROVISIONING_STALE_MS);
  return Number.isFinite(raw) && raw >= 60_000 ? raw : STALE_JOB_MS;
}

function apiBase(): string {
  const configured = (
    process.env.TENANT_BACKEND_URL || 'http://backend:4000/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

/**
 * Orchestrates tenant provisioning after email verification.
 *
 * Platform rows (tenant, subdomain, trial subscription, entitlement snapshot)
 * are created first; the tenant database is then seeded through the tenant
 * backend's internal endpoint, which runs under an explicit tenant context.
 * The job is idempotent per signup (unique signupId) and every step is
 * resumable: a failed run leaves the tenant in PROVISIONING and the job FAILED
 * with the error, ready for a retry.
 */
@Injectable()
export class ProvisioningService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProvisioningService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domainConfig: DomainConfigService,
    private readonly mail: PlatformMailService,
    private readonly emailBalance: EmailBalanceService,
    // @Optional: older specs construct this service without settings; the
    // attach then falls back to the default (all active except
    // custom-domain). In production SettingsModule is @Global, so this
    // is always present.
    @Optional() private readonly settings?: SettingsService,
  ) {}

  onModuleInit() {
    void this.sweepStaleJobs().catch(() => undefined);
    this.sweepTimer = setInterval(() => {
      void this.sweepStaleJobs().catch(() => undefined);
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * A platform restart mid-run would leave a job RUNNING forever. Mark it
   * FAILED once it is older than the stale window so the owner can retry.
   */
  async sweepStaleJobs(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - staleAfterMs());
    const result = await this.prisma.provisioningJob.updateMany({
      where: { status: 'RUNNING', updatedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        step: 'failed',
        error:
          'Provisioning was interrupted. Retry to resume; your workspace data is safe.',
      },
    });
    return result.count;
  }

  async startForSignup(signupId: string) {
    const signup = await this.prisma.signupRequest.findUnique({
      where: { id: signupId },
    });
    if (!signup || signup.status !== 'VERIFIED') return null;

    const existingJob = await this.prisma.provisioningJob.findUnique({
      where: { signupId },
      include: { tenant: true },
    });
    if (existingJob?.status === 'SUCCEEDED' || existingJob?.status === 'RUNNING') {
      return existingJob;
    }

    let job = existingJob;
    if (!job) {
      const planVersion = await this.resolvePlanVersion();
      const tenant = await this.ensureTenant(signup, planVersion);
      job = await this.prisma.provisioningJob.create({
        data: {
          tenantId: tenant.id,
          signupId,
          status: 'PENDING',
          step: 'tenant_created',
        },
        include: { tenant: true },
      });
    }

    return this.run(job.id);
  }

  async retry(jobId: string) {
    const job = await this.prisma.provisioningJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new ConflictException('Provisioning job not found');
    if (job.status === 'SUCCEEDED') return job;
    await this.prisma.tenantDomain.updateMany({
      where: { tenantId: job.tenantId, isPrimary: true },
      data: { status: 'PENDING' },
    });
    await this.prisma.provisioningJob.update({
      where: { id: jobId },
      data: { status: 'PENDING', step: 'retrying', error: null },
    });
    return this.run(jobId);
  }

  private async run(jobId: string) {
    const claimed = await this.prisma.provisioningJob.updateMany({
      where: { id: jobId, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'RUNNING',
        step: 'seeding',
        error: null,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      return this.prisma.provisioningJob.findUnique({ where: { id: jobId } });
    }

    const job = await this.prisma.provisioningJob.findUnique({
      where: { id: jobId },
      include: { tenant: true },
    });
    if (!job) return null;

    const signup = job.signupId
      ? await this.prisma.signupRequest.findUnique({
          where: { id: job.signupId },
        })
      : null;
    if (!signup) {
      return this.fail(jobId, 'Signup request is missing for this job');
    }

    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      return this.fail(
        jobId,
        'INTERNAL_SERVICE_SECRET is not configured; tenant bootstrap is unavailable',
      );
    }

    const host = this.domainConfig.canonicalHost(job.tenant.slug);
    try {
      const response = await fetch(`${apiBase()}/internal/provisioning`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform-service-token': secret,
        },
        body: JSON.stringify({
          tenantId: job.tenant.id,
          slug: job.tenant.slug,
          name: job.tenant.name,
          ownerEmail: signup.ownerEmail,
          ownerPhone: signup.ownerPhone ?? undefined,
          ownerName: `${job.tenant.name} Owner`,
          passwordHash: signup.passwordHash,
          canonicalDomain: `https://${host}`,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `tenant bootstrap HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
        );
      }

      await this.prisma.provisioningJob.update({
        where: { id: jobId },
        data: { step: 'seeded' },
      });

      let welcomeDelivered = true;
      try {
        await this.mail.sendWelcome({
          to: signup.ownerEmail,
          tenantName: job.tenant.name,
          adminUrl: this.domainConfig.absoluteUrl(job.tenant.slug, '/admin/'),
          storefrontUrl: this.domainConfig.absoluteUrl(job.tenant.slug, '/'),
        });
      } catch (err) {
        welcomeDelivered = false;
        this.logger.warn(
          `Tenant ${job.tenant.slug} provisioned, but the welcome email failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      await this.prisma.tenant.update({
        where: { id: job.tenantId },
        data: { status: 'TRIAL' },
      });

      // Free email starter grant (§6): once per tenant, idempotent — the
      // admin-create path calls the same grant, so a tenant created with
      // a password is granted at create time and this call is a no-op.
      // Best-effort with a loud log: a grant failure must never fail a
      // provisioning run that already seeded the workspace (the operator
      // can grant the same count via the console balance adjustment).
      try {
        await this.emailBalance.grantFreeAllowance(job.tenantId);
      } catch (err) {
        this.logger.error(
          `Free email grant failed for tenant ${job.tenant.slug}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      // The host becomes routable only after the workspace is fully seeded and
      // the welcome mail has been attempted.
      await this.prisma.tenantDomain.updateMany({
        where: { tenantId: job.tenantId, isPrimary: true },
        data: { status: 'ACTIVE' },
      });

      const completed = await this.prisma.provisioningJob.update({
        where: { id: jobId },
        data: {
          status: 'SUCCEEDED',
          step: welcomeDelivered ? 'completed' : 'completed_without_welcome_email',
        },
      });

      // The backend polls the registry every 60s; without a push, the new
      // tenant's host 403s for up to a minute after provisioning. Best-effort:
      // a failed refresh only costs the wait until the next poll.
      await this.notifyBackendRegistryRefresh(secret, job.tenant.slug);
      return completed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Provisioning ${job.tenant.slug} failed: ${message}`);
      const rollbackError = await this.rollbackTenant(job.tenant, secret);
      return this.fail(
        jobId,
        rollbackError
          ? `${message}; tenant rollback failed: ${rollbackError}`
          : `${message}; partial tenant seed rolled back`,
      );
    }
  }

  /**
   * Best-effort cleanup of the tenant database after a failed bootstrap. The
   * platform rows stay (tenant PROVISIONING, domain PENDING, job FAILED) so a
   * retry can reuse them; only the partial seed is removed.
   */
  /**
   * Asks the tenant backend to refresh its registry immediately so the new
   * tenant's host is routable without waiting for the 60s poll. Never
   * throws: a failed push only costs the wait until the next poll.
   */
  private async notifyBackendRegistryRefresh(
    secret: string,
    slug: string,
  ): Promise<void> {
    try {
      const response = await fetch(
        `${apiBase()}/internal/tenants/registry/refresh`,
        {
          method: 'POST',
          headers: { 'x-platform-service-token': secret },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) {
        this.logger.warn(
          `Backend registry refresh for ${slug} returned HTTP ${response.status}; the next 60s poll will pick it up`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Backend registry refresh for ${slug} failed (${err instanceof Error ? err.message : String(err)}); the next 60s poll will pick it up`,
      );
    }
  }

  private async rollbackTenant(
    tenant: { id: string; slug: string },
    secret: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(`${apiBase()}/internal/provisioning/rollback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform-service-token': secret,
        },
        body: JSON.stringify({ tenantId: tenant.id, slug: tenant.slug }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return `HTTP ${response.status}`;
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  private async fail(jobId: string, message: string) {
    return this.prisma.provisioningJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', step: 'failed', error: message.slice(0, 2_000) },
    });
  }

  private async ensureTenant(
    signup: {
      slug: string;
      tenantName: string;
      ownerEmail: string;
      ownerPhone: string | null;
    },
    planVersion: {
      id: string;
      features: string[];
      limits: unknown;
      pricing?: unknown;
      trialDays: number;
      plan: { name: string };
    },
  ) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: signup.slug },
      include: { domains: true },
    });
    if (existing) {
      if (existing.ownerEmail.toLowerCase() !== signup.ownerEmail.toLowerCase()) {
        throw new ConflictException(
          'This store address was provisioned for another owner',
        );
      }
      // Retry path: the subscription exists already; make sure the
      // trial add-ons are attached (idempotent — skipDuplicates).
      await this.attachTrialAddOns(existing.id);
      return existing;
    }

    const primaryDomain = this.domainConfig.getConfig().primaryDomain;
    const now = new Date();
    const trialDays = planVersion.trialDays || TRIAL_DAYS_FALLBACK;
    const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);
    const host = `${signup.slug}.${primaryDomain}`;

    try {
      const created = await this.prisma.tenant.create({
        data: {
          slug: signup.slug,
          name: signup.tenantName,
          ownerEmail: signup.ownerEmail,
          ownerPhone: signup.ownerPhone,
          status: 'PROVISIONING',
          planVersionId: planVersion.id,
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
          domains: {
            create: {
              host,
              type: 'SUBDOMAIN',
              baseDomain: primaryDomain,
              isPrimary: true,
              status: 'PENDING',
            },
          },
          subscription: {
            create: {
              planVersionId: planVersion.id,
              status: 'TRIAL',
              currentPeriodStart: now,
              currentPeriodEnd: trialEndsAt,
              trialEndsAt,
              // Free months (§4.6): set from the version's freeMonths
              // at provisioning; consumed by the renewal job after the
              // trial ends.
              freePeriodsRemaining:
                parsePricingDocument(planVersion.pricing).freeMonths ?? 0,
              entitlementsSnapshot: {
                features: planVersion.features,
                limits: planVersion.limits,
                planName: planVersion.plan.name,
                trialEndsAt: trialEndsAt.toISOString(),
              } as any,
            },
          },
        },
        include: { domains: true, subscription: true },
      });
      // Trial = the full product (Boss 2026-11-21): on the trial plan,
      // the configured trial add-ons (default: every active add-on
      // except custom-domain and external-stores — storefront, POS,
      // SMTP, …) attach free for the trial. Rows are trial-granted:
      // never billed until the tenant confirms them at conversion
      // (trial-end design 2026-11-22). attachTrialAddOns enforces the
      // trial-plan-only + no-custom-domain / no-external-stores rules.
      await this.attachTrialAddOns(created.id);
      return created;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const raced = await this.prisma.tenant.findUnique({
          where: { slug: signup.slug },
        });
        if (raced) {
          await this.attachTrialAddOns(raced.id);
          return raced;
        }
      }
      throw err;
    }
  }

  /**
   * Attach the configured trial add-ons to a TRIAL subscription on the
   * TRIAL PLAN, free for the trial period. Best-effort with a loud log
   * (like the free-email grant): a failed attach must never fail
   * provisioning — the trial plan version itself already includes
   * every catalogue feature, so entitlements stay complete and the
   * operator can attach from the console. Idempotent
   * (skipDuplicates) for the retry path.
   *
   * Trial-plan only: a paid plan's trial period trials THAT plan — a
   * Base-plan trial must not silently collect every add-on. The
   * custom-domain and external-stores add-ons are excluded even on the
   * trial plan (Boss 2026-11-19; Phase 9 ruling D3).
   *
   * Which add-ons attach is console-configurable (Settings → Trial,
   * `trialAddOnSlugs`): null = every active add-on except custom-domain
   * and external-stores (today's behaviour, the default); [] = no
   * add-ons; a list = exactly those slugs (unknown/inactive slugs
   * ignored, excluded slugs filtered out). Rows are created
   * trial-granted: never billed until the tenant confirms them at
   * conversion (trial-end design 2026-11-22).
   */
  private async attachTrialAddOns(tenantId: string): Promise<void> {
    try {
      const subscription = await this.prisma.subscription.findUnique({
        where: { tenantId },
        select: {
          id: true,
          status: true,
          planVersion: { select: { plan: { select: { slug: true } } } },
        },
      });
      if (!subscription || subscription.status !== 'TRIAL') return;
      if (subscription.planVersion?.plan?.slug !== TRIAL_PLAN_SLUG) return;
      const configuredSlugs =
        this.settings?.getTrialDefaults().trialAddOnSlugs ?? null;
      // An explicitly empty list means "a trial with no add-ons".
      if (configuredSlugs !== null && configuredSlugs.length === 0) return;
      const addOns = await this.prisma.addOn.findMany({
        where:
          configuredSlugs === null
            ? {
                isActive: true,
                slug: { notIn: TRIAL_EXCLUDED_ADD_ON_SLUGS },
              }
            : {
                isActive: true,
                slug: {
                  in: configuredSlugs.filter(
                    (slug) => !TRIAL_EXCLUDED_ADD_ON_SLUGS.includes(slug),
                  ),
                },
              },
        select: { id: true },
      });
      if (addOns.length === 0) return;
      await this.prisma.subscriptionAddOn.createMany({
        data: addOns.map((addOn) => ({
          subscriptionId: subscription.id,
          addOnId: addOn.id,
          startedAt: new Date(),
          trialGranted: true,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.error(
        `Trial add-on attach failed for tenant ${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async resolvePlanVersion() {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: 'default_plan_version_id' },
    });
    const explicitId =
      process.env.DEFAULT_PLAN_VERSION_ID ||
      (typeof setting?.value === 'string' ? setting.value : undefined);

    const include = { plan: { select: { name: true, isActive: true } } } as const;
    if (explicitId) {
      const explicit = await this.prisma.planVersion.findUnique({
        where: { id: explicitId },
        include,
      });
      if (!explicit || explicit.archivedAt) {
        throw new Error('DEFAULT_PLAN_VERSION_ID is not a usable plan version');
      }
      return explicit;
    }

    // Explicit signup default (Phase 8, D3): preferred over newest-wins.
    // A configured default that became unusable fails the signup loudly —
    // silently falling back to newest-wins is exactly the F1 bug.
    const flagged = await this.prisma.planVersion.findFirst({
      where: { isDefault: true },
      include,
    });
    if (flagged) {
      const usable =
        !flagged.archivedAt &&
        flagged.plan.isActive &&
        flagged.effectiveFrom <= new Date();
      if (!usable) {
        throw new Error(
          'The default plan version is not usable (archived, inactive, or not yet effective). Set a new signup default.',
        );
      }
      return flagged;
    }

    this.logger.warn(
      'No signup-default plan version is set; provisioning falls back to the newest active version. Set an explicit default in the console.',
    );
    const latest = await this.prisma.planVersion.findFirst({
      where: {
        archivedAt: null,
        effectiveFrom: { lte: new Date() },
        plan: { isActive: true },
      },
      orderBy: { effectiveFrom: 'desc' },
      include,
    });
    if (!latest) {
      throw new Error(
        'No plan version is available for provisioning. Create a plan or set DEFAULT_PLAN_VERSION_ID.',
      );
    }
    return latest;
  }
}
