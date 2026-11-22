import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isLimitKey } from '@ecomate/shared-types';
import { AuditService } from '../common/audit.service';
import { TenantRefreshService } from '../common/tenant-refresh.service';
import { addInterval } from '../billing/billing-dates';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { formatDhakaDate } from '../usage/usage.limits';
import { resolveBlockedAreas, resolveBlockingConfig } from './blocking';
import {
  PricingDocument,
  isBlockingArea,
  isBlockingMode,
  isOverrideKey,
  parsePricingDocument,
  resolveVersionPricing,
} from './pricing-document';
import {
  PricingEngine,
  ResolvedAddOn,
  resolveEffectivePricing,
} from './pricing-engine';
import { SetBlockingOverrideDto } from './dto/blocking-override.dto';
import { SetPricingOverrideDto } from './dto/pricing-override.dto';

const FETCH_TIMEOUT_MS = 10_000;

function apiBase(): string {
  const configured = (
    process.env.TENANT_BACKEND_URL || 'http://backend:4000/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ResolvedSubscriptionPricing {
  /** Effective pricing: version pricing + purchase effects + overrides. */
  pricing: PricingDocument;
  sources: { baseFee: string; ratePerUnit: string; minimumMonthly: string };
  /** Active add-ons with their resolved pricing. */
  addOns: ResolvedAddOn[];
}

/**
 * DB-backed pricing resolution + per-client overrides + strict-blocking
 * overrides + period usage reads. The money math itself lives in the pure
 * PricingEngine — this service only gathers the inputs.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
    private readonly refresh: TenantRefreshService,
  ) {}

  /**
   * Resolve the effective pricing for a subscription (§4.1): version
   * pricing, APPLIED rate-tier purchases (latest wins), then tenant
   * overrides (explicit operator override wins over a purchase).
   * Add-ons active at `at` are resolved alongside.
   */
  async resolveForSubscription(
    subscriptionId: string,
    planVersion: { id: string; price?: unknown; currency?: string | null; pricing: unknown },
    at = new Date(),
  ): Promise<ResolvedSubscriptionPricing> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        tenantId: true,
        addOns: {
          where: {
            startedAt: { lte: at },
            OR: [{ endedAt: null }, { endedAt: { gt: at } }],
          },
          include: { addOn: true },
        },
      },
    });
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const [overrides, rateTierPurchases] = await Promise.all([
      this.prisma.tenantPricingOverride.findMany({
        where: { tenantId: subscription.tenantId },
      }),
      this.prisma.tenantPurchase.findMany({
        where: {
          tenantId: subscription.tenantId,
          type: 'RATE_TIER',
          status: 'APPLIED',
        },
        orderBy: { appliedAt: 'asc' },
      }),
    ]);

    const purchases = rateTierPurchases
      .map((purchase) => {
        const effect = purchase.effect as {
          perOrderRate?: unknown;
        } | null;
        const rate =
          effect && typeof effect.perOrderRate === 'number'
            ? effect.perOrderRate
            : null;
        return rate === null
          ? null
          : { feeKey: purchase.feeKey, perOrderRate: rate };
      })
      .filter((item): item is { feeKey: string; perOrderRate: number } =>
        item !== null,
      );

    const { pricing, sources } = resolveEffectivePricing({
      versionPricing: resolveVersionPricing(planVersion),
      overrides: overrides.map((row) => ({
        key: row.key,
        value: Number(row.value),
      })),
      rateTierPurchases: purchases,
    });

    // Trial-end rule (2026-11-22): a trial-granted add-on is NEVER billed
    // until the tenant confirms it at conversion (or an operator confirms
    // it). This is the single billing choke point — trial expiry, renewal,
    // plan-change close-out and quotes all flow through here — so one
    // filter fixes the silent trial-end billing and its repeat at every
    // later renewal. The rows still grant their features while attached
    // (the registry is a separate read); only the money waits.
    const addOns: ResolvedAddOn[] = subscription.addOns
      .filter((row) => !(row.trialGranted && !row.confirmedAt))
      .map((row) => {
        const metering = row.addOn.metering
          ? parsePricingDocument({ metering: row.addOn.metering }).metering
          : undefined;
        return {
          name: row.addOn.name,
          baseFee: Number(row.addOn.price),
          metering,
        };
      });

    return { pricing, sources, addOns };
  }

  /**
   * Dry-run: the effective pricing for a tenant on a version + the
   * computed bill for a hypothetical order count. No writes. Used by the
   * console preview and by operators answering "what will this tenant
   * pay?".
   */
  async preview(
    planId: string,
    versionId: string,
    options: { tenantId?: string; orders?: number },
  ) {
    const version = await this.prisma.planVersion.findUnique({
      where: { id: versionId },
      include: { plan: { select: { id: true, name: true } } },
    });
    if (!version || version.planId !== planId) {
      throw new NotFoundException('Plan version not found');
    }
    const orders = options.orders ?? 0;
    if (!Number.isInteger(orders) || orders < 0) {
      throw new BadRequestException('orders must be a non-negative integer');
    }

    let resolved: ResolvedSubscriptionPricing;
    if (options.tenantId) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { tenantId: options.tenantId },
        select: { id: true },
      });
      if (!subscription) {
        throw new NotFoundException('Tenant has no subscription');
      }
      resolved = await this.resolveForSubscription(subscription.id, version);
    } else {
      const { pricing, sources } = resolveEffectivePricing({
        versionPricing: resolveVersionPricing(version),
        overrides: [],
        rateTierPurchases: [],
      });
      resolved = { pricing, sources, addOns: [] };
    }

    const now = new Date();
    const periodEnd = addInterval(
      now,
      version.interval,
      version.intervalDays,
    );
    const computed = PricingEngine.compute({
      pricing: resolved.pricing,
      sources: resolved.sources,
      addOns: resolved.addOns,
      usage: { orders_per_month: orders },
      period: { start: now, end: periodEnd },
      planName: version.plan.name,
      intervalLabel:
        version.interval === 'YEARLY'
          ? 'yearly'
          : version.interval === 'CUSTOM'
            ? `${version.intervalDays ?? 30}-day`
            : 'monthly',
      periodLabel: `${formatDhakaDate(now)} to ${formatDhakaDate(periodEnd)}`,
    });

    return {
      planId: version.plan.id,
      planName: version.plan.name,
      versionId: version.id,
      version: version.version,
      effectivePricing: resolved.pricing,
      sources: resolved.sources,
      addOns: resolved.addOns,
      hypotheticalOrders: orders,
      bill: computed,
    };
  }

  /**
   * Live period usage from the tenant backend (§4.4). The billing engine
   * reads the LIVE count at billing time (never the UsageDaily snapshot,
   * which can be stale) and records it in the invoice trace. Throws on
   * any failure — the caller records the error and retries on the next
   * tick; a metered invoice is never created from a guessed number.
   */
  async fetchPeriodUsage(
    tenantId: string,
    slug: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, number>> {
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new BadGatewayException(
        'INTERNAL_SERVICE_SECRET is not configured; tenant usage is unavailable',
      );
    }
    const url =
      `${apiBase()}/internal/usage?tenantId=${encodeURIComponent(tenantId)}` +
      `&slug=${encodeURIComponent(slug)}` +
      `&from=${encodeURIComponent(from.toISOString())}` +
      `&to=${encodeURIComponent(to.toISOString())}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'x-platform-service-token': secret },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BadGatewayException(
        `Tenant usage fetch failed: ${errorText(error)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new BadGatewayException(
        `Tenant usage HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BadGatewayException('Tenant usage returned invalid JSON');
    }
    const limits = (payload as { limits?: unknown })?.limits;
    if (!Array.isArray(limits)) {
      throw new BadGatewayException('Tenant usage payload has no limits');
    }
    const captured: Record<string, number> = {};
    for (const row of limits) {
      if (!row || typeof row !== 'object') continue;
      const { key, used } = row as { key?: unknown; used?: unknown };
      if (typeof key !== 'string' || !isLimitKey(key)) continue;
      if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) {
        continue;
      }
      captured[key] = Math.floor(used);
    }
    if (Object.keys(captured).length === 0) {
      throw new BadGatewayException(
        'Tenant usage payload did not include any known limit counter',
      );
    }
    return captured;
  }

  // ── Per-client pricing overrides (§6/Q7) ─────────────────────────────

  async listOverrides(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        subscription: {
          select: {
            planVersion: { select: { id: true, pricing: true } },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const overrides = await this.prisma.tenantPricingOverride.findMany({
      where: { tenantId },
      orderBy: { key: 'asc' },
    });
    const planPricing = parsePricingDocument(
      tenant.subscription?.planVersion?.pricing,
    );
    const planValues = {
      per_order_rate: planPricing.metering?.ratePerUnit ?? null,
      minimum_monthly: planPricing.metering?.minimumMonthly ?? null,
    };
    return {
      tenantId,
      planValues,
      overrides: overrides.map((row) => ({
        key: row.key,
        value: Number(row.value),
        note: row.note,
        createdBy: row.createdBy,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt,
        planValue:
          row.key === 'per_order_rate'
            ? planValues.per_order_rate
            : planValues.minimum_monthly,
      })),
    };
  }

  async setOverride(
    tenantId: string,
    dto: SetPricingOverrideDto,
    actorId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!isOverrideKey(dto.key)) {
      throw new BadRequestException(`Unknown override key "${dto.key}"`);
    }
    const before = await this.prisma.tenantPricingOverride.findUnique({
      where: { tenantId_key: { tenantId, key: dto.key } },
    });
    const override = await this.prisma.tenantPricingOverride.upsert({
      where: { tenantId_key: { tenantId, key: dto.key } },
      create: {
        tenantId,
        key: dto.key,
        value: dto.value,
        note: dto.note ?? null,
        createdBy: actorId ?? null,
      },
      update: {
        value: dto.value,
        note: dto.note ?? null,
        updatedBy: actorId ?? null,
      },
    });
    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.pricing.override.set',
      entity: 'TenantPricingOverride',
      entityId: override.id,
      before: before ? { key: dto.key, value: String(before.value) } : null,
      after: { key: dto.key, value: String(dto.value) },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return override;
  }

  async deleteOverride(tenantId: string, key: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!isOverrideKey(key)) {
      throw new BadRequestException(`Unknown override key "${key}"`);
    }
    const before = await this.prisma.tenantPricingOverride.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!before) throw new NotFoundException('Pricing override not found');
    await this.prisma.tenantPricingOverride.delete({
      where: { tenantId_key: { tenantId, key } },
    });
    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.pricing.override.delete',
      entity: 'TenantPricingOverride',
      entityId: before.id,
      before: { key, value: String(before.value) },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return { tenantId, key, deleted: true };
  }

  // ── Per-client strict-blocking overrides (§9) ────────────────────────

  async getBlockingOverride(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        status: true,
        graceEndsAt: true,
        blockingOverride: true,
        subscription: {
          select: {
            status: true,
            planVersion: { select: { pricing: true } },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const planPricing = parsePricingDocument(
      tenant.subscription?.planVersion?.pricing,
    );
    const config = resolveBlockingConfig({
      planBlocking: planPricing.blocking ?? null,
      override: tenant.blockingOverride,
    });
    return {
      tenantId,
      override: tenant.blockingOverride,
      planBlocking: planPricing.blocking ?? null,
      effective: config,
      blockedAreasNow: resolveBlockedAreas({
        subscriptionStatus: tenant.subscription?.status ?? null,
        tenantStatus: tenant.status,
        graceEndsAt: tenant.graceEndsAt,
        config,
      }),
    };
  }

  async setBlockingOverride(
    tenantId: string,
    dto: SetBlockingOverrideDto,
    actorId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!isBlockingMode(dto.mode)) {
      throw new BadRequestException(`Unknown blocking mode "${dto.mode}"`);
    }
    const areas = [...new Set(dto.blockedAreas)];
    for (const area of areas) {
      if (!isBlockingArea(area)) {
        throw new BadRequestException(`Unknown blocking area "${area}"`);
      }
    }
    const before = await this.prisma.tenantBlockingOverride.findUnique({
      where: { tenantId },
    });
    const override = await this.prisma.tenantBlockingOverride.upsert({
      where: { tenantId },
      create: {
        tenantId,
        mode: dto.mode,
        blockedAreas: areas,
        note: dto.note ?? null,
        createdBy: actorId ?? null,
      },
      update: {
        mode: dto.mode,
        blockedAreas: areas,
        note: dto.note ?? null,
        updatedBy: actorId ?? null,
      },
    });
    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.blocking.override.set',
      entity: 'TenantBlockingOverride',
      entityId: tenantId,
      before: before
        ? { mode: before.mode, blockedAreas: before.blockedAreas }
        : null,
      after: { mode: dto.mode, blockedAreas: areas },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return override;
  }

  async deleteBlockingOverride(tenantId: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const before = await this.prisma.tenantBlockingOverride.findUnique({
      where: { tenantId },
    });
    if (!before) throw new NotFoundException('Blocking override not found');
    await this.prisma.tenantBlockingOverride.delete({
      where: { tenantId },
    });
    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.blocking.override.delete',
      entity: 'TenantBlockingOverride',
      entityId: tenantId,
      before: { mode: before.mode, blockedAreas: before.blockedAreas },
    });
    const pushed = await this.refresh.pushRefresh(tenant.slug);
    if (!pushed.ok) {
      this.logger.warn(
        `Entitlement refresh push failed for ${tenant.slug}: ${pushed.error}`,
      );
    }
    return { tenantId, deleted: true };
  }
}
