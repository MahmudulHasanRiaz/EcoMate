import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDhakaMonth } from '../common/utils/dhaka-time';
import { TenantEntitlementsService } from '../tenancy/tenant-entitlements.service';
import {
  LIMIT_KEYS,
  LIMIT_LABELS,
  LimitKey,
  coerceLimit,
} from './limit-keys';

export interface LimitUsageRow {
  key: LimitKey;
  label: string;
  /** null = the plan does not define this limit (unlimited). */
  limit: number | null;
  used: number;
  percent: number | null;
  warning: boolean;
}

export interface UsageSnapshot {
  planName: string | null;
  accessState: string;
  limits: LimitUsageRow[];
}

/**
 * Optional period window for the period counters (orders_per_month).
 * Point-in-time counters (products, staff, storage) ignore it.
 */
export interface UsageWindow {
  from: Date;
  to: Date;
}

const BYTES_PER_MB = 1024 * 1024;

/**
 * Enforces the numeric limits attached to a tenant's plan.
 *
 * Default behaviour when a key is absent from `plan.limits`: the counter is
 * shown as "unlimited" and nothing is blocked. Limits are only enforced when
 * the plan version explicitly defines a finite, non-negative number — an
 * accidental typo can therefore never lock a tenant out of a feature the plan
 * does not mention.
 */
@Injectable()
export class TenantLimitsService {
  constructor(
    private readonly entitlements: TenantEntitlementsService,
    private readonly prisma: PrismaService,
  ) {}

  getLimit(key: string): number | null {
    return coerceLimit(this.entitlements.getLimits()[key]);
  }

  async getUsage(key: LimitKey, window?: UsageWindow): Promise<number> {
    switch (key) {
      case 'products': {
        // Drafts do not consume the published-product quota; publishing checks
        // the limit separately.
        return this.prisma.product.count({
          where: { status: { not: 'draft' } },
        });
      }
      case 'staff_users': {
        return this.prisma.userProfile.count({
          where: { role: { not: 'customer' } },
        });
      }
      case 'orders_per_month': {
        // With a window, count orders created in [from, to) — the billing
        // engine's subscription period. Without one, the Dhaka calendar
        // month (the console usage view). Non-trashed only, as always.
        if (window) {
          return this.prisma.order.count({
            where: {
              trashedAt: null,
              createdAt: { gte: window.from, lt: window.to },
            },
          });
        }
        return this.prisma.order.count({
          where: {
            trashedAt: null,
            createdAt: { gte: startOfDhakaMonth() },
          },
        });
      }
      case 'storage_mb': {
        const aggregate = await this.prisma.media.aggregate({
          _sum: { size: true },
        });
        const bytes = aggregate._sum.size ?? 0;
        return Math.ceil(bytes / BYTES_PER_MB);
      }
      case 'external_stores': {
        // Phase 9 §5.2: non-NATIVE stores in connectable states. DISCONNECTED
        // frees the slot; the NATIVE row never counts.
        return this.prisma.store.count({
          where: { kind: { not: 'NATIVE' }, status: { not: 'DISCONNECTED' } },
        });
      }
      default:
        return 0;
    }
  }

  async assertWithinLimit(key: LimitKey, amount = 1): Promise<void> {
    const limit = this.getLimit(key);
    if (limit === null) return;

    const used = await this.getUsage(key);
    const wouldExceed = amount <= 0 ? used >= limit : used + amount > limit;
    if (!wouldExceed) return;

    const label = LIMIT_LABELS[key] ?? key;
    throw new ForbiddenException(
      `Plan limit reached for ${label} (${used}/${limit}). Upgrade your plan to continue.`,
    );
  }

  async getUsageSnapshot(window?: UsageWindow): Promise<UsageSnapshot> {
    const rows = await Promise.all(
      LIMIT_KEYS.map(async (key): Promise<LimitUsageRow> => {
        const limit = this.getLimit(key);
        const used = await this.getUsage(key, window);
        const percent =
          limit === null
            ? null
            : limit === 0
              ? used > 0
                ? 100
                : 0
              : Math.min(100, Math.round((used / limit) * 100));
        return {
          key,
          label: LIMIT_LABELS[key],
          limit,
          used,
          percent,
          warning: percent !== null && percent >= 80,
        };
      }),
    );

    return {
      planName: this.entitlements.getPlanName(),
      accessState: this.entitlements.getAccessState(),
      limits: rows,
    };
  }
}
