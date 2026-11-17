import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { getTenantContext, runWithTenant } from './tenant-context';
import { TenantRegistryService } from './tenant-registry.service';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Grace period for the registry check below. The registry refreshes from
 * the platform API every 60s, so a tenant provisioned moments ago may not
 * be listed yet — a job enqueued for it must still run. Jobs older than
 * this whose tenant is still unknown are for tenants that were deleted
 * (the platform registry excludes DELETED tenants) or never existed.
 */
const TENANT_REGISTRY_GRACE_MS = 5 * 60_000;

// Module-level logger: runPerTenant is a free function, not an injectable.
const logger = new Logger('runPerTenant');
const workerLogger = new Logger('TenantWorkerHost');

export interface TenantJobData {
  tenantId: string;
  tenantSlug?: string;
}

/**
 * Stamps the current request tenant onto a queue payload. Production callers
 * without a tenant fail closed; dev/test keep the single-tenant bridge.
 */
export function tenantJobPayload<T extends object>(
  data: T,
): T & TenantJobData {
  const context = getTenantContext();
  const tenantId =
    context?.tenantId ??
    (process.env.NODE_ENV === 'production'
      ? undefined
      : process.env.DEFAULT_TENANT_ID ||
        (process.env.NODE_ENV === 'test' ? FALLBACK_TENANT_ID : undefined));

  if (!tenantId) {
    throw new Error(
      'Tenant context is required to enqueue a tenant queue job',
    );
  }

  return {
    ...data,
    tenantId,
    ...(context?.slug ? { tenantSlug: context.slug } : {}),
  };
}

/**
 * Base worker: every job carries tenantId, and handle() runs inside the same
 * ALS context as an HTTP request so PrismaService resolves the tenant pool.
 *
 * Jobs for tenants that no longer exist are skipped, not run: the purge
 * removes queued jobs, but a delayed/retried job can slip through (enqueued
 * before the purge, processed after). The check fails OPEN — no registry,
 * an empty registry (cold start / sync disabled), and young jobs all run —
 * because dropping a legitimate job is worse than running a stale one.
 */
export abstract class TenantWorkerHost<
  Data extends TenantJobData = TenantJobData,
> extends WorkerHost {
  constructor(
    protected readonly tenantRegistry?: TenantRegistryService,
  ) {
    super();
  }

  async process(job: Job<Data>): Promise<unknown> {
    const tenantId =
      job.data?.tenantId ||
      (process.env.NODE_ENV === 'production'
        ? undefined
        : process.env.DEFAULT_TENANT_ID ||
          (process.env.NODE_ENV === 'test' ? FALLBACK_TENANT_ID : undefined));

    if (!tenantId) {
      throw new Error(
        `Queue job ${job.name} (${job.id ?? 'n/a'}) is missing tenantId`,
      );
    }

    if (this.shouldSkipForMissingTenant(job, tenantId)) {
      workerLogger.warn(
        `Skipping queue job ${job.name} (${job.id ?? 'n/a'}): tenant ${tenantId} is unknown or deleted`,
      );
      return { skipped: 'tenant-unknown-or-deleted', tenantId };
    }

    return runWithTenant(
      {
        tenantId,
        slug: job.data?.tenantSlug || 'queue',
        // Tenant status is UPPERCASE everywhere (platform TenantStatus enum).
        status: 'ACTIVE',
      },
      () => this.handle(job),
    );
  }

  /**
   * True when the tenant is provably gone: the registry is populated (at
   * least one successful sync) and the tenant is absent from it, or listed
   * as DELETED — and the job is old enough that the registry should know
   * about a live tenant by now.
   */
  private shouldSkipForMissingTenant(job: Job<Data>, tenantId: string): boolean {
    const registry = this.tenantRegistry;
    if (!registry) return false;
    if (registry.size() === 0) return false;
    const record = registry.resolveById(tenantId);
    if (record) return record.status === 'DELETED';
    const ageMs = Date.now() - (job.timestamp ?? Date.now());
    return ageMs > TENANT_REGISTRY_GRACE_MS;
  }

  protected abstract handle(job: Job<Data>): Promise<unknown>;
}

/**
 * Runs a sweep once per active tenant. Failures are isolated per tenant.
 * Dev fallback keeps local single-tenant intervals useful.
 */
export async function runPerTenant(
  registry: TenantRegistryService | null | undefined,
  fn: (tenant: { id: string; slug: string; status: string }) => Promise<void>,
  onError?: (tenantId: string, error: unknown) => void,
): Promise<{ succeeded: number; failed: number }> {
  const tenants = (registry?.list() ?? [])
    // Registry statuses come verbatim from the platform TenantStatus enum,
    // which is UPPERCASE (ACTIVE, SUSPENDED, ...). Compare
    // case-insensitively: a lowercase 'active' comparison silently matched
    // zero tenants in production, so every per-tenant sweep no-op'd.
    .filter((tenant) => tenant.status?.toUpperCase() === 'ACTIVE')
    .map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
    }));

  if (tenants.length === 0) {
    // A zero-tenant sweep must be visible, not silent: every per-tenant
    // background job (token cleanup, retention, outbox relay, ...) no-ops
    // when the registry holds no ACTIVE tenant. In production there is no
    // fallback below, so this warning is the only signal the sweep is dead.
    logger.warn(
      'runPerTenant: registry holds 0 ACTIVE tenants — this sweep will process no tenants',
    );
  }

  if (tenants.length === 0 && process.env.NODE_ENV !== 'production') {
    const defaultId =
      process.env.DEFAULT_TENANT_ID ||
      (process.env.NODE_ENV === 'test' ? FALLBACK_TENANT_ID : undefined);
    if (defaultId) {
      tenants.push({
        id: defaultId,
        slug: process.env.DEFAULT_TENANT_SLUG || 'default',
        status: 'ACTIVE',
      });
    }
  }

  logger.debug(`runPerTenant: sweeping ${tenants.length} tenant(s)`);

  let succeeded = 0;
  let failed = 0;
  for (const tenant of tenants) {
    try {
      await runWithTenant(
        { tenantId: tenant.id, slug: tenant.slug, status: tenant.status },
        () => fn(tenant),
      );
      succeeded += 1;
    } catch (error) {
      failed += 1;
      onError?.(tenant.id, error);
    }
  }
  logger.debug(
    `runPerTenant: sweep complete — ${succeeded} succeeded, ${failed} failed`,
  );
  return { succeeded, failed };
}
