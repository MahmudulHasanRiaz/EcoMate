export const LIMIT_KEYS = [
  'products',
  'staff_users',
  'orders_per_month',
  'storage_mb',
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

export const LIMIT_LABELS: Record<LimitKey, string> = {
  products: 'Products',
  staff_users: 'Staff users',
  orders_per_month: 'Orders per month',
  storage_mb: 'Media storage (MB)',
};
