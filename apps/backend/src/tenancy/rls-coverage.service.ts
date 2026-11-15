import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TenantPrismaManager } from './tenant-prisma.manager';

interface CoverageRow {
  table_name: string;
  tenant_scoped: boolean;
  rls_enabled: boolean;
  rls_forced: boolean;
  has_policy: boolean;
  has_trigger: boolean;
}

const FALLBACK_TENANT_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Boot-time fail-closed gate for the tenant isolation boundary.
 *
 * The `rls_coverage` view is created by migration 0002. A tenant-scoped table
 * without FORCE RLS, the tenant_isolation policy, or the tenant_id_guard
 * trigger means a query could cross tenants — refuse to start.
 */
@Injectable()
export class RlsCoverageService implements OnModuleInit {
  private readonly logger = new Logger(RlsCoverageService.name);

  constructor(private readonly manager: TenantPrismaManager) {}

  async onModuleInit(): Promise<void> {
    const client = this.manager.getClient(
      process.env.DEFAULT_TENANT_ID || FALLBACK_TENANT_ID,
    );
    const rows = await client.$queryRawUnsafe<CoverageRow[]>(
      `SELECT table_name, tenant_scoped, rls_enabled, rls_forced,
              has_policy, has_trigger
         FROM rls_coverage
        ORDER BY table_name`,
    );

    if (rows.length === 0) {
      throw new Error(
        'RLS coverage check failed: rls_coverage is empty (is migration 0002 applied?)',
      );
    }

    const tenantTables = rows.filter((row) => row.tenant_scoped);
    const gaps = tenantTables.filter(
      (row) =>
        !row.rls_enabled ||
        !row.rls_forced ||
        !row.has_policy ||
        !row.has_trigger,
    );

    if (gaps.length > 0) {
      const details = gaps
        .map(
          (row) =>
            `${row.table_name} (rls=${row.rls_enabled}, forced=${row.rls_forced}, ` +
            `policy=${row.has_policy}, trigger=${row.has_trigger})`,
        )
        .join(', ');
      throw new Error(
        `RLS coverage check failed for ${gaps.length}/${tenantTables.length} tenant table(s): ${details}`,
      );
    }

    this.logger.log(
      `RLS coverage verified: ${tenantTables.length} tenant table(s), ` +
        `${rows.length - tenantTables.length} global table(s)`,
    );
  }
}
