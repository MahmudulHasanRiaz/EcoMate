import { Injectable } from '@nestjs/common';
import { normaliseHost } from './tenant-host';

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
