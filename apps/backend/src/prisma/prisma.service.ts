import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getTenantContext } from '../tenancy/tenant-context';
import { TenantPrismaManager } from '../tenancy/tenant-prisma.manager';
import { createTenantPrismaProxy } from '../tenancy/tenant-prisma.proxy';

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Request-scoped tenant database facade.
 *
 * The object returned from the constructor is a Proxy over this instance:
 * model delegates and $transaction are resolved from TenantPrismaManager for
 * the current request's tenant. Every pooled connection carries
 * `app.tenant_id`, so PostgreSQL RLS is the final isolation boundary.
 *
 * DEFAULT_TENANT_ID is a development/maintenance bridge for requests that
 * intentionally have no tenant context (health, backup control, queued jobs
 * until the tenant fan-out lands). Production request paths must resolve a
 * tenant in TenantMiddleware. The hardcoded fallback tenant below is
 * TEST-ONLY: outside test env, a missing tenant context with no
 * DEFAULT_TENANT_ID fails closed instead of silently reading/writing the
 * fallback tenant's rows (same gating as tenant-job.ts).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly manager: TenantPrismaManager;

  constructor(@Optional() manager?: TenantPrismaManager) {
    this.manager = manager ?? new TenantPrismaManager();
    return createTenantPrismaProxy(this, this.manager, () =>
      this.effectiveTenantId(),
    ) as unknown as PrismaService;
  }

  private effectiveTenantId(): string {
    const tenantId =
      getTenantContext()?.tenantId ||
      process.env.DEFAULT_TENANT_ID ||
      (process.env.NODE_ENV === 'test' ? FALLBACK_TENANT_ID : undefined);
    if (!tenantId) {
      throw new Error(
        'Tenant context is required (no tenant in context and no DEFAULT_TENANT_ID configured)',
      );
    }
    return tenantId;
  }

  onModuleInit(): void {
    // Tenant clients are created lazily; the manager owns their lifecycle.
  }

  onModuleDestroy(): void {
    // The manager (when Nest-injected) disconnects its clients.
  }

  /** Raw SQL escape hatch used by maintenance/health checks. */
  async rawQuery<T = any>(sql: string): Promise<T> {
    return this.manager
      .getClient(this.effectiveTenantId())
      .$queryRawUnsafe<T>(sql);
  }

  /** Restore is a platform-level operation; the tenant runtime never blocks on it. */
  async isRestoreWriteBlocked(): Promise<boolean> {
    return false;
  }
}

// Declaration merge: services keep using PrismaClient's delegate types.
export interface PrismaService extends PrismaClient {}
