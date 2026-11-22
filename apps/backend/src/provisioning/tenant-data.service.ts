import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ExternalStoreResolver } from '../external-stores/external-store-resolver.service';

const DEFAULT_MAX_ROWS_PER_TABLE = 250_000;
/** Default rows per export chunk; the caller may ask for fewer, never more. */
const DEFAULT_CHUNK_SIZE = 1_000;
const MAX_CHUNK_SIZE = 5_000;
/** Safety bound for queue scans during purge (100 pages × 1000 jobs). */
const MAX_QUEUE_PAGES = 100;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    // Required (not @Optional()): without DiscoveryModule imported in
    // ProvisioningModule the backend must fail to boot loudly instead of
    // silently skipping queue cleanup on every purge. Found live
    // 2026-11-17: the optional injection resolved to undefined and
    // removeQueuedJobs no-op'd while delayed jobs survived the purge.
    private readonly discovery: DiscoveryService,
    // Phase 9 §3.4: purge invalidates the resolver cache for the tenant's
    // stores (best-effort; @Optional so unit specs constructing this
    // service manually keep working). The binding ROWS are deleted
    // platform-side (tenant-lifecycle.service.ts purge) — the internal
    // release endpoint is PENDING-only, so the backend must not call it
    // for ACTIVE bindings; the cache invalidation is the backend's half.
    @Optional() private readonly storeResolver?: ExternalStoreResolver,
  ) {}

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

  /**
   * Chunked export (Phase 8 item 26): the manifest + per-table chunks let
   * the platform stream an export of any size instead of loading every row
   * into memory behind a 30s timeout and a 250k-row/table cap. Chunking is
   * keyed on `ctid` (a physical row id every table has), so no table needs
   * a sortable primary key and paging is O(n) instead of O(n²) offsets.
   * The tenant is soft-deleted while this runs, so no concurrent writes
   * can move a row between pages.
   */
  async exportManifest(tenantId: string): Promise<{
    tableOrder: string[];
    counts: Record<string, number>;
    totalRows: number;
  }> {
    const tableOrder = await this.tenantTableOrder();
    const counts: Record<string, number> = {};
    let totalRows = 0;
    for (const table of tableOrder) {
      const rows = await this.prisma.$queryRawUnsafe<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} ` +
          `WHERE tenant_id = $1::uuid`,
        tenantId,
      );
      const count = Number(rows[0]?.count ?? 0);
      counts[table] = count;
      totalRows += count;
    }
    return { tableOrder, counts, totalRows };
  }

  async exportTableChunk(
    tenantId: string,
    table: string,
    cursor?: string | null,
    limit?: number,
  ): Promise<{
    table: string;
    rows: unknown[];
    nextCursor: string | null;
    done: boolean;
  }> {
    const tableOrder = await this.tenantTableOrder();
    if (!tableOrder.includes(table)) {
      throw new BadRequestException(`Table is not tenant-scoped: ${table}`);
    }
    const size =
      Number.isFinite(limit) && (limit as number) > 0
        ? Math.min(Math.floor(limit as number), MAX_CHUNK_SIZE)
        : DEFAULT_CHUNK_SIZE;
    const after = cursor ?? '(0,0)';
    const rows = await this.prisma.$queryRawUnsafe<{
      row: unknown;
      ctid: string;
    }[]>(
      `SELECT row_to_json(t) AS row, t.ctid::text AS ctid ` +
        `FROM ${quoteIdentifier(table)} t ` +
        `WHERE tenant_id = $1::uuid AND t.ctid > $2::tid ` +
        `ORDER BY t.ctid LIMIT $3`,
      tenantId,
      after,
      size,
    );
    const done = rows.length < size;
    return {
      table,
      rows: rows.map((entry) => entry.row),
      nextCursor: done ? null : (rows[rows.length - 1]?.ctid ?? null),
      done,
    };
  }

  async purgeTenant(tenantId: string) {
    // Media FIRST: the enumeration reads the tenant's Media rows, which
    // the row purge below deletes. A total media-purge failure aborts the
    // purge (it retries on the next sweep); per-file failures are recorded
    // in the result instead of blocking.
    const media = await this.storage.deleteTenantMedia(tenantId);
    // Queued jobs next: anything still waiting/delayed for this tenant is
    // removed so it can never run against a half-purged tenant. In-flight
    // jobs are stopped by the TenantWorkerHost registry check instead.
    const jobsRemoved = await this.removeQueuedJobs(tenantId);
    // Phase 9: list the tenant's external stores BEFORE the row purge
    // deletes them — their resolver cache entries are invalidated after
    // the purge (below). Raw SQL like the rest of this method: the purge
    // runs without tenant context, so the Prisma proxy cannot scope it.
    let storeRows: { id: string; kind: string; domainNormalised: string | null }[] = [];
    try {
      storeRows = await this.prisma.$queryRawUnsafe(
        `SELECT id, kind, "domainNormalised" FROM "Store" WHERE tenant_id = $1::uuid`,
        tenantId,
      );
    } catch (err) {
      // A missing Store table (pre-Phase-9 DB) must not abort the purge.
      this.logger.warn(
        `Store listing failed during purge of ${tenantId} (continuing): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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

    // Phase 9: invalidate the resolver cache for the purged tenant's
    // stores so a stale extstore: entry can never resolve a webhook for
    // a dead tenant (the intake re-checks the Store row and would 401
    // anyway — this is hygiene, not a security boundary). Best-effort:
    // a cache failure must never fail the purge. The platform binding
    // rows are deleted platform-side (tenant-lifecycle purge).
    let cacheInvalidated = 0;
    if (this.storeResolver) {
      for (const store of storeRows) {
        try {
          // Only real providers have a domain cache key; NATIVE stores
          // never do (domainNormalised is null for them).
          const provider =
            store.kind === 'WOOCOMMERCE' ||
            store.kind === 'SHOPIFY' ||
            store.kind === 'CUSTOM'
              ? store.kind
              : undefined;
          await this.storeResolver.invalidate(store.id, {
            provider,
            domain: store.domainNormalised ?? undefined,
          });
          cacheInvalidated += 1;
        } catch (err) {
          this.logger.warn(
            `Resolver cache invalidation failed for store ${store.id} during purge of ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    this.logger.log(
      `Purged tenant ${tenantId}: ${total} row(s) across ${tableOrder.length} tables, ` +
        `${media.deletedFiles} media file(s), ${jobsRemoved} queued job(s) removed` +
        (cacheInvalidated > 0 ? `, ${cacheInvalidated} store resolver cache entr(ies) invalidated` : ''),
    );
    return {
      tenantId,
      deletedRows: total,
      tables: deleted,
      mediaDeletedFiles: media.deletedFiles,
      mediaFailedFiles: media.failedFiles,
      jobsRemoved,
      storeCacheInvalidated: cacheInvalidated,
    };
  }

  /**
   * Removes waiting/delayed/paused jobs for one tenant from every BullMQ
   * queue in the app. Best-effort per queue: a failure is logged, not
   * thrown — the TenantWorkerHost registry check is the net for any job
   * this misses. Active jobs are left alone (they are already running);
   * completed/failed jobs are history, not work.
   */
  private async removeQueuedJobs(tenantId: string): Promise<number> {
    let queues: Queue[];
    try {
      queues = this.discovery
        .getProviders()
        .map((provider) => provider.instance)
        .filter((instance): instance is Queue => instance instanceof Queue);
    } catch (err) {
      this.logger.warn(
        `Queue discovery failed during purge of ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
    return this.removeTenantJobs(tenantId, queues);
  }

  /**
   * The testable core of removeQueuedJobs: scans the given queues page by
   * page (offset only advances past pages with no tenant jobs, since
   * removing jobs shifts the indices) and removes the tenant's jobs.
   */
  async removeTenantJobs(
    tenantId: string,
    queues: Pick<Queue, 'name' | 'getJobs'>[],
  ): Promise<number> {
    const types = ['waiting', 'delayed', 'paused', 'waiting-children'] as const;
    let removed = 0;
    for (const queue of queues) {
      try {
        let start = 0;
        for (let page = 0; page < MAX_QUEUE_PAGES; page++) {
          const jobs = await queue.getJobs(types as any, start, start + 999, true);
          if (jobs.length === 0) break;
          let removedInPage = 0;
          for (const job of jobs) {
            if ((job.data as any)?.tenantId === tenantId) {
              await job.remove();
              removed += 1;
              removedInPage += 1;
            }
          }
          if (removedInPage === 0) start += jobs.length;
          if (jobs.length < 1000) break;
        }
      } catch (err) {
        this.logger.warn(
          `Queue cleanup failed for ${queue.name} during purge of ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return removed;
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
