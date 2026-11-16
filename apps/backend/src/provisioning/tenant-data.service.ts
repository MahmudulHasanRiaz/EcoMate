import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_MAX_ROWS_PER_TABLE = 250_000;

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function maxRows(): number {
  const raw = Number(process.env.TENANT_EXPORT_MAX_ROWS);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_MAX_ROWS_PER_TABLE;
}

/**
 * Full-tenant export and purge.
 *
 * The tenant database is shared by every tenant, so this discovers the
 * tenant-scoped tables from the catalog (every table with a `tenant_id`),
 * orders them parent-first via their foreign keys, and exports/removes only
 * rows belonging to the requested tenant. Reference tables without tenant_id
 * are intentionally left untouched.
 */
@Injectable()
export class TenantDataService {
  private readonly logger = new Logger(TenantDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportTenant(tenantId: string) {
    const tableOrder = await this.tenantTableOrder();
    const tables: Record<string, unknown[]> = {};
    const limit = maxRows();

    for (const table of tableOrder) {
      const rows = await this.prisma.$queryRawUnsafe<{ row: unknown }[]>(
        `SELECT row_to_json(t) AS row FROM ${quoteIdentifier(table)} t ` +
          `WHERE tenant_id = $1::uuid LIMIT ${limit + 1}`,
        tenantId,
      );
      if (rows.length > limit) {
        throw new ConflictException(
          `Export aborted: ${table} exceeds ${limit} rows for this tenant`,
        );
      }
      tables[table] = rows.map((entry) => entry.row);
    }

    return {
      version: 1,
      tenantId,
      exportedAt: new Date().toISOString(),
      tableOrder,
      tables,
    };
  }

  async purgeTenant(tenantId: string) {
    const tableOrder = await this.tenantTableOrder();
    const deleted: Record<string, number> = {};
    let total = 0;

    // Children before parents. FK cascades may remove already-empty child
    // rows; $executeRaw reports the affected count either way.
    for (const table of [...tableOrder].reverse()) {
      const count = await this.prisma.$executeRawUnsafe(
        `DELETE FROM ${quoteIdentifier(table)} WHERE tenant_id = $1::uuid`,
        tenantId,
      );
      deleted[table] = count;
      total += count;
    }

    this.logger.log(
      `Purged tenant ${tenantId}: ${total} row(s) across ${tableOrder.length} tables`,
    );
    return { tenantId, deletedRows: total, tables: deleted };
  }

  /**
   * Parent-first list of every public table with a tenant_id column, ordered
   * by FK dependencies. Cyclic edges are broken deterministically by name so
   * export/purge can never hang on a schema cycle.
   */
  private async tenantTableOrder(): Promise<string[]> {
    const tables = await this.prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname <> '_prisma_migrations'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema = 'public'
               AND col.table_name = c.relname
               AND col.column_name = 'tenant_id'
          )`,
    );
    const names = tables.map((table) => table.table_name);
    if (names.length === 0) return [];

    const edges = await this.prisma.$queryRawUnsafe<
      { child: string; parent: string }[]
    >(
      `SELECT child.relname AS child, parent.relname AS parent
         FROM pg_constraint con
         JOIN pg_class child ON child.oid = con.conrelid
         JOIN pg_class parent ON parent.oid = con.confrelid
         JOIN pg_namespace n ON n.oid = child.relnamespace
        WHERE con.contype = 'f'
          AND n.nspname = 'public'
          AND child.relname = ANY($1::text[])
          AND parent.relname = ANY($1::text[])
          AND child.relname <> parent.relname`,
      names,
    );

    const children = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    for (const name of names) {
      children.set(name, new Set());
      indegree.set(name, 0);
    }
    for (const { child, parent } of edges) {
      if (!children.has(parent) || !children.has(child)) continue;
      const set = children.get(parent)!;
      if (set.has(child)) continue;
      set.add(child);
      indegree.set(child, (indegree.get(child) ?? 0) + 1);
    }

    const queue = names
      .filter((name) => (indegree.get(name) ?? 0) === 0)
      .sort();
    const ordered: string[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      ordered.push(name);
      for (const child of [...(children.get(name) ?? [])].sort()) {
        const next = (indegree.get(child) ?? 1) - 1;
        indegree.set(child, next);
        if (next === 0) queue.push(child);
      }
      queue.sort();
    }

    if (ordered.length < names.length) {
      const remaining = names.filter((name) => !ordered.includes(name)).sort();
      ordered.push(...remaining);
    }
    return ordered;
  }
}
