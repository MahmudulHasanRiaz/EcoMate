import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { getTenantContext, runWithTenant } from './tenant-context';
import { TenantRegistryService } from './tenant-registry.service';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

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
 */
export abstract class TenantWorkerHost<
  Data extends TenantJobData = TenantJobData,
> extends WorkerHost {
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

    return runWithTenant(
      {
        tenantId,
        slug: job.data?.tenantSlug || 'queue',
        status: 'active',
      },
      () => this.handle(job),
    );
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

    .filter((tenant) => tenant.status === 'active')
    .map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      status: tenant.status,
    }));

  if (tenants.length === 0 && process.env.NODE_ENV !== 'production') {
    const defaultId =
      process.env.DEFAULT_TENANT_ID ||
      (process.env.NODE_ENV === 'test' ? FALLBACK_TENANT_ID : undefined);
    if (defaultId) {
      tenants.push({
        id: defaultId,
        slug: process.env.DEFAULT_TENANT_SLUG || 'default',
        status: 'active',
      });
    }
  }

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
  return { succeeded, failed };
}
