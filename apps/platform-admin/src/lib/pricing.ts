import type {
  BillingCycle,
  BlockingArea,
  InvoiceKind,
  OneTimeFeeEffect,
  PricingDocument,
} from '../types';

export const BLOCKING_AREAS: BlockingArea[] = [
  'orders',
  'pos',
  'storefront_checkout',
  'products',
  'admin_writes',
];

export const BLOCKING_AREA_LABELS: Record<BlockingArea, string> = {
  orders: 'Order creation',
  pos: 'POS sales',
  storefront_checkout: 'Storefront checkout',
  products: 'Product writes',
  admin_writes: 'Tenant admin writes',
};

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  SUBSCRIPTION: 'Subscription',
  ONE_TIME: 'One-time',
  METERED: 'Metered',
  MANUAL: 'Manual',
  TOPUP: 'Top-up',
};

export const OVERRIDE_KEYS = ['per_order_rate', 'minimum_monthly'] as const;

export const OVERRIDE_LABELS: Record<string, string> = {
  per_order_rate: 'Per-order rate',
  minimum_monthly: 'Minimum monthly',
};

/** Money with 2 decimals — rates like ৳1.50 need them (formatMoney rounds). */
export function formatMoney2dp(
  value?: string | number | null,
  currency = 'BDT',
): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function cycleSuffix(
  billingCycle?: BillingCycle | null,
  interval?: string | null,
  intervalDays?: number | null,
): string {
  if (billingCycle === 'YEARLY' || interval === 'YEARLY') return '/yr';
  if (billingCycle === 'WEEKLY_7D') return '/7d';
  if (interval === 'CUSTOM') return `/${intervalDays ?? 30}d`;
  return '/mo';
}

/**
 * One-line pricing summary for a version card, e.g.
 * "৳2,000/mo + ৳10/order, min ৳500". Falls back to the flat price when
 * the version has no pricing document (legacy versions).
 */
export function pricingSummary(
  pricing: PricingDocument | null | undefined,
  fallback: { price: string | number; currency: string; interval: string; intervalDays?: number | null },
): string {
  const doc = pricing ?? undefined;
  const baseFee = doc?.baseFee?.amount ?? Number(fallback.price);
  const currency = doc?.baseFee?.currency ?? fallback.currency;
  const suffix = cycleSuffix(
    doc?.billingCycle,
    fallback.interval,
    fallback.intervalDays,
  );
  const parts: string[] = [];
  parts.push(`${formatMoney2dp(baseFee, currency)}${suffix}`);
  const metering = doc?.metering;
  if (metering && metering.ratePerUnit > 0) {
    parts.push(`+ ${formatMoney2dp(metering.ratePerUnit, currency)}/order`);
    if (metering.included > 0) {
      parts.push(`(${metering.included} incl.)`);
    }
    if (metering.minimumMonthly && metering.minimumMonthly > 0) {
      parts.push(`, min ${formatMoney2dp(metering.minimumMonthly, currency)}`);
    }
  }
  if ((doc?.freeMonths ?? 0) > 0) {
    parts.push(`· ${doc?.freeMonths} free month${doc?.freeMonths === 1 ? '' : 's'}`);
  }
  return parts.join(' ').replace(' ,', ',');
}

/** Client-side metered bill for one order count (mirrors the engine §4.2). */
export function meteredBill(
  orders: number,
  ratePerUnit: number,
  minimumMonthly: number | null,
  included = 0,
): number {
  const billable = Math.max(0, orders - included);
  const usage = billable * ratePerUnit;
  const floor = minimumMonthly ?? 0;
  return Math.round(Math.max(usage, floor) * 100) / 100;
}

/**
 * Live example line under the metering fields:
 * "30 orders → ৳500 · 50 → ৳500 · 120 → ৳1,200".
 */
export function meteringExampleLine(
  ratePerUnit: number,
  minimumMonthly: number | null,
  included = 0,
  currency = 'BDT',
): string {
  return [30, 50, 120]
    .map(
      (orders) =>
        `${orders} orders → ${formatMoney2dp(meteredBill(orders, ratePerUnit, minimumMonthly, included), currency)}`,
    )
    .join(' · ');
}

/** Human label for a trace source: plan / override / purchase:<key> / addon:<name>. */
export function traceSourceLabel(source: string | undefined): string {
  if (!source) return '—';
  if (source === 'plan') return 'Plan';
  if (source === 'override') return 'Per-client override';
  if (source.startsWith('purchase:')) return `One-time purchase (${source.slice('purchase:'.length)})`;
  if (source.startsWith('addon:')) return `Add-on (${source.slice('addon:'.length)})`;
  return source;
}

/** One-line summary of a one-time fee effect for lists and pickers. */
export function effectSummary(effect: OneTimeFeeEffect): string {
  switch (effect.type) {
    case 'setup':
      return 'One-time setup fee';
    case 'limit_increase': {
      const parts = Object.entries(effect.limits ?? {}).map(
        ([key, delta]) => `${key} +${delta}`,
      );
      return parts.length > 0 ? `Limit increase: ${parts.join(', ')}` : 'Limit increase';
    }
    case 'rate_tier':
      return `Per-order rate → ${formatMoney2dp(effect.perOrderRate)}/order`;
    case 'feature_unlock':
      return `Unlocks ${(effect.features ?? []).join(', ') || 'features'}`;
    default:
      return 'One-time fee';
  }
}

/**
 * Lenient read of a stored pricing document — the API returns the raw
 * Json column, so tolerate missing/legacy shapes instead of crashing.
 */
export function parsePricingDocument(
  value: unknown,
): PricingDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const doc = value as Partial<PricingDocument>;
  return {
    pricingVersion: 1,
    ...(doc.baseFee && typeof doc.baseFee === 'object'
      ? { baseFee: doc.baseFee }
      : {}),
    ...(typeof doc.billingCycle === 'string'
      ? { billingCycle: doc.billingCycle as BillingCycle }
      : {}),
    ...(typeof doc.freeMonths === 'number'
      ? { freeMonths: doc.freeMonths }
      : {}),
    ...(doc.metering && typeof doc.metering === 'object'
      ? { metering: doc.metering }
      : {}),
    ...(Array.isArray(doc.oneTimeFees) ? { oneTimeFees: doc.oneTimeFees } : {}),
    ...(doc.overLimit && typeof doc.overLimit === 'object'
      ? { overLimit: doc.overLimit }
      : {}),
    ...(doc.blocking && typeof doc.blocking === 'object'
      ? { blocking: doc.blocking }
      : {}),
  };
}
