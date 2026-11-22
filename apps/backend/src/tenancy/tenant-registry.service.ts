import { Injectable } from '@nestjs/common';
import {
  normaliseHost,
  readTenantDomainConfig,
  type TenantDomainConfig,
} from './tenant-host';

export interface TenantRegistryRecord {
  id: string;
  slug: string;
  status: string;
  hosts: string[];
  features?: string[];
  limits?: Record<string, unknown>;
  planName?: string;
  subscriptionStatus?: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  graceEndsAt?: string | null;
  validUntil?: string | null;
  /**
   * Areas blocked for this tenant RIGHT NOW, computed by the platform
   * (§9): the backend enforces what the registry says and never computes
   * billing state itself. Empty = nothing area-blocked.
   */
  blockedAreas?: string[];
  /**
   * Effective pricing for display on the tenant plan page (base fee,
   * per-order rate, minimum). Display only — the backend never computes
   * money.
   */
  effectivePricing?: {
    baseFee: number | null;
    ratePerUnit: number | null;
    minimumMonthly: number | null;
    currency: string;
  };
}

/**
 * In-memory host/slug registry.
 *
 * The production implementation is refreshed from the platform API and Redis
 * pub/sub. This class provides the lookup surface the middleware and the
 * external-store resolver will share.
 */
@Injectable()
export class TenantRegistryService {
  private bySlug = new Map<string, TenantRegistryRecord>();
  private byHost = new Map<string, TenantRegistryRecord>();
  private byId = new Map<string, TenantRegistryRecord>();
  /**
   * Domain config synced from the platform registry (set by
   * TenantRegistrySyncService). Null until the first successful sync
   * carrying a `domains` payload — until then resolution uses the env
   * config, exactly as before.
   */
  private syncedDomainConfig: TenantDomainConfig | null = null;
  private syncedDomainConfigAt: Date | null = null;

  /** Store the platform-synced domain config (validated by the sync service). */
  setDomainConfig(config: TenantDomainConfig): void {
    this.syncedDomainConfig = config;
    this.syncedDomainConfigAt = new Date();
  }

  /**
   * Domain config for host resolution: the synced platform config when
   * available, else the env config. The platform is the source of truth
   * (it is what the console edits); env is the bootstrap/fallback.
   */
  getDomainConfig(): TenantDomainConfig {
    return this.syncedDomainConfig ?? readTenantDomainConfig();
  }

  /** Where the current domain config came from — for status/verification. */
  getDomainConfigSource(): 'synced' | 'env' {
    return this.syncedDomainConfig ? 'synced' : 'env';
  }

  getDomainConfigUpdatedAt(): Date | null {
    return this.syncedDomainConfigAt;
  }

  replace(records: TenantRegistryRecord[]): void {
    this.bySlug.clear();
    this.byHost.clear();
    this.byId.clear();
    for (const record of records) this.index(record);
  }

  upsert(record: TenantRegistryRecord): void {
    const next = this.list().filter((item) => item.slug !== record.slug);
    next.push(record);
    this.replace(next);
  }

  remove(slug: string): void {
    this.replace(this.list().filter((item) => item.slug !== slug));
  }

  resolveBySlug(slug: string): TenantRegistryRecord | undefined {
    return this.bySlug.get(slug.trim().toLowerCase());
  }

  resolveByHost(host: string): TenantRegistryRecord | undefined {
    return this.byHost.get(normaliseHost(host));
  }

  /** Queue workers look tenants up by id (job payloads carry no slug). */
  resolveById(id: string): TenantRegistryRecord | undefined {
    return this.byId.get(id);
  }

  list(): TenantRegistryRecord[] {
    return Array.from(this.bySlug.values());
  }

  size(): number {
    return this.bySlug.size;
  }

  private index(record: TenantRegistryRecord): void {
    const slug = record.slug.trim().toLowerCase();
    const normalised: TenantRegistryRecord = {
      ...record,
      slug,
      hosts: record.hosts.map((host) => normaliseHost(host)).filter(Boolean),
    };
    this.bySlug.set(slug, normalised);
    this.byId.set(normalised.id, normalised);
    for (const host of normalised.hosts) {
      this.byHost.set(host, normalised);
    }
  }
}
