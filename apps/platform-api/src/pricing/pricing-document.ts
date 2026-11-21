/**
 * The pricing document — PlanVersion.pricing (design §3).
 *
 * A version is a set of OPTIONAL components (base fee, metering, one-time
 * fees, free months) — composition, not an enum. Any combination is a plan.
 * This file is the pure layer: types, strict write-time validation (unknown
 * keys rejected, so a typo'd metric key can never silently do nothing) and
 * lenient read-time parsing (a stored doc is trusted but normalised, so a
 * missing optional field never crashes a billing job).
 *
 * Money stays Decimal(12,2) in the DB; rates Decimal(12,4). In the JSON
 * document both are plain numbers.
 */
import { LIMIT_KEYS, isLimitKey } from '@ecomate/shared-types';
import { findUnknownFeatureKeys } from '../features/feature-keys';

/** Billing cycles. WEEKLY_7D maps to BillingInterval.CUSTOM + intervalDays 7. */
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY', 'WEEKLY_7D'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/**
 * Meter keys the engine can bill in v1. The backend /internal/usage
 * endpoint reports every LIMIT_KEY, but only orders_per_month has a
 * period-window counter — the other keys are point-in-time counts, not
 * period usage. Future meter keys (Unified Inbox conversations_per_month,
 * messages_per_month) are added here once their counters exist (§3.3).
 */
export const METER_KEYS = ['orders_per_month'] as const;
export type MeterKey = (typeof METER_KEYS)[number];

export function isMeterKey(value: unknown): value is MeterKey {
  return value === 'orders_per_month';
}

/** Per-client override keys (closed set, design §5). */
export const OVERRIDE_KEYS = ['per_order_rate', 'minimum_monthly'] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number];

export function isOverrideKey(value: unknown): value is OverrideKey {
  return value === 'per_order_rate' || value === 'minimum_monthly';
}

/** Strict-blocking area keys (closed set, design §9.1). */
export const BLOCKING_AREAS = [
  'orders',
  'pos',
  'storefront_checkout',
  'products',
  'admin_writes',
] as const;
export type BlockingArea = (typeof BLOCKING_AREAS)[number];

export function isBlockingArea(value: unknown): value is BlockingArea {
  return (BLOCKING_AREAS as readonly string[]).includes(String(value));
}

export const BLOCKING_MODES = ['grace_then_block', 'block_immediately'] as const;
export type BlockingMode = (typeof BLOCKING_MODES)[number];

export function isBlockingMode(value: unknown): value is BlockingMode {
  return value === 'grace_then_block' || value === 'block_immediately';
}

export type OneTimeFeeEffect =
  | { type: 'setup' }
  | { type: 'limit_increase'; limits: Record<string, number> }
  | { type: 'rate_tier'; perOrderRate: number }
  | { type: 'feature_unlock'; features: string[] };

export interface OneTimeFee {
  key: string;
  label: string;
  amount: number;
  effect: OneTimeFeeEffect;
}

export interface MeteringConfig {
  metric: MeterKey;
  /** Units included in the base fee (per period; never rolls over). */
  included: number;
  /** BDT per unit above `included`. */
  ratePerUnit: number;
  /** BDT floor for the metered part; null/0 = no floor. */
  minimumMonthly: number | null;
}

export interface BlockingConfig {
  mode: BlockingMode;
  blockedAreas: BlockingArea[];
}

export interface PricingDocument {
  pricingVersion: 1;
  baseFee?: { amount: number; currency: string };
  billingCycle?: BillingCycle;
  /** First N billing periods after trial invoiced at ৳0. 0 = none. */
  freeMonths?: number;
  metering?: MeteringConfig;
  oneTimeFees?: OneTimeFee[];
  /** Per-metric over-limit behaviour; absent = 'block' (current behaviour). */
  overLimit?: Record<string, 'block' | 'charge'>;
  blocking?: BlockingConfig;
}

/** The empty document: a legacy version before the backfill ran. */
export const EMPTY_PRICING: PricingDocument = { pricingVersion: 1 };

const TOP_LEVEL_KEYS = new Set([
  'pricingVersion',
  'baseFee',
  'billingCycle',
  'freeMonths',
  'metering',
  'oneTimeFees',
  'overLimit',
  'blocking',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Own keys that actually carry a value. class-transformer materializes
 * every declared-but-absent optional DTO field as an `undefined` own
 * property (e.g. a limit_increase effect arrives with perOrderRate and
 * features present-but-undefined), so the strict whitelist must ignore
 * undefined-valued keys — an undefined key is semantically absent (JSON
 * drops it on serialization) and must never read as a typo.
 */
function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value > 0
  );
}

/**
 * Strict write-time validation. Returns the list of problems (empty =
 * valid). Unknown keys are rejected at every level — a typo must fail the
 * write, never silently do nothing.
 */
export function validatePricingDocument(value: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return ['pricing must be an object'];
  }
  for (const key of definedKeys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`pricing: unknown key "${key}"`);
  }
  if (value.pricingVersion !== undefined && value.pricingVersion !== 1) {
    errors.push('pricing.pricingVersion must be 1');
  }

  if (value.baseFee !== undefined) {
    if (!isPlainObject(value.baseFee)) {
      errors.push('pricing.baseFee must be an object');
    } else {
      for (const key of definedKeys(value.baseFee)) {
        if (key !== 'amount' && key !== 'currency') {
          errors.push(`pricing.baseFee: unknown key "${key}"`);
        }
      }
      if (!isNonNegativeNumber(value.baseFee.amount)) {
        errors.push('pricing.baseFee.amount must be a non-negative number');
      }
      if (
        value.baseFee.currency !== undefined &&
        (typeof value.baseFee.currency !== 'string' ||
          value.baseFee.currency.length === 0)
      ) {
        errors.push('pricing.baseFee.currency must be a non-empty string');
      }
    }
  }

  if (
    value.billingCycle !== undefined &&
    !(BILLING_CYCLES as readonly string[]).includes(String(value.billingCycle))
  ) {
    errors.push(
      `pricing.billingCycle must be one of ${BILLING_CYCLES.join(', ')}`,
    );
  }

  if (
    value.freeMonths !== undefined &&
    (!Number.isInteger(value.freeMonths) ||
      (value.freeMonths as number) < 0 ||
      (value.freeMonths as number) > 120)
  ) {
    errors.push('pricing.freeMonths must be an integer between 0 and 120');
  }

  if (value.metering !== undefined) {
    if (!isPlainObject(value.metering)) {
      errors.push('pricing.metering must be an object');
    } else {
      for (const key of definedKeys(value.metering)) {
        if (!['metric', 'included', 'ratePerUnit', 'minimumMonthly'].includes(key)) {
          errors.push(`pricing.metering: unknown key "${key}"`);
        }
      }
      if (!isMeterKey(value.metering.metric)) {
        errors.push(
          `pricing.metering.metric must be one of ${METER_KEYS.join(', ')}`,
        );
      }
      if (
        value.metering.included !== undefined &&
        (!Number.isInteger(value.metering.included) ||
          (value.metering.included as number) < 0)
      ) {
        errors.push('pricing.metering.included must be a non-negative integer');
      }
      if (!isNonNegativeNumber(value.metering.ratePerUnit)) {
        errors.push('pricing.metering.ratePerUnit must be a non-negative number');
      }
      if (
        value.metering.minimumMonthly !== undefined &&
        value.metering.minimumMonthly !== null &&
        !isNonNegativeNumber(value.metering.minimumMonthly)
      ) {
        errors.push(
          'pricing.metering.minimumMonthly must be a non-negative number or null',
        );
      }
    }
  }

  if (value.oneTimeFees !== undefined) {
    if (!Array.isArray(value.oneTimeFees)) {
      errors.push('pricing.oneTimeFees must be an array');
    } else {
      const seen = new Set<string>();
      value.oneTimeFees.forEach((fee, index) => {
        const at = `pricing.oneTimeFees[${index}]`;
        if (!isPlainObject(fee)) {
          errors.push(`${at} must be an object`);
          return;
        }
        for (const key of definedKeys(fee)) {
          if (!['key', 'label', 'amount', 'effect'].includes(key)) {
            errors.push(`${at}: unknown key "${key}"`);
          }
        }
        if (typeof fee.key !== 'string' || fee.key.length === 0) {
          errors.push(`${at}.key must be a non-empty string`);
        } else if (seen.has(fee.key)) {
          errors.push(`${at}.key "${fee.key}" is duplicated`);
        } else {
          seen.add(fee.key);
        }
        if (typeof fee.label !== 'string' || fee.label.trim().length === 0) {
          errors.push(`${at}.label must be a non-empty string`);
        }
        if (!isNonNegativeNumber(fee.amount)) {
          errors.push(`${at}.amount must be a non-negative number`);
        }
        errors.push(...validateOneTimeFeeEffect(fee.effect, `${at}.effect`));
      });
    }
  }

  if (value.overLimit !== undefined) {
    if (!isPlainObject(value.overLimit)) {
      errors.push('pricing.overLimit must be an object');
    } else {
      for (const [key, behaviour] of Object.entries(value.overLimit)) {
        if (!isLimitKey(key)) {
          errors.push(
            `pricing.overLimit: unknown metric "${key}" (known: ${LIMIT_KEYS.join(', ')})`,
          );
        }
        if (behaviour !== 'block' && behaviour !== 'charge') {
          errors.push(
            `pricing.overLimit.${key} must be "block" or "charge"`,
          );
        }
      }
    }
  }

  if (value.blocking !== undefined) {
    if (!isPlainObject(value.blocking)) {
      errors.push('pricing.blocking must be an object');
    } else {
      for (const key of definedKeys(value.blocking)) {
        if (key !== 'mode' && key !== 'blockedAreas') {
          errors.push(`pricing.blocking: unknown key "${key}"`);
        }
      }
      if (
        value.blocking.mode !== undefined &&
        !isBlockingMode(value.blocking.mode)
      ) {
        errors.push(
          `pricing.blocking.mode must be one of ${BLOCKING_MODES.join(', ')}`,
        );
      }
      if (value.blocking.blockedAreas !== undefined) {
        if (!Array.isArray(value.blocking.blockedAreas)) {
          errors.push('pricing.blocking.blockedAreas must be an array');
        } else {
          for (const area of value.blocking.blockedAreas) {
            if (!isBlockingArea(area)) {
              errors.push(
                `pricing.blocking.blockedAreas: unknown area "${String(area)}"`,
              );
            }
          }
        }
      }
    }
  }

  return errors;
}

/** Validate a one-time fee effect object (shared by the doc + custom fees). */
export function validateOneTimeFeeEffect(
  effect: unknown,
  at = 'effect',
): string[] {
  const errors: string[] = [];
  if (!isPlainObject(effect)) {
    return [`${at} must be an object`];
  }
  switch (effect.type) {
    case 'setup':
      for (const key of definedKeys(effect)) {
        if (key !== 'type') errors.push(`${at}: unknown key "${key}"`);
      }
      break;
    case 'limit_increase': {
      for (const key of definedKeys(effect)) {
        if (key !== 'type' && key !== 'limits') {
          errors.push(`${at}: unknown key "${key}"`);
        }
      }
      if (!isPlainObject(effect.limits) || Object.keys(effect.limits).length === 0) {
        errors.push(`${at}.limits must be a non-empty object`);
      } else {
        for (const [key, delta] of Object.entries(effect.limits)) {
          if (!isLimitKey(key)) {
            errors.push(`${at}.limits: unknown limit key "${key}"`);
          }
          if (!isPositiveInteger(delta)) {
            errors.push(`${at}.limits.${key} must be a positive integer`);
          }
        }
      }
      break;
    }
    case 'rate_tier': {
      for (const key of definedKeys(effect)) {
        if (key !== 'type' && key !== 'perOrderRate') {
          errors.push(`${at}: unknown key "${key}"`);
        }
      }
      if (!isNonNegativeNumber(effect.perOrderRate)) {
        errors.push(`${at}.perOrderRate must be a non-negative number`);
      }
      break;
    }
    case 'feature_unlock': {
      for (const key of definedKeys(effect)) {
        if (key !== 'type' && key !== 'features') {
          errors.push(`${at}: unknown key "${key}"`);
        }
      }
      if (
        !Array.isArray(effect.features) ||
        effect.features.length === 0 ||
        effect.features.some(
          (feature) => typeof feature !== 'string' || feature.length === 0,
        )
      ) {
        errors.push(`${at}.features must be a non-empty array of strings`);
      } else {
        // Gap 11: a typo'd unlock key would bill the tenant for a feature
        // that gates nothing. Keys must exist in the catalogue ('*' is the
        // documented platform wildcard — see feature-keys.ts).
        const unknown = findUnknownFeatureKeys(effect.features);
        if (unknown.length > 0) {
          errors.push(
            `${at}.features contains unknown feature key(s): ${unknown.join(', ')}`,
          );
        }
      }
      break;
    }
    default:
      errors.push(
        `${at}.type must be one of setup, limit_increase, rate_tier, feature_unlock`,
      );
  }
  return errors;
}

/**
 * Lenient read-time parse. Never throws: a stored doc was validated at
 * write time, and a billing job must not crash on a missing optional
 * field — it normalises to defaults instead. Unknown keys are dropped
 * (they were rejected at write time; anything here predates validation).
 */
export function parsePricingDocument(value: unknown): PricingDocument {
  if (!isPlainObject(value)) return { ...EMPTY_PRICING };
  const doc: PricingDocument = { pricingVersion: 1 };

  if (isPlainObject(value.baseFee)) {
    const amount = value.baseFee.amount;
    doc.baseFee = {
      amount: isNonNegativeNumber(amount) ? amount : 0,
      currency:
        typeof value.baseFee.currency === 'string' &&
        value.baseFee.currency.length > 0
          ? value.baseFee.currency
          : 'BDT',
    };
  }
  if (
    typeof value.billingCycle === 'string' &&
    (BILLING_CYCLES as readonly string[]).includes(value.billingCycle)
  ) {
    doc.billingCycle = value.billingCycle as BillingCycle;
  }
  if (
    typeof value.freeMonths === 'number' &&
    Number.isInteger(value.freeMonths) &&
    value.freeMonths > 0
  ) {
    doc.freeMonths = value.freeMonths;
  }
  if (isPlainObject(value.metering)) {
    const metering = value.metering;
    doc.metering = {
      // Kept verbatim (even an unknown metric): the engine rejects an
      // unknown meter at compute time, fail-closed, instead of the
      // parser silently dropping a billable component.
      metric: String(metering.metric) as MeterKey,
      included:
        typeof metering.included === 'number' &&
        Number.isInteger(metering.included) &&
        metering.included >= 0
          ? metering.included
          : 0,
      ratePerUnit: isNonNegativeNumber(metering.ratePerUnit)
        ? metering.ratePerUnit
        : 0,
      minimumMonthly:
        metering.minimumMonthly === null ||
        metering.minimumMonthly === undefined
          ? null
          : isNonNegativeNumber(metering.minimumMonthly)
            ? metering.minimumMonthly
            : null,
    };
  }
  if (Array.isArray(value.oneTimeFees)) {
    doc.oneTimeFees = value.oneTimeFees.filter(
      (fee): fee is OneTimeFee =>
        isPlainObject(fee) &&
        typeof fee.key === 'string' &&
        typeof fee.label === 'string' &&
        isNonNegativeNumber(fee.amount) &&
        isPlainObject(fee.effect),
    );
  }
  if (isPlainObject(value.overLimit)) {
    const overLimit: Record<string, 'block' | 'charge'> = {};
    for (const [key, behaviour] of Object.entries(value.overLimit)) {
      if (behaviour === 'block' || behaviour === 'charge') {
        overLimit[key] = behaviour;
      }
    }
    if (Object.keys(overLimit).length > 0) doc.overLimit = overLimit;
  }
  if (isPlainObject(value.blocking)) {
    const blocking = value.blocking;
    doc.blocking = {
      mode: isBlockingMode(blocking.mode) ? blocking.mode : 'grace_then_block',
      blockedAreas: Array.isArray(blocking.blockedAreas)
        ? blocking.blockedAreas.filter(isBlockingArea)
        : [],
    };
  }
  return doc;
}

/**
 * Resolve a version's pricing document for BILLING. The backfill sets
 * pricing.baseFee from the price column, but a version written between
 * migrate and deploy (old code, no pricing write) still holds `{}` —
 * billing that at ৳0 would be a silent revenue loss. So an absent
 * baseFee falls back to the price column. A present baseFee always wins
 * (PlansService keeps the two in sync on write).
 */
export function resolveVersionPricing(version: {
  price?: unknown;
  currency?: string | null;
  pricing?: unknown;
}): PricingDocument {
  const doc = parsePricingDocument(version.pricing);
  if (doc.baseFee === undefined) {
    const price = Number(version.price ?? 0);
    doc.baseFee = {
      amount: Number.isFinite(price) && price >= 0 ? price : 0,
      currency:
        typeof version.currency === 'string' && version.currency.length > 0
          ? version.currency
          : 'BDT',
    };
  }
  return doc;
}

/** Map a billing cycle to the PlanVersion interval columns. */
export function billingCycleToInterval(cycle: BillingCycle): {
  interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
  intervalDays: number | null;
} {
  if (cycle === 'WEEKLY_7D') return { interval: 'CUSTOM', intervalDays: 7 };
  if (cycle === 'YEARLY') return { interval: 'YEARLY', intervalDays: null };
  return { interval: 'MONTHLY', intervalDays: null };
}

/** Map the PlanVersion interval columns back to a billing cycle. */
export function intervalToBillingCycle(
  interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM',
  intervalDays?: number | null,
): BillingCycle {
  if (interval === 'YEARLY') return 'YEARLY';
  if (interval === 'CUSTOM' && intervalDays === 7) return 'WEEKLY_7D';
  return 'MONTHLY';
}

/**
 * Renewal lead in days (design §4.3): 3 days for month-or-longer cycles,
 * 1 day for short cycles. MONTHLY/YEARLY are calendar intervals (≥28
 * days by definition); CUSTOM derives from intervalDays.
 */
export function renewalLeadDays(
  interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM',
  intervalDays?: number | null,
): number {
  if (interval !== 'CUSTOM') return 3;
  return (intervalDays ?? 30) >= 28 ? 3 : 1;
}

/**
 * Build the stored pricing document for a plan create / add-version
 * write. `input` is the operator-supplied doc (already validated);
 * `fallback` fills baseFee + cycle from the version's price/interval
 * columns when the doc omits them, so `price` and
 * `pricing.baseFee.amount` can never drift: PlansService derives the
 * column from the document.
 */
export function buildPricingDocument(
  input: PricingDocument | undefined,
  fallback: {
    price: number;
    currency: string;
    interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
    intervalDays?: number | null;
  },
): PricingDocument {
  const doc: PricingDocument = { pricingVersion: 1 };
  doc.baseFee = {
    amount: input?.baseFee?.amount ?? fallback.price,
    currency: input?.baseFee?.currency ?? fallback.currency,
  };
  doc.billingCycle =
    input?.billingCycle ??
    intervalToBillingCycle(fallback.interval, fallback.intervalDays);
  if (input?.freeMonths) doc.freeMonths = input.freeMonths;
  if (input?.metering) doc.metering = input.metering;
  if (input?.oneTimeFees?.length) doc.oneTimeFees = input.oneTimeFees;
  if (input?.overLimit && Object.keys(input.overLimit).length > 0) {
    doc.overLimit = input.overLimit;
  }
  if (input?.blocking) doc.blocking = input.blocking;
  return doc;
}
