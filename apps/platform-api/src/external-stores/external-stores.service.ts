import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  ClaimBindingDto,
  type StoreProviderSlug,
} from './dto/claim-binding.dto';
import type { SyncReportDto } from './dto/sync-report.dto';
import type { SettableBindingStatus } from './dto/update-binding-status.dto';

/** A PENDING binding that never completes expires after 10 minutes (§3.4). */
export const PENDING_BINDING_TTL_MS = 10 * 60_000;
/** Sweep tick — same setInterval pattern as the tenant purge sweep. */
const PENDING_SWEEP_INTERVAL_MS = 60_000;

/** Generic 409 for any claim collision — no identifying data (§3.12.5). */
export const STORE_ALREADY_BOUND = 'STORE_ALREADY_BOUND';
/** Generic 404 for any unknown binding — no oracle for store ids (§3.3). */
const BINDING_NOT_FOUND = 'External store not found';

/** Backend call timeout — same value as the tenant-lifecycle purge hook. */
const FETCH_TIMEOUT_MS = 30_000;

/** Tenant-backend base URL — same shape as tenant-lifecycle.service.ts. */
function apiBase(): string {
  const configured = (
    process.env.TENANT_BACKEND_URL || 'http://backend:4000/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

/**
 * Platform-side external-store bindings (Phase 9 §3.4, §3.12.4).
 *
 * This is the GLOBAL registry the tenant backend's ExternalStoreResolver
 * reads: a store identity (fingerprint / provider+domain) belongs to
 * exactly one tenant, enforced by the DB uniques — RLS cannot do this
 * because the resolver runs BEFORE any tenant context exists.
 *
 * Lifecycle: claim (PENDING) → connect succeeds → ACTIVE; disconnect →
 * DISCONNECTED (row RETAINED, ruling D9 — reconnect reuses it); tenant
 * purge or operator force-unbind deletes it. A PENDING row that never
 * completes expires after 10 minutes (sweep below).
 *
 * The tenant backend is the only caller of the internal endpoints
 * (InternalServiceGuard); the operator force-unbind goes through the
 * console tenants controller.
 */
@Injectable()
export class ExternalStoresService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExternalStoresService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // PENDING sweep: a platform-api interval (build decision — the
    // runPerTenant/cron pattern is for per-tenant work; this is one
    // global deleteMany, so an interval like the purge sweep is the
    // lighter fit). Idempotent: only PENDING rows older than the TTL
    // match, so a double run (or a manual re-run) is a no-op.
    this.sweepTimer = setInterval(() => {
      void this.expirePendingBindings().catch((err) =>
        this.logger.error(
          `Pending binding sweep failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }, PENDING_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Normalise a domain the same way the backend's store-identity does for case/whitespace. */
  private normaliseDomain(domain: string | null | undefined): string | null {
    const trimmed = domain?.trim().toLowerCase();
    return trimmed ? trimmed : null;
  }

  private normaliseOptional(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  /**
   * Resolve a storeId to its tenant (ExternalStoreResolver's first
   * lookup). Returns the binding status too — the resolver decides what
   * each status means (PENDING/ACTIVE resolve; DISCONNECTED/BLOCKED do
   * not). Generic 404 for unknown ids: the UUID must not become an
   * oracle for store existence.
   */
  async resolveByStoreId(storeId: string): Promise<{
    tenantId: string;
    status: string;
  }> {
    const binding = await this.prisma.tenantExternalStoreBinding.findUnique({
      where: { storeId },
      select: { tenantId: true, status: true },
    });
    if (!binding) throw new NotFoundException(BINDING_NOT_FOUND);
    return { tenantId: binding.tenantId, status: binding.status };
  }

  /**
   * Resolve a shop domain to its tenant (Shopify install landing +
   * webhook intake when only the shop domain is known). Same generic
   * 404 — a wrong domain and an unbound domain are indistinguishable.
   */
  async resolveByProviderDomain(
    provider: StoreProviderSlug,
    domain: string,
  ): Promise<{ tenantId: string; status: string }> {
    const domainNormalised = this.normaliseDomain(domain);
    if (!domainNormalised) throw new NotFoundException(BINDING_NOT_FOUND);
    const binding = await this.prisma.tenantExternalStoreBinding.findFirst({
      where: { provider, domainNormalised },
      select: { tenantId: true, status: true },
    });
    if (!binding) throw new NotFoundException(BINDING_NOT_FOUND);
    return { tenantId: binding.tenantId, status: binding.status };
  }

  /**
   * Claim a binding for a pre-generated storeId. The DB uniques
   * (fingerprint, provider+domain, storeId PK) are the arbiters — a
   * pre-check cannot replace the P2002 catch (a concurrent claim could
   * land between check and insert). Any collision is the same generic
   * 409 with no identifying data.
   *
   * Idempotent retry: if the SAME tenant re-claims the SAME storeId
   * with the SAME fingerprint while the row is still PENDING (a crash
   * between claim and tenant insert, retried), the existing row is
   * returned instead of a 409 — the caller already knows all three
   * values, so this leaks nothing.
   */
  async claim(dto: ClaimBindingDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const data = {
      storeId: dto.storeId,
      tenantId: dto.tenantId,
      provider: dto.provider,
      providerStoreId: this.normaliseOptional(dto.providerStoreId),
      domainNormalised: this.normaliseDomain(dto.domainNormalised),
      identityFingerprint: dto.identityFingerprint.toLowerCase(),
    };
    try {
      return await this.prisma.tenantExternalStoreBinding.create({ data });
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      // Idempotent retry (same tenant + storeId + fingerprint, PENDING).
      const existing =
        await this.prisma.tenantExternalStoreBinding.findUnique({
          where: { storeId: dto.storeId },
        });
      if (
        existing &&
        existing.tenantId === dto.tenantId &&
        existing.identityFingerprint === data.identityFingerprint &&
        existing.status === 'PENDING'
      ) {
        return existing;
      }
      throw new ConflictException(STORE_ALREADY_BOUND);
    }
  }

  /**
   * Release a PENDING binding (connect-flow failure path: claim
   * succeeded but the tenant Store insert failed). PENDING-only — an
   * ACTIVE binding is a live store and must never be released this
   * way; disconnect (status update) or operator force-unbind covers
   * those paths.
   */
  async release(storeId: string): Promise<{ released: boolean; storeId: string }> {
    const deleted = await this.prisma.tenantExternalStoreBinding.deleteMany({
      where: { storeId, status: 'PENDING' },
    });
    if (deleted.count === 0) throw new NotFoundException(BINDING_NOT_FOUND);
    return { released: true, storeId };
  }

  /** Status update from the tenant backend (connect success, disconnect). */
  async updateStatus(storeId: string, status: SettableBindingStatus) {
    const updated = await this.prisma.tenantExternalStoreBinding.updateMany({
      where: { storeId },
      data: { status },
    });
    if (updated.count === 0) throw new NotFoundException(BINDING_NOT_FOUND);
    return this.prisma.tenantExternalStoreBinding.findUnique({
      where: { storeId },
    });
  }

  /** Sync-health report from the tenant backend (console panel data). */
  async syncReport(storeId: string, dto: SyncReportDto) {
    const updated = await this.prisma.tenantExternalStoreBinding.updateMany({
      where: { storeId },
      data: {
        lastSyncAt: dto.lastSyncAt ? new Date(dto.lastSyncAt) : new Date(),
        ...(dto.lastError !== undefined
          ? { lastError: dto.lastError }
          : {}),
      },
    });
    if (updated.count === 0) throw new NotFoundException(BINDING_NOT_FOUND);
    return this.prisma.tenantExternalStoreBinding.findUnique({
      where: { storeId },
      select: { storeId: true, lastSyncAt: true, lastError: true },
    });
  }

  /**
   * Delete PENDING bindings older than the 10-minute TTL. Returns the
   * number expired (0 is the normal case). Called by the sweep timer;
   * public so the console jobs / tests can trigger it directly.
   */
  async expirePendingBindings(): Promise<{ expired: number }> {
    const cutoff = new Date(Date.now() - PENDING_BINDING_TTL_MS);
    const deleted = await this.prisma.tenantExternalStoreBinding.deleteMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
    });
    if (deleted.count > 0) {
      this.logger.log(
        `Expired ${deleted.count} pending external-store binding(s) older than 10 minutes`,
      );
    }
    return { expired: deleted.count };
  }

  /**
   * Operator force-unbind (console): releases the store's identity on
   * BOTH sides, freeing the fingerprint for another tenant (§8.2.2).
   * The tenant-DB Store row keeps its history (mappings, sync runs,
   * credentials) — only its globally-unique identity columns are
   * cleared, via the backend internal endpoint. The release runs FIRST
   * and fails closed: a backend failure leaves the binding intact and
   * the operator retries, so a deleted binding always means a freed
   * fingerprint. Audited; SUPERADMIN-only at the controller.
   */
  async forceUnbind(
    tenantId: string,
    storeId: string,
    actorId?: string,
  ): Promise<{ unbound: boolean; storeId: string }> {
    const binding = await this.prisma.tenantExternalStoreBinding.findUnique({
      where: { storeId },
    });
    if (!binding || binding.tenantId !== tenantId) {
      throw new NotFoundException(BINDING_NOT_FOUND);
    }
    await this.releaseTenantStoreIdentity(tenantId, storeId);
    await this.prisma.tenantExternalStoreBinding.delete({
      where: { storeId },
    });
    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.external_store.unbind',
      entity: 'TenantExternalStoreBinding',
      entityId: storeId,
      before: {
        provider: binding.provider,
        domainNormalised: binding.domainNormalised,
        status: binding.status,
      },
    });
    return { unbound: true, storeId };
  }

  /**
   * D-1: clear the tenant-side Store row's identity (fingerprint +
   * domain → NULL, status → DISCONNECTED) via the backend internal
   * endpoint. Same coordination pattern as the tenant-lifecycle purge
   * hook: `x-platform-service-token` + INTERNAL_SERVICE_SECRET, explicit
   * tenant id + slug in the body, backend runs it in that tenant's
   * context. A missing store row is NOT an error (the backend returns
   * `{ released: false }` with 200 — the fingerprint is already free);
   * only transport / non-2xx failures throw, and they throw BEFORE the
   * binding is deleted so the unbind can be retried cleanly.
   */
  private async releaseTenantStoreIdentity(
    tenantId: string,
    storeId: string,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new BadGatewayException(
        'INTERNAL_SERVICE_SECRET is not configured; external-store force-unbind is unavailable',
      );
    }
    try {
      const response = await fetch(
        `${apiBase()}/internal/stores/${storeId}/release-identity`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-platform-service-token': secret,
          },
          body: JSON.stringify({ tenantId, slug: tenant.slug }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        throw new Error(`store identity release HTTP ${response.status}`);
      }
    } catch (err) {
      throw new BadGatewayException(
        `Store identity release failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
