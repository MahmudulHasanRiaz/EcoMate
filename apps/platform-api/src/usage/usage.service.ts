import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LIMIT_KEYS,
  LimitKey,
  coerceLimit,
  isLimitKey,
} from '@ecomate/shared-types';
import { AuditService } from '../common/audit.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  EffectiveLimitRow,
  LimitOverrideLike,
  describeLimits,
  dhakaDateOnly,
  formatDhakaDate,
  usagePercent,
} from './usage.limits';

const FETCH_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 5_000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;

export interface UsageMetricRow extends EffectiveLimitRow {
  used: number | null;
  percent: number | null;
  warning: boolean;
  over: boolean;
  /** Dhaka calendar day of the snapshot the usage came from (null = none). */
  capturedAt: string | null;
}

export interface TenantUsageResponse {
  tenant: { id: string; slug: string; name: string; status: string };
  planName: string | null;
  metrics: UsageMetricRow[];
  overrides: Array<LimitOverrideLike & { updatedAt: string }>;
  history: Record<string, Array<{ date: string; value: number }>>;
  lastCollectedAt: string | null;
}

function apiBase(): string {
  const configured = (
    process.env.TENANT_BACKEND_URL || 'http://backend:4000/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function windowDays(value?: number): number {
  const days = Number(value ?? DEFAULT_WINDOW_DAYS);
  if (!Number.isFinite(days)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(days)));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cross-tenant usage reads for the platform console.
 *
 * The platform is the authority for plan limits and per-tenant overrides; the
 * tenant runtime is the authority for consumed counters. A refresh pulls the
 * counters over the internal service channel and stores one `UsageDaily` row
 * per metric and Dhaka calendar day, so the dashboard never invents numbers.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly audit: AuditService,
  ) {}

  async refreshTenant(id: string): Promise<TenantUsageResponse> {
    const tenant = await this.loadTenant(id);
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      throw new BadGatewayException(
        'INTERNAL_SERVICE_SECRET is not configured; tenant usage is unavailable',
      );
    }

    const url =
      `${apiBase()}/internal/usage?tenantId=${encodeURIComponent(id)}` +
      `&slug=${encodeURIComponent(tenant.slug)}`;

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

    const captured = new Map<LimitKey, number>();
    for (const row of limits) {
      if (!row || typeof row !== 'object') continue;
      const { key, used } = row as { key?: unknown; used?: unknown };
      if (typeof key !== 'string' || !isLimitKey(key)) continue;
      if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) {
        continue;
      }
      captured.set(key, Math.floor(used));
    }

    if (captured.size === 0) {
      throw new BadGatewayException(
        'Tenant usage payload did not include any known limit counter',
      );
    }

    const date = dhakaDateOnly(new Date());
    await Promise.all(
      Array.from(captured.entries()).map(([metric, value]) =>
        this.prisma.usageDaily.upsert({
          where: {
            tenantId_date_metric: {
              tenantId: id,
              date,
              metric,
            },
          },
          create: { tenantId: id, date, metric, value },
          update: { value },
        }),
      ),
    );

    return this.getTenantUsage(id);
  }

  async getTenantUsage(
    id: string,
    days?: number,
  ): Promise<TenantUsageResponse> {
    const tenant = await this.loadTenant(id);
    const window = windowDays(days);
    const start = new Date(Date.now() - window * 86_400_000);

    const rows = await this.prisma.usageDaily.findMany({
      where: { tenantId: id, date: { gte: start } },
      orderBy: { date: 'asc' },
    });

    const history: Record<string, Array<{ date: string; value: number }>> = {};
    const latest = new Map<string, { value: number; date: string }>();
    const collected: string[] = [];

    for (const row of rows) {
      if (!isLimitKey(row.metric)) continue;
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      const date = formatDhakaDate(new Date(row.date));
      history[row.metric] ??= [];
      history[row.metric].push({ date, value });
      latest.set(row.metric, { value, date });
      collected.push(row.updatedAt.toISOString());
    }

    if (collected.length > 0) {
      collected.sort();
    }

    const planVersion =
      tenant.subscription?.planVersion ?? tenant.planVersion ?? null;
    const overrides = this.overridesOf(tenant.limitOverrides);
    const metrics = describeLimits(planVersion?.limits, overrides).map(
      (row): UsageMetricRow => {
        const snapshot = latest.get(row.key) ?? null;
        const used = snapshot?.value ?? null;
        const percent = usagePercent(used, row.limit);
        return {
          ...row,
          used,
          percent,
          warning: percent !== null && percent >= 80,
          over: used !== null && row.limit !== null && used > row.limit,
          capturedAt: snapshot?.date ?? null,
        };
      },
    );

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
      },
      planName: planVersion?.plan?.name ?? null,
      metrics,
      overrides,
      history,
      lastCollectedAt:
        collected.length > 0 ? collected[collected.length - 1] : null,
    };
  }

  async overview(days?: number) {
    const window = windowDays(days);
    const start = new Date(Date.now() - window * 86_400_000);

    const tenants = await this.prisma.tenant.findMany({
      where: { status: { not: 'DELETED' } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        planVersion: {
          select: { limits: true, plan: { select: { name: true } } },
        },
        subscription: {
          select: {
            planVersion: {
              select: { limits: true, plan: { select: { name: true } } },
            },
          },
        },
        limitOverrides: {
          select: { key: true, value: true, note: true, updatedAt: true },
        },
      },
    });

    const ids = tenants.map((tenant) => tenant.id);
    const rows =
      ids.length === 0
        ? []
        : await this.prisma.usageDaily.findMany({
            where: { tenantId: { in: ids }, date: { gte: start } },
            orderBy: { date: 'desc' },
          });

    const latest = new Map<string, Map<string, { value: number; date: string }>>();
    const collected = new Map<string, string>();
    for (const row of rows) {
      if (!isLimitKey(row.metric)) continue;
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      const perTenant = latest.get(row.tenantId) ?? new Map();
      if (!perTenant.has(row.metric)) {
        perTenant.set(row.metric, {
          value,
          date: formatDhakaDate(new Date(row.date)),
        });
      }
      latest.set(row.tenantId, perTenant);
      const updated = row.updatedAt.toISOString();
      if (!collected.has(row.tenantId) || collected.get(row.tenantId)! < updated) {
        collected.set(row.tenantId, updated);
      }
    }

    const result = tenants.map((tenant) => {
      const planVersion =
        tenant.subscription?.planVersion ?? tenant.planVersion ?? null;
      const overrides = this.overridesOf(tenant.limitOverrides);
      const snapshots = latest.get(tenant.id) ?? new Map();
      const metrics = describeLimits(planVersion?.limits, overrides).map(
        (row): UsageMetricRow => {
          const snapshot = snapshots.get(row.key) ?? null;
          const used = snapshot?.value ?? null;
          const percent = usagePercent(used, row.limit);
          return {
            ...row,
            used,
            percent,
            warning: percent !== null && percent >= 80,
            over: used !== null && row.limit !== null && used > row.limit,
            capturedAt: snapshot?.date ?? null,
          };
        },
      );
      const lastCollectedAt = collected.get(tenant.id) ?? null;
      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        planName: planVersion?.plan?.name ?? null,
        metrics,
        overrides,
        over: metrics.some((metric) => metric.over),
        warning: metrics.some((metric) => metric.warning && !metric.over),
        maxPercent: metrics.reduce(
          (max, metric) => Math.max(max, metric.percent ?? 0),
          0,
        ),
        lastCollectedAt,
      };
    });

    result.sort(
      (a, b) =>
        Number(b.over) - Number(a.over) ||
        b.maxPercent - a.maxPercent ||
        a.name.localeCompare(b.name),
    );

    const tracked = result.filter((tenant) => tenant.lastCollectedAt).length;
    return {
      generatedAt: new Date().toISOString(),
      windowDays: window,
      totals: {
        tenants: result.length,
        tracked,
        missing: result.length - tracked,
        overLimitMetrics: result.reduce(
          (sum, tenant) =>
            sum + tenant.metrics.filter((metric) => metric.over).length,
          0,
        ),
        warningMetrics: result.reduce(
          (sum, tenant) =>
            sum +
            tenant.metrics.filter(
              (metric) => metric.warning && !metric.over,
            ).length,
          0,
        ),
      },
      tenants: result,
    };
  }

  async refreshAll() {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { not: 'DELETED' } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    let refreshed = 0;
    const failed: Array<{ tenantId: string; error: string }> = [];
    for (const tenant of tenants) {
      try {
        await this.refreshTenant(tenant.id);
        refreshed += 1;
      } catch (error) {
        failed.push({ tenantId: tenant.id, error: errorText(error) });
      }
    }

    return { total: tenants.length, refreshed, failed };
  }

  async setOverride(
    tenantId: string,
    key: string,
    dto: { value: number; note?: string | null },
    actorId?: string,
  ) {
    if (!isLimitKey(key)) {
      throw new BadRequestException(`Unknown limit key: ${key}`);
    }
    const value = coerceLimit(dto.value);
    if (value === null) {
      throw new BadRequestException(
        'A limit override must be a finite non-negative whole number',
      );
    }

    const tenant = await this.loadTenant(tenantId);
    const existing = await this.prisma.tenantLimitOverride.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });

    const saved = await this.prisma.tenantLimitOverride.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: {
        tenantId,
        key,
        value,
        note: dto.note ?? null,
        createdBy: actorId ?? null,
        updatedBy: actorId ?? null,
      },
      update: {
        value,
        note: dto.note ?? null,
        updatedBy: actorId ?? null,
      },
    });

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.limit_override.set',
      entity: 'TenantLimitOverride',
      entityId: saved.id,
      before: existing
        ? { value: existing.value, note: existing.note }
        : null,
      after: { key, value, note: dto.note ?? null },
    });

    return {
      override: saved,
      refresh: await this.pushRefresh(tenant.slug),
    };
  }

  async clearOverride(tenantId: string, key: string, actorId?: string) {
    if (!isLimitKey(key)) {
      throw new BadRequestException(`Unknown limit key: ${key}`);
    }

    const tenant = await this.loadTenant(tenantId);
    const existing = await this.prisma.tenantLimitOverride.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (!existing) {
      throw new NotFoundException(`No override is set for ${key}`);
    }

    await this.prisma.tenantLimitOverride.delete({
      where: { id: existing.id },
    });

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.limit_override.clear',
      entity: 'TenantLimitOverride',
      entityId: existing.id,
      before: { key, value: existing.value, note: existing.note },
      after: null,
    });

    return {
      cleared: true,
      refresh: await this.pushRefresh(tenant.slug),
    };
  }

  /**
   * Best-effort immediate convergence. The 60s registry poll remains the
   * fallback, so a failed push must never roll back a saved override.
   */
  private async pushRefresh(slug: string): Promise<{
    ok: boolean;
    error?: string;
    status?: unknown;
  }> {
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      return {
        ok: false,
        error:
          'INTERNAL_SERVICE_SECRET is not configured; the tenant will pick up the change on its next registry poll',
      };
    }

    try {
      const response = await fetch(`${apiBase()}/entitlements/refresh`, {
        method: 'POST',
        headers: { 'x-platform-service-token': secret },
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: `Tenant refresh HTTP ${response.status}`,
        };
      }
      const status = await response.json().catch(() => null);
      return { ok: true, status };
    } catch (error) {
      this.logger.warn(
        `Tenant refresh push failed for ${slug}: ${errorText(error)}`,
      );
      return { ok: false, error: errorText(error) };
    }
  }

  private async loadTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        planVersion: { include: { plan: true } },
        subscription: { include: { planVersion: { include: { plan: true } } } },
        limitOverrides: {
          select: { key: true, value: true, note: true, updatedAt: true },
          orderBy: { key: 'asc' },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  private overridesOf(
    overrides:
      | Array<{
          key: string;
          value: number;
          note?: string | null;
          updatedAt: Date;
        }>
      | undefined,
  ): Array<LimitOverrideLike & { updatedAt: string }> {
    return (overrides ?? [])
      .filter((override) => isLimitKey(override.key))
      .map((override) => ({
        key: override.key,
        value: override.value,
        note: override.note ?? null,
        updatedAt: override.updatedAt.toISOString(),
      }));
  }
}
