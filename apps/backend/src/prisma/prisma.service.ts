import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

/**
 * Transitional tenant-database client.
 *
 * The SaaS target uses TenantPrismaManager + the request-scoped proxy. This
 * class keeps the current app bootable during the schema/runtime migration:
 * every connection carries a default tenant GUC so RLS is already active.
 * Once the TenantMiddleware is applied, the proxy replaces this client.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString =
      process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'TENANT_DATABASE_URL (or DATABASE_URL) environment variable is not set',
      );
    }

    const tenantId =
      process.env.DEFAULT_TENANT_ID ||
      '00000000-0000-4000-8000-000000000000';

    const pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      options: `-c app.tenant_id=${tenantId}`,
    });

    super({ adapter: new PrismaPg(pool) });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Tenant database connected (transitional default tenant)');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Raw SQL escape hatch used by maintenance/health checks. */
  async rawQuery<T = any>(sql: string): Promise<T> {
    return this.$queryRawUnsafe<T>(sql);
  }

  /** Restore is a platform-level operation; the tenant runtime never blocks on it. */
  async isRestoreWriteBlocked(): Promise<boolean> {
    return false;
  }
}
