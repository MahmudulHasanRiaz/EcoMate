import { Injectable } from '@nestjs/common';
import { getTenantContext } from './tenant-context';
import {
  TenantRegistryRecord,
  TenantRegistryService,
} from './tenant-registry.service';

export type TenantAccessState =
  | 'full'
  | 'grace'
  | 'read_only'
  | 'suspended';

/** Tenant statuses that may operate (subject to the subscription state). */
const OPERATING_TENANT_STATUSES = new Set(['ACTIVE', 'TRIAL', 'PAST_DUE']);

/**
 * Tenant entitlement view backed by the platform registry snapshot.
 *
 * The registry refresh already carries the tenant's plan features/limits, so
 * feature checks do not make a per-request control-plane call. Missing
 * entitlements fail closed in production; dev/test keep the wildcard bridge.
 */
@Injectable()
export class TenantEntitlementsService {
  constructor(private readonly registry: TenantRegistryService) {}

  canUse(featureKey: string): boolean {
    const features = this.currentRecord()?.features;
    if (features) {
      return features.includes('*') || features.includes(featureKey);
    }
    return this.devWildcard();
  }

  getActiveFeatures(): string[] {
    const features = this.currentRecord()?.features;
    if (features) return [...features];
    return this.devWildcard() ? ['*'] : [];
  }

  getLimits(): Record<string, unknown> {
    return this.currentRecord()?.limits ?? {};
  }

  getPlanName(): string | null {
    return this.currentRecord()?.planName ?? null;
  }

  getSubscriptionStatus(): string | null {
    return this.currentRecord()?.subscriptionStatus ?? null;
  }

  /** Areas blocked for this tenant right now (platform-computed, §9). */
  getBlockedAreas(): string[] {
    return [...(this.currentRecord()?.blockedAreas ?? [])];
  }

  /** Effective pricing for display (the backend never computes money). */
  getEffectivePricing(): TenantRegistryRecord['effectivePricing'] {
    return this.currentRecord()?.effectivePricing;
  }

  getAccessState(now = new Date()): TenantAccessState {
    const record = this.currentRecord();
    if (!record) return this.devWildcard() ? 'full' : 'read_only';
    // TRIAL tenants operate fully, and PAST_DUE tenants get their grace
    // window from the subscription logic below. Anything else (SUSPENDED,
    // CANCELLED, DELETED, PENDING_VERIFICATION, PROVISIONING) is suspended.
    // (Before Phase 7 this checked status !== 'ACTIVE', which suspended
    // every trial tenant and skipped the grace window entirely.)
    if (
      record.status &&
      !OPERATING_TENANT_STATUSES.has(record.status.toUpperCase())
    ) {
      return 'suspended';
    }

    const status = (record.subscriptionStatus || '').toUpperCase();
    if (
      status === 'SUSPENDED' ||
      status === 'CANCELED' ||
      status === 'CANCELLED'
    ) {
      return 'suspended';
    }
    if (status === 'READ_ONLY' || status === 'EXPIRED') return 'read_only';
    if (status === 'PAST_DUE') {
      const until = this.parseDate(record.graceEndsAt ?? record.validUntil);
      return until && now <= until ? 'grace' : 'read_only';
    }
    return 'full';
  }

  isReadOnly(now = new Date()): boolean {
    const state = this.getAccessState(now);
    return state === 'read_only' || state === 'suspended';
  }

  getSnapshot() {
    const context = getTenantContext();
    const record = this.currentRecord();
    return {
      tenantId: context?.tenantId ?? null,
      planName: record?.planName ?? null,
      subscriptionStatus: record?.subscriptionStatus ?? null,
      accessState: this.getAccessState(),
      features: this.getActiveFeatures(),
      limits: this.getLimits(),
      validUntil: record?.validUntil ?? null,
    };
  }

  private currentRecord(): TenantRegistryRecord | undefined {
    const context = getTenantContext();
    if (!context) return undefined;
    return (
      this.registry.list().find((tenant) => tenant.id === context.tenantId) ??
      this.registry.resolveBySlug(context.slug)
    );
  }

  private devWildcard(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
