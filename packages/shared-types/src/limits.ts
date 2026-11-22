/**
 * Limit catalogue shared by the platform control plane and the tenant runtime.
 *
 * A key that is absent from a plan (or is not a finite non-negative number)
 * means "unlimited" — a typo can never lock a tenant out. Platform limit
 * overrides use the same keys and semantics.
 */
export const LIMIT_KEYS = [
  'products',
  'staff_users',
  'orders_per_month',
  'storage_mb',
  // Connected external stores (WooCommerce / Shopify / custom bridge),
  // excluding the per-tenant NATIVE row and DISCONNECTED stores (Phase 9).
  'external_stores',
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

export const LIMIT_LABELS: Record<LimitKey, string> = {
  products: 'Products',
  staff_users: 'Staff users',
  orders_per_month: 'Orders per month',
  storage_mb: 'Media storage (MB)',
  external_stores: 'External stores',
};

const LIMIT_KEY_SET = new Set<string>(LIMIT_KEYS);

export function isLimitKey(value: string): value is LimitKey {
  return LIMIT_KEY_SET.has(value);
}

/**
 * Normalises a configured limit. Only finite non-negative numbers are limits;
 * everything else is unlimited (`null`), matching the enforced runtime rule.
 */
export function coerceLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}
