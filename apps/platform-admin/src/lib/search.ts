/**
 * Global search helpers (console topbar + Cmd/Ctrl+K palette).
 *
 * The backend endpoint is GET /search?q=&type=&status=&limit= — see
 * apps/platform-api/src/search/. These helpers are the frontend half:
 * the type list and per-type status vocabularies (mirrors of the backend
 * enums — keep them in sync when a status is added), recent searches,
 * and link parsing for navigation.
 */

export interface SearchResultItem {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  /** Status label as returned by the backend (e.g. ACTIVE, OPEN). */
  status?: string;
  /** Console link, e.g. /tenants/<id> or /billing?tab=invoices. */
  link: string;
}

export interface SearchGroup {
  type: string;
  label: string;
  items: SearchResultItem[];
}

export interface SearchResponse {
  q: string;
  groups: SearchGroup[];
  total: number;
}

/** Entity types, in the order their filter chips appear in the palette. */
export const SEARCH_TYPES: { type: string; label: string }[] = [
  { type: 'tenant', label: 'Tenants' },
  { type: 'user', label: 'Users' },
  { type: 'plan', label: 'Plans' },
  { type: 'invoice', label: 'Invoices' },
  { type: 'payment', label: 'Payments' },
  { type: 'proof', label: 'Payment proofs' },
  { type: 'subscription', label: 'Subscriptions' },
  { type: 'coupon', label: 'Coupons' },
  { type: 'credit-note', label: 'Credit notes' },
  { type: 'method', label: 'Payment methods' },
  { type: 'job', label: 'Billing jobs' },
  { type: 'lead', label: 'Leads' },
  { type: 'domain', label: 'Domains' },
  { type: 'audit', label: 'Audit entries' },
  { type: 'invite', label: 'Invites' },
  { type: 'landing', label: 'Landing content' },
];

export const SEARCH_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SEARCH_TYPES.map((t) => [t.type, t.label]),
);

/**
 * Status vocabulary per type (mirror of the backend enums; plan/coupon
 * derive ACTIVE/INACTIVE from isActive, jobs derive OK/ERROR/NEVER from
 * their last run). Types absent here have no status filter.
 */
export const TYPE_STATUSES: Record<string, string[]> = {
  tenant: [
    'PENDING_VERIFICATION',
    'PROVISIONING',
    'TRIAL',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
    'CANCELLED',
    'DELETED',
  ],
  user: ['ACTIVE', 'DISABLED'],
  plan: ['ACTIVE', 'INACTIVE'],
  invoice: ['DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'],
  subscription: ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
  proof: ['PENDING', 'APPROVED', 'REJECTED'],
  coupon: ['ACTIVE', 'INACTIVE'],
  job: ['OK', 'ERROR', 'NEVER'],
  lead: ['NEW', 'CONTACTED', 'CLOSED'],
  domain: ['PENDING', 'VERIFIED', 'ACTIVE', 'FAILED', 'DISABLED'],
  invite: ['PENDING', 'USED', 'EXPIRED'],
};

/** Minimum query length the backend accepts. */
export const MIN_SEARCH_LENGTH = 2;

/** Per-type result cap requested from the backend. */
export const SEARCH_LIMIT = 5;

export function buildSearchUrl(
  q: string,
  type?: string,
  status?: string,
  limit: number = SEARCH_LIMIT,
): string {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (type && type !== 'all') params.set('type', type);
  if (status) params.set('status', status);
  return `/search?${params.toString()}`;
}

/** Flatten groups into one list, in display order, for keyboard nav. */
export function flattenGroups(groups: SearchGroup[]): SearchResultItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * Split a console link into TanStack Router parts. Links come from the
 * backend and may carry a query string (/billing?tab=invoices).
 */
export function parseConsoleLink(link: string): {
  to: string;
  search?: Record<string, string>;
} {
  const [to, query] = link.split('?');
  if (!query) return { to };
  const search: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    search[key] = value;
  }
  return { to, search };
}

/* ------------------------------------------------------------------ */
/* Recent searches — localStorage, most-recent-first, capped at 5.     */
/* The store is injectable so tests can pass a fake.                   */
/* ------------------------------------------------------------------ */

export const RECENT_SEARCHES_KEY = 'ecomate.platform.recent-searches';
export const MAX_RECENT_SEARCHES = 5;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStore = (): StorageLike | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function getRecentSearches(store: StorageLike | null = defaultStore()): string[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(RECENT_SEARCHES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function saveRecentSearch(
  query: string,
  store: StorageLike | null = defaultStore(),
): void {
  const q = query.trim();
  if (!q || !store) return;
  const next = [q, ...getRecentSearches(store).filter((item) => item !== q)].slice(
    0,
    MAX_RECENT_SEARCHES,
  );
  try {
    store.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable — recent searches are best-effort.
  }
}

export function clearRecentSearches(
  store: StorageLike | null = defaultStore(),
): void {
  if (!store) return;
  try {
    store.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Best-effort.
  }
}
