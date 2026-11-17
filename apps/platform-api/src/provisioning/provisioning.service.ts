import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DomainConfigService } from '../config/domain-config.service';
import { PlatformMailService } from '../common/platform-mail.service';
import { PlatformPrismaService } from '../prisma/prisma.service';

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
      return existing;
    }

    const primaryDomain = this.domainConfig.getConfig().primaryDomain;
    const now = new Date();
    const trialDays = planVersion.trialDays || TRIAL_DAYS_FALLBACK;
    const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);
    const host = `${signup.slug}.${primaryDomain}`;

    try {
      return await this.prisma.tenant.create({
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
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const raced = await this.prisma.tenant.findUnique({
          where: { slug: signup.slug },
        });
        if (raced) return raced;
      }
      throw err;
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
