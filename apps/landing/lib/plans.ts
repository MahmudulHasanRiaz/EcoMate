/**
 * Public plan catalogue for the landing page.
 *
 * The landing fetches the live plan list from the platform control plane
 * (`GET /public/plans`, same-origin rewrite) instead of hardcoding prices
 * or trial lengths. The fetch never throws: if the platform API is down,
 * the landing renders without pricing rather than failing the page.
 *
 * Trial-days rule: the public API does not say which plan version is the
 * signup default (that lives server-side — the `isDefault` plan-version
 * flag, the `default_plan_version_id` setting, or the newest version).
 * The landing therefore advertises the trial length of the cheapest
 * trial-bearing public plan — the entry plan a new signup lands on in
 * practice. If no public plan carries a trial, `NEXT_PUBLIC_TRIAL_DAYS`
 * is the fallback; if that is unset too, the copy omits the day count
 * ("Start a free trial") rather than inventing a number.
 */

export interface PublicPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isFree: boolean;
  badge: string | null;
  sortOrder: number;
  price: number | null;
  currency: string;
  interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
  trialDays: number;
  features: string[];
  limits: Record<string, unknown>;
}

function platformApiBase(): string {
  const configured = (
    process.env.PLATFORM_API_URL || 'http://localhost:4100/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

/** Server-side fetch of the public plan list. Never throws. */
export async function fetchPublicPlans(): Promise<PublicPlan[]> {
  try {
    const response = await fetch(`${platformApiBase()}/public/plans`, {
      // Pricing changes are rare; a 5-minute cache keeps the landing fast
      // and keeps a downed API from taking the page down with it.
      // Tagged so the cache purge revalidates it immediately.
      next: { revalidate: 300, tags: ['public-plans'] },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return [];
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];
    return data.filter((p): p is PublicPlan => isPublicPlan(p));
  } catch {
    return [];
  }
}

function isPublicPlan(value: unknown): value is PublicPlan {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.slug === 'string' &&
    typeof p.name === 'string' &&
    typeof p.trialDays === 'number' &&
    Array.isArray(p.features)
  );
}

/**
 * The trial length the landing advertises, in days — or null when no
 * source knows it. See the module docstring for the derivation rule.
 */
export function trialDaysForPlans(
  plans: PublicPlan[],
  envTrialDays?: string,
): number | null {
  const trialPlans = plans
    .filter((p) => p.trialDays > 0)
    .sort((a, b) => {
      const priceA = a.price ?? 0;
      const priceB = b.price ?? 0;
      if (priceA !== priceB) return priceA - priceB;
      return a.sortOrder - b.sortOrder;
    });
  if (trialPlans.length > 0) return trialPlans[0].trialDays;

  const fromEnv = Number(envTrialDays);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return null;
}

/** "Start a 14-day trial" when the length is known, else "Start a free trial". */
export function trialCtaCopy(trialDays: number | null): string {
  return trialDays ? `Start a ${trialDays}-day trial` : 'Start a free trial';
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: '৳',
  USD: '$',
  EUR: '€',
  GBP: '£',
  INR: '₹',
};

function intervalSuffix(interval: PublicPlan['interval']): string {
  if (interval === 'YEARLY') return '/yr';
  if (interval === 'CUSTOM') return '/period';
  return '/mo';
}

/** "Free" for free plans, otherwise e.g. "৳1,500/mo". */
export function formatPlanPrice(plan: PublicPlan): string {
  if (plan.isFree || plan.price === null || plan.price <= 0) return 'Free';
  const symbol = CURRENCY_SYMBOLS[plan.currency] ?? `${plan.currency} `;
  const amount = plan.price.toLocaleString('en-US', {
    maximumFractionDigits: 0,
  });
  return `${symbol}${amount}${intervalSuffix(plan.interval)}`;
}
