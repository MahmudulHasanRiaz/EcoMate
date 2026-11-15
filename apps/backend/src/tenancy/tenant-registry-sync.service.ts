import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  TenantRegistryRecord,
  TenantRegistryService,
} from './tenant-registry.service';

export interface PlatformRegistryResponse {
  generatedAt?: string;
  tenants?: Array<{
    id: string;
    slug: string;
    status: string;
    hosts?: string[];
    trialEndsAt?: string | null;
    graceEndsAt?: string | null;
    subscription?: {
      status?: string;
      trialEndsAt?: string | null;
      currentPeriodEnd?: string | null;
    } | null;
    plan?: {
      name?: string;
      features?: unknown;
      limits?: unknown;
    } | null;
  }>;
}

@Injectable()
export class TenantRegistrySyncService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TenantRegistrySyncService.name);
  private readonly refreshMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRefreshAt: Date | null = null;
  private lastError: string | null = null;

  constructor(private readonly registry: TenantRegistryService) {
    this.refreshMs = Math.max(
      10_000,
      Number(process.env.TENANT_REGISTRY_REFRESH_MS ?? 60_000),
    );
  }

  onModuleInit(): void {
    if (!process.env.PLATFORM_API_URL || !process.env.INTERNAL_SERVICE_SECRET) {
      this.logger.log(
        'Tenant registry sync disabled (PLATFORM_API_URL / INTERNAL_SERVICE_SECRET not set)',
      );
      return;
    }

    void this.refreshNow();
    this.timer = setInterval(() => void this.refreshNow(), this.refreshMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refreshNow(): Promise<boolean> {
    const baseUrl = process.env.PLATFORM_API_URL?.replace(/\/+$/, '');
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!baseUrl || !secret) {
      this.lastError = 'PLATFORM_API_URL / INTERNAL_SERVICE_SECRET not set';
      return false;
    }

    try {
      const response = await fetch(`${baseUrl}/internal/tenants/registry`, {
        headers: { 'x-platform-service-token': secret },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(`platform registry HTTP ${response.status}`);
      }

      const payload = (await response.json()) as PlatformRegistryResponse;
      const records: TenantRegistryRecord[] = (payload.tenants ?? []).map(
        (tenant) => {
          const features = Array.isArray(tenant.plan?.features)
            ? tenant.plan.features.filter(
                (feature): feature is string => typeof feature === 'string',
              )
            : undefined;
          const limits =
            tenant.plan?.limits &&
            typeof tenant.plan.limits === 'object' &&
            !Array.isArray(tenant.plan.limits)
              ? (tenant.plan.limits as Record<string, unknown>)
              : undefined;

          return {
            id: tenant.id,
            slug: tenant.slug,
            status: tenant.status,
            hosts: Array.isArray(tenant.hosts) ? tenant.hosts : [],
            features,
            limits,
            planName: tenant.plan?.name,
            subscriptionStatus: tenant.subscription?.status ?? null,
            trialEndsAt:
              tenant.subscription?.trialEndsAt ?? tenant.trialEndsAt ?? null,
            currentPeriodEnd:
              tenant.subscription?.currentPeriodEnd ?? null,
            graceEndsAt: tenant.graceEndsAt ?? null,
            validUntil:
              tenant.subscription?.currentPeriodEnd ??
              tenant.trialEndsAt ??
              tenant.graceEndsAt ??
              null,
          };
        },
      );

      this.registry.replace(records);
      this.lastRefreshAt = new Date();
      this.lastError = null;
      this.logger.log(`Tenant registry refreshed (${records.length} tenants)`);
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Tenant registry refresh failed; keeping last-known-good: ${this.lastError}`,
      );
      return false;
    }
  }

  getStatus(): {
    lastRefreshAt: string | null;
    lastError: string | null;
    tenants: number;
  } {
    return {
      lastRefreshAt: this.lastRefreshAt?.toISOString() ?? null,
      lastError: this.lastError,
      tenants: this.registry.size(),
    };
  }
}
