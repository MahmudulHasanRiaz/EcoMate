import {
  BadGatewayException,
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { AuditService } from '../common/audit.service';
import { EncryptionService } from '../common/encryption.service';
import { AlertsService } from '../observability/alerts.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  ExportProgress,
  ExportProgressRegistry,
  ExportResult,
} from './export-progress.registry';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PURGE_INTERVAL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
/** Export files older than this are deleted by the retention sweep. */
const DEFAULT_EXPORT_RETENTION_DAYS = 90;
/** Rows fetched per chunk from the backend (matches its 5000 cap). */
const EXPORT_CHUNK_SIZE = 1000;

function exportRetentionDays(): number {
  const raw = Number(process.env.TENANT_EXPORT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : DEFAULT_EXPORT_RETENTION_DAYS;
}

function retentionDays(): number {
  const raw = Number(process.env.TENANT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_RETENTION_DAYS;
}

function purgeIntervalMs(): number {
  const raw = Number(process.env.TENANT_PURGE_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_PURGE_INTERVAL_MS;
}

function exportDir(): string {
  return (
    process.env.TENANT_EXPORT_DIR ||
    join(process.env.APP_DATA_DIR || process.cwd(), 'tenant-exports')
  );
}

function apiBase(): string {
  const configured = (
    process.env.TENANT_BACKEND_URL || 'http://backend:4000/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function purgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + retentionDays() * 86_400_000);
}

@Injectable()
export class TenantLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantLifecycleService.name);
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    // @Optional: older specs construct this service without alerts; the
    // sweep still logs failures, it just cannot email about them.
    @Optional() private readonly alerts?: AlertsService,
    // @Optional: older specs construct this service without the registry
    // or encryption; export still works, it just has no progress tracking
    // and writes plaintext.
    @Optional() private readonly exports?: ExportProgressRegistry,
    @Optional() private readonly encryption?: EncryptionService,
  ) {}

  onModuleInit() {
    if (process.env.TENANT_PURGE_ENABLED === 'false') return;
    void this.runPurgeSweep().catch(() => undefined);
    this.purgeTimer = setInterval(() => {
      void this.runPurgeSweep().catch(() => undefined);
    }, purgeIntervalMs());
    this.purgeTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  async softDelete(id: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    if (tenant.status === 'DELETED' && tenant.deletedAt) {
      return this.deleteSummary(tenant.id, tenant.slug, tenant.deletedAt);
    }

    const deletedAt = new Date();
    await this.prisma.tenant.update({
      where: { id },
      data: { status: 'DELETED', deletedAt, suspendedAt: null },
    });
    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.soft_delete',
      entity: 'Tenant',
      entityId: id,
      before: { status: tenant.status },
      after: { status: 'DELETED', deletedAt: deletedAt.toISOString() },
    });
    return this.deleteSummary(tenant.id, tenant.slug, deletedAt);
  }

  async restore(id: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'DELETED' || !tenant.deletedAt) {
      throw new BadRequestException('Tenant is not deleted');
    }
    if (Date.now() > purgeAfter(tenant.deletedAt).getTime()) {
      throw new GoneException('The restore window for this tenant has passed');
    }

    const now = new Date();
    const status =
      tenant.trialEndsAt && tenant.trialEndsAt > now ? 'TRIAL' : 'ACTIVE';
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { status, deletedAt: null, suspendedAt: null },
    });
    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.restore',
      entity: 'Tenant',
      entityId: id,
      before: { status: 'DELETED', deletedAt: tenant.deletedAt.toISOString() },
      after: { status },
    });
    return updated;
  }

  /**
   * Triggers the tenant's existing OTP reset for the owner. The platform never
   * sets or receives a password.
   */
  async resetOwnerPassword(id: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new BadGatewayException(
        'INTERNAL_SERVICE_SECRET is not configured; owner reset is unavailable',
      );
    }

    try {
      const response = await fetch(
        `${apiBase()}/internal/provisioning/owner-password-reset`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-platform-service-token': secret,
          },
          body: JSON.stringify({
            tenantId: tenant.id,
            slug: tenant.slug,
            email: tenant.ownerEmail,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        throw new Error(`tenant owner reset HTTP ${response.status}`);
      }
    } catch (err) {
      throw new BadGatewayException(
        `Owner password reset failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.audit.record({
      actorId,
      tenantId: id,
      action: 'tenant.owner_password_reset',
      entity: 'Tenant',
      entityId: id,
      after: { email: tenant.ownerEmail },
    });
    return { sent: true, email: tenant.ownerEmail };
  }

  /**
   * Writes a complete JSON export: platform billing/registry rows plus the
   * tenant database's dependency-ordered tables. Export always runs before a
   * purge; a failed export aborts destruction.
   *
   * Streaming (Phase 8 item 26): the tenant tables arrive in 1000-row
   * chunks from the backend and are appended to the file as they arrive,
   * so a large tenant no longer needs the whole export in memory, behind
   * one 30s timeout, under a 250k-row/table cap. Progress is tracked in
   * the export registry; if an export is already running for this tenant
   * the call joins it and awaits its completion instead of starting a
   * second one (this is how a purge awaits an in-flight export).
   *
   * Encryption: when APP_ENCRYPTION_KEY is configured the finished file is
   * encrypted with the platform EncryptionService (`enc:v1:` format,
   * `.json.enc` suffix). Without a key the file is plaintext and a warning
   * is logged — exports contain customer PII. Encryption reads the whole
   * finished file into memory once; the streaming win is in the fetch, not
   * the encrypt step.
   */
  async exportToFile(tenantId: string, actorId?: string): Promise<ExportResult> {
    const running = this.exports?.runningFor(tenantId);
    if (running) {
      const result = await this.exports!.waitFor(running.jobId);
      if (!result) {
        throw new BadGatewayException('In-flight export disappeared');
      }
      return result;
    }
    const { jobId } = this.exports?.start(tenantId) ?? { jobId: null };
    try {
      const result = await this.runExport(jobId, tenantId, actorId);
      if (jobId) this.exports!.complete(jobId, result);
      return result;
    } catch (err) {
      if (jobId) {
        this.exports!.fail(
          jobId,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      throw err;
    }
  }

  /**
   * Starts an export in the background and returns its job id immediately;
   * poll getExportProgress(jobId) for progress. If an export is already
   * running for the tenant, returns its job id instead of starting over.
   */
  startExport(tenantId: string, actorId?: string): { jobId: string } {
    const running = this.exports?.runningFor(tenantId);
    if (running) return { jobId: running.jobId };
    const { jobId } = this.exports?.start(tenantId) ?? { jobId: null };
    if (!jobId) {
      throw new BadGatewayException('Export progress registry unavailable');
    }
    void this.runExport(jobId, tenantId, actorId)
      .then((result) => this.exports!.complete(jobId, result))
      .catch((err: unknown) =>
        this.exports!.fail(
          jobId,
          err instanceof Error ? err : new Error(String(err)),
        ),
      );
    return { jobId };
  }

  getExportProgress(tenantId: string, jobId: string): ExportProgress {
    const progress = this.exports?.get(jobId);
    // 404 on tenant mismatch too: a job id must not leak another tenant's
    // export existence, let alone its file.
    if (!progress || progress.tenantId !== tenantId) {
      throw new NotFoundException('Export job not found');
    }
    return progress;
  }

  /** Server-side path of a finished export, for the download endpoint. */
  getExportPath(
    tenantId: string,
    jobId: string,
  ): { path: string; filename: string } {
    const progress = this.getExportProgress(tenantId, jobId);
    if (progress.status !== 'done') {
      throw new BadRequestException(
        `Export is ${progress.status}; download is available when it is done`,
      );
    }
    const path = this.exports!.pathFor(jobId);
    if (!path || !progress.filename) {
      throw new NotFoundException('Export file is no longer available');
    }
    return { path, filename: progress.filename };
  }

  private async runExport(
    jobId: string | null,
    tenantId: string,
    actorId?: string,
  ): Promise<ExportResult> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        domains: true,
        planVersion: true,
        subscription: { include: { planVersion: true, addOns: true } },
        invoices: {
          include: {
            lines: true,
            proofs: true,
            payments: true,
            creditNotes: true,
            couponRedemptions: true,
          },
        },
        paymentProofs: true,
        payments: true,
        creditNotes: true,
        couponRedemptions: true,
        usage: true,
        impersonations: true,
        provisioningJobs: true,
        auditLogs: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new BadGatewayException(
        'INTERNAL_SERVICE_SECRET is not configured; tenant export is unavailable',
      );
    }
    const headers = {
      'content-type': 'application/json',
      'x-platform-service-token': secret,
    };
    const body = { tenantId: tenant.id, slug: tenant.slug };

    const manifest = await this.fetchJson<{
      tableOrder: string[];
      counts: Record<string, number>;
      totalRows: number;
    }>(`${apiBase()}/internal/provisioning/export/manifest`, headers, body);
    if (jobId) {
      this.exports!.update(jobId, {
        tablesTotal: manifest.tableOrder.length,
        totalRows: manifest.totalRows,
      });
    }

    const exportedAt = new Date();
    const dir = exportDir();
    await mkdir(dir, { recursive: true });
    const filename = `${tenant.slug}-${exportedAt
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    const tmpPath = join(dir, `.${filename}.tmp-${jobId ?? 'sync'}`);
    const finalPath = join(dir, filename);

    // Stream the JSON document: header + one array per table, rows appended
    // chunk by chunk. appendFile reopens the file per call; chunks are
    // 1000 rows, so even a million-row tenant is ~1000 appends.
    try {
      await writeFile(
        tmpPath,
        `{"version":1,"exportedAt":${JSON.stringify(exportedAt.toISOString())},"platform":${JSON.stringify(tenant)},"tenant":{"version":1,"tenantId":${JSON.stringify(tenant.id)},"tableOrder":${JSON.stringify(manifest.tableOrder)},"tables":{`,
        'utf8',
      );
      let rowsWritten = 0;
      for (const [index, table] of manifest.tableOrder.entries()) {
        if (jobId) {
          this.exports!.update(jobId, {
            currentTable: table,
            tablesDone: index,
            rowsWritten,
          });
        }
        await appendFile(
          tmpPath,
          `${index === 0 ? '' : ','}${JSON.stringify(table)}:[`,
          'utf8',
        );
        let cursor: string | null = null;
        let firstRow = true;
        for (;;) {
          const chunk = await this.fetchJson<{
            table: string;
            rows: unknown[];
            nextCursor: string | null;
            done: boolean;
          }>(
            `${apiBase()}/internal/provisioning/export/chunk`,
            headers,
            { ...body, table, cursor, limit: EXPORT_CHUNK_SIZE },
          );
          for (const row of chunk.rows) {
            await appendFile(
              tmpPath,
              `${firstRow ? '' : ','}${JSON.stringify(row)}`,
              'utf8',
            );
            firstRow = false;
            rowsWritten += 1;
          }
          if (chunk.done) break;
          cursor = chunk.nextCursor;
        }
        await appendFile(tmpPath, ']', 'utf8');
        if (jobId) {
          this.exports!.update(jobId, {
            tablesDone: index + 1,
            rowsWritten,
          });
        }
      }
      await appendFile(tmpPath, '}}}', 'utf8');
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err instanceof BadGatewayException
        ? err
        : new BadGatewayException(
            `Tenant data export failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
    }

    // Encrypt at rest when a key is configured; otherwise plaintext + a
    // warning. The encrypt step loads the finished file once — see the
    // exportToFile doc comment.
    let path = finalPath;
    let outFilename = filename;
    let encrypted = false;
    if (this.encryption?.isConfigured()) {
      const plaintext = await readFile(tmpPath, 'utf8');
      const ciphertext = this.encryption.encrypt(plaintext);
      outFilename = `${filename}.enc`;
      path = join(dir, outFilename);
      await writeFile(path, ciphertext, 'utf8');
      await unlink(tmpPath);
      encrypted = true;
    } else {
      this.logger.warn(
        `Tenant export for ${tenant.slug} is stored UNENCRYPTED (APP_ENCRYPTION_KEY not configured); exports contain customer PII`,
      );
      await rename(tmpPath, finalPath);
    }

    const sizeBytes = (await stat(path)).size;
    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.export',
      entity: 'Tenant',
      entityId: tenantId,
      after: { filename: outFilename, sizeBytes, encrypted },
    });

    return {
      path,
      filename: outFilename,
      sizeBytes,
      exportedAt,
      encrypted,
    };
  }

  /**
   * Asks the tenant backend to refresh its registry immediately so a
   * purged tenant stops being routable without waiting for the 60s poll.
   * Never throws: a failed push only costs the wait until the next poll.
   * (Mirrors ProvisioningService's post-provisioning push.)
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
          `Backend registry refresh for purged tenant ${slug} returned HTTP ${response.status}; the next 60s poll will pick it up`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Backend registry refresh for purged tenant ${slug} failed (${err instanceof Error ? err.message : String(err)}); the next 60s poll will pick it up`,
      );
    }
  }

  private async fetchJson<T>(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new BadGatewayException(
        `Tenant data export failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BadGatewayException(
        `Tenant data export failed: HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Deletes export files older than TENANT_EXPORT_RETENTION_DAYS
   * (default 90). Runs with the purge sweep. Only `.json`/`.json.enc`
   * files in the export dir are touched, and age is measured by mtime —
   * the filename timestamp is cosmetic.
   */
  async runExportRetentionSweep(now = Date.now()): Promise<{
    deleted: number;
    bytesFreed: number;
  }> {
    const dir = exportDir();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return { deleted: 0, bytesFreed: 0 };
      throw err;
    }
    const cutoff = now - exportRetentionDays() * 86_400_000;
    let deleted = 0;
    let bytesFreed = 0;
    for (const file of files) {
      if (!/\.json(\.enc)?$/.test(file)) continue;
      const path = join(dir, file);
      const info = await stat(path).catch(() => null);
      if (!info || !info.isFile() || info.mtimeMs >= cutoff) continue;
      await unlink(path);
      deleted += 1;
      bytesFreed += info.size;
    }
    if (deleted > 0) {
      this.logger.log(
        `Export retention sweep deleted ${deleted} file(s) (${bytesFreed} bytes) older than ${exportRetentionDays()} days`,
      );
    }
    return { deleted, bytesFreed };
  }

  async purgeNow(id: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'DELETED' || !tenant.deletedAt) {
      throw new BadRequestException('Tenant must be soft-deleted before purge');
    }
    if (Date.now() < purgeAfter(tenant.deletedAt).getTime()) {
      throw new BadRequestException(
        `Retention window is still open until ${purgeAfter(tenant.deletedAt).toISOString()}`,
      );
    }
    return this.purgeTenant(tenant, actorId);
  }

  async runPurgeSweep(now = Date.now()) {
    if (process.env.TENANT_PURGE_ENABLED === 'false') {
      return { purged: 0, failed: 0, exportsPruned: 0 };
    }
    const retention = await this.runExportRetentionSweep(now).catch((err) => {
      this.logger.warn(
        `Export retention sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { deleted: 0, bytesFreed: 0 };
    });
    const cutoff = new Date(now - retentionDays() * 86_400_000);
    const due = await this.prisma.tenant.findMany({
      where: { status: 'DELETED', deletedAt: { lte: cutoff } },
      orderBy: { deletedAt: 'asc' },
      take: 25,
    });

    let purged = 0;
    let failed = 0;
    const failures: Array<{ slug: string; error: string }> = [];
    for (const tenant of due) {
      try {
        await this.purgeTenant(tenant);
        purged++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ slug: tenant.slug, error: message });
        this.logger.warn(
          `Purge ${tenant.slug} failed; will retry: ${message}`,
        );
      }
    }
    // Phase 8 Stage 2 item 20: a failing purge sweep used to be a lone
    // logger.warn per tenant — invisible to ops. Alert once per sweep
    // when anything failed (AlertsService throttles repeat sweeps).
    if (failed > 0) {
      await this.alerts?.sendAlert({
        kind: 'purge-sweep-failure',
        subject: `Tenant purge sweep failed for ${failed} tenant(s)`,
        text:
          `The 6-hour purge sweep purged ${purged} tenant(s) and failed on ` +
          `${failed}:\n` +
          failures
            .map((f) => `- ${f.slug}: ${f.error}`)
            .join('\n') +
          `\n\nFailures retry on the next sweep, but a repeated failure ` +
          `usually means the export step is broken (timeout / row cap) — ` +
          `check the tenant export path before the retention backlog grows.`,
      });
    }
    return { purged, failed, exportsPruned: retention.deleted };
  }

  private async purgeTenant(
    tenant: {
      id: string;
      slug: string;
      status: string;
      deletedAt: Date | null;
    },
    actorId?: string,
  ) {
    if (tenant.status !== 'DELETED' || !tenant.deletedAt) {
      throw new BadRequestException('Tenant must be soft-deleted before purge');
    }
    if (Date.now() < purgeAfter(tenant.deletedAt).getTime()) {
      throw new BadRequestException('Retention window is still open');
    }

    // Export first: if this fails the tenant row and all data stay intact.
    const exported = await this.exportToFile(tenant.id, actorId);

    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new BadGatewayException(
        'INTERNAL_SERVICE_SECRET is not configured; tenant purge is unavailable',
      );
    }
    let deletedRows = 0;
    let mediaDeletedFiles = 0;
    let mediaFailedFiles: string[] = [];
    let jobsRemoved = 0;
    try {
      const response = await fetch(`${apiBase()}/internal/provisioning/purge`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform-service-token': secret,
        },
        body: JSON.stringify({ tenantId: tenant.id, slug: tenant.slug }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 4),
      });
      const data = (await response.json().catch(() => null)) as {
        deletedRows?: number;
        mediaDeletedFiles?: number;
        mediaFailedFiles?: string[];
        jobsRemoved?: number;
      } | null;
      if (!response.ok) {
        throw new Error(`tenant purge HTTP ${response.status}`);
      }
      deletedRows = Number(data?.deletedRows) || 0;
      mediaDeletedFiles = Number(data?.mediaDeletedFiles) || 0;
      mediaFailedFiles = Array.isArray(data?.mediaFailedFiles)
        ? data.mediaFailedFiles
        : [];
      jobsRemoved = Number(data?.jobsRemoved) || 0;
    } catch (err) {
      throw new BadGatewayException(
        `Tenant data purge failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // The signup request is an orphan with no FK to the tenant: it stays
    // VERIFIED forever after provisioning succeeds, and assertAvailable
    // blocks any re-signup with the same email/slug while a PENDING_EMAIL
    // or VERIFIED request exists — so without this delete, purging a tenant
    // permanently bricks re-signup for that owner email. Delete by slug
    // (the request's link to the tenant); the export already ran, and the
    // request's credential material (password/token hashes) must not
    // outlive the tenant. The provisioning job cascades with the tenant row.
    const signupRequestsDeleted = await this.prisma.signupRequest.deleteMany({
      where: { slug: tenant.slug },
    });

    await this.audit.record({
      actorId,
      tenantId: tenant.id,
      action: 'tenant.purge',
      entity: 'Tenant',
      entityId: tenant.id,
      after: {
        slug: tenant.slug,
        exportPath: exported.path,
        deletedRows,
        mediaDeletedFiles,
        mediaFailedFiles,
        jobsRemoved,
        signupRequestsDeleted: signupRequestsDeleted.count,
      },
    });
    await this.prisma.tenant.delete({ where: { id: tenant.id } });

    // Push a registry refresh so the backend stops routing the purged
    // tenant immediately (same push as provisioning, opposite direction):
    // without it the tenant stays routable from the stale registry for up
    // to 60s, and queued-job skips cannot see that it is gone. Best-effort.
    await this.notifyBackendRegistryRefresh(secret, tenant.slug);

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      exportPath: exported.path,
      exportFilename: exported.filename,
      deletedRows,
      mediaDeletedFiles,
      mediaFailedFiles,
      jobsRemoved,
      signupRequestsDeleted: signupRequestsDeleted.count,
      purgedAt: new Date().toISOString(),
    };
  }

  private deleteSummary(id: string, slug: string, deletedAt: Date) {
    return {
      id,
      slug,
      status: 'DELETED',
      deletedAt,
      purgeAfter: purgeAfter(deletedAt),
      retentionDays: retentionDays(),
    };
  }
}
