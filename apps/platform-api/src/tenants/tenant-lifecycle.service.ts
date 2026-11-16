import {
  BadGatewayException,
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PURGE_INTERVAL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;

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
   */
  async exportToFile(tenantId: string, actorId?: string) {
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

    let tenantData: unknown;
    try {
      const response = await fetch(`${apiBase()}/internal/provisioning/export`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-platform-service-token': secret,
        },
        body: JSON.stringify({ tenantId: tenant.id, slug: tenant.slug }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `tenant export HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
        );
      }
      tenantData = await response.json();
    } catch (err) {
      throw new BadGatewayException(
        `Tenant data export failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const exportedAt = new Date();
    const payload = JSON.stringify({
      version: 1,
      exportedAt: exportedAt.toISOString(),
      platform: tenant,
      tenant: tenantData,
    });
    const dir = exportDir();
    await mkdir(dir, { recursive: true });
    const filename = `${tenant.slug}-${exportedAt
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;
    const path = join(dir, filename);
    await writeFile(path, payload, 'utf8');

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.export',
      entity: 'Tenant',
      entityId: tenantId,
      after: { filename, sizeBytes: Buffer.byteLength(payload) },
    });

    return {
      path,
      filename,
      sizeBytes: Buffer.byteLength(payload),
      exportedAt,
    };
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
      return { purged: 0, failed: 0 };
    }
    const cutoff = new Date(now - retentionDays() * 86_400_000);
    const due = await this.prisma.tenant.findMany({
      where: { status: 'DELETED', deletedAt: { lte: cutoff } },
      orderBy: { deletedAt: 'asc' },
      take: 25,
    });

    let purged = 0;
    let failed = 0;
    for (const tenant of due) {
      try {
        await this.purgeTenant(tenant);
        purged++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Purge ${tenant.slug} failed; will retry: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { purged, failed };
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
      } | null;
      if (!response.ok) {
        throw new Error(`tenant purge HTTP ${response.status}`);
      }
      deletedRows = Number(data?.deletedRows) || 0;
    } catch (err) {
      throw new BadGatewayException(
        `Tenant data purge failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

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
      },
    });
    await this.prisma.tenant.delete({ where: { id: tenant.id } });

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      exportPath: exported.path,
      exportFilename: exported.filename,
      deletedRows,
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
