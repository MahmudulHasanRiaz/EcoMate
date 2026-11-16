import {
  LIMIT_KEYS,
  LIMIT_LABELS,
  LimitKey,
  coerceLimit,
  isLimitKey,
} from '@ecomate/shared-types';

export interface LimitOverrideLike {
  key: string;
  value: number;
  note?: string | null;
}

export interface EffectiveLimitRow {
  key: LimitKey;
  label: string;
  /** Value declared by the plan version (null = unlimited). */
  planLimit: number | null;
  /** Tenant-specific override (null = none). */
  override: number | null;
  /** Effective value enforced by the tenant runtime. */
  limit: number | null;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * Overrides win over the plan, including when the plan does not define the key.
 * Unknown plan keys are preserved so future limit keys keep flowing to the
 * tenant runtime untouched.
 */
export function mergePlanLimitsWithOverrides(
  planLimits: unknown,
  overrides: LimitOverrideLike[],
): Record<string, unknown> {
  const merged = plainObject(planLimits);
  for (const override of overrides) {
    if (!override || !isLimitKey(override.key)) continue;
    const value = coerceLimit(override.value);
    if (value === null) continue;
    merged[override.key] = value;
  }
  return merged;
}

export function describeLimits(
  planLimits: unknown,
  overrides: LimitOverrideLike[],
): EffectiveLimitRow[] {
  const merged = mergePlanLimitsWithOverrides(planLimits, overrides);
  const plan = plainObject(planLimits);
  const overrideMap = new Map<string, number>();
  for (const override of overrides) {
    if (!override || !isLimitKey(override.key)) continue;
    const value = coerceLimit(override.value);
    if (value !== null) overrideMap.set(override.key, value);
  }

  return LIMIT_KEYS.map((key) => {
    const planLimit = coerceLimit(plan[key]);
    const override = overrideMap.get(key) ?? null;
    return {
      key,
      label: LIMIT_LABELS[key],
      planLimit,
      override,
      limit: override ?? planLimit ?? coerceLimit(merged[key]),
    };
  });
}

/**
 * Percent of the effective limit consumed. Over-limit values intentionally go
 * above 100 so the console can flag them; the bar itself clamps its width.
 */
export function usagePercent(
  used: number | null | undefined,
  limit: number | null | undefined,
): number | null {
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return null;
  if (limit === 0) return used > 0 ? 100 : 0;
  return Math.round((used / limit) * 100);
}

const DHAKA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day (YYYY-MM-DD) in the tenant's operating timezone. */
export function formatDhakaDate(date: Date): string {
  return DHAKA_DATE.format(date);
}

/** UTC midnight for a Dhaka calendar day, matching Prisma's `@db.Date`. */
export function dhakaDateOnly(date: Date): Date {
  return new Date(`${formatDhakaDate(date)}T00:00:00.000Z`);
}
