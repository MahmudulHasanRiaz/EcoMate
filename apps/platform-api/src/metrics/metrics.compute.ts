/**
 * Pure helpers behind the platform metrics dashboard.
 *
 * Every number the console shows is derived here from stored platform rows —
 * nothing is estimated. Money is handled in integer cents so a MRR sum never
 * drifts on floating point.
 */

export interface SubscriptionLike {
  id: string;
  tenantId: string;
  tenantName?: string | null;
  planName?: string | null;
  /** Plan version number, used to attribute revenue to a plan revision. */
  planVersionNumber?: number | null;
  status: string;
  /** Tenant lifecycle status — the operator-facing truth for the tenant. */
  tenantStatus?: string | null;
  /** A number, or a Prisma Decimal that stringifies to one. */
  price: unknown;
  currency: string;
  interval: string;
  intervalDays?: number | null;
  startedAt: Date;
  trialEndsAt?: Date | null;
  endedAt?: Date | null;
  canceledAt?: Date | null;
}

export interface RevenueRow {
  currency: string;
  mrr: number;
  arr: number;
  subscriptions: number;
  atRiskMrr: number;
}

export interface ChurnTenant {
  tenantId: string;
  tenantName: string;
  planName: string | null;
  endedAt: string;
  cause: 'ended' | 'canceled';
}

export interface ChurnStats {
  churned: number;
  base: number;
  /** Percent of the window-start base that churned; null when the base is 0. */
  rate: number | null;
  tenants: ChurnTenant[];
}

export interface TrialStats {
  active: number;
  endingSoon: number;
  expired: number;
}

const DAY_MS = 86_400_000;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Converts a stored price into integer cents.
 *
 * The database hands back a Prisma Decimal (an object with its own toString),
 * so anything that is not already a number is coerced through its string form
 * instead of being silently treated as free.
 */
function toCents(price: unknown): number {
  if (price === null || price === undefined) return 0;
  const value = typeof price === 'number' ? price : Number(String(price));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

/**
 * Monthly equivalent of a plan price, in cents.
 *
 * MONTHLY keeps the price, YEARLY is divided by twelve and a custom interval
 * is normalised to 30 days. A custom interval without a day count falls back
 * to the monthly value rather than inventing a rate.
 */
export function monthlyEquivalentCents(
  price: unknown,
  interval: string,
  intervalDays?: number | null,
): number {
  const cents = toCents(price);
  if (cents === 0) return 0;

  switch (interval) {
    case 'YEARLY':
      return Math.round(cents / 12);
    case 'CUSTOM': {
      const days = Number(intervalDays);
      if (!Number.isFinite(days) || days <= 0) return cents;
      return Math.round((cents * 30) / days);
    }
    default:
      return cents;
  }
}

function endDateOf(subscription: SubscriptionLike): Date | null {
  return subscription.endedAt ?? subscription.canceledAt ?? null;
}

/**
 * Revenue state of one subscription.
 *
 * A terminal subscription (cancelled, expired, suspended) never produces
 * revenue. Otherwise the tenant lifecycle status is honoured: an operator who
 * activated a tenant has revenue even while the subscription row still says
 * trial, and a past-due tenant is at risk instead of earning.
 */
export function revenueState(subscription: SubscriptionLike): {
  state: 'paying' | 'at-risk' | 'none';
  source: 'subscription' | 'tenant' | null;
} {
  if (
    subscription.status === 'CANCELLED' ||
    subscription.status === 'EXPIRED' ||
    subscription.status === 'SUSPENDED'
  ) {
    return { state: 'none', source: null };
  }
  if (subscription.status === 'ACTIVE') {
    return { state: 'paying', source: 'subscription' };
  }
  if (subscription.tenantStatus === 'ACTIVE') {
    return { state: 'paying', source: 'tenant' };
  }
  if (subscription.status === 'PAST_DUE') {
    return { state: 'at-risk', source: 'subscription' };
  }
  if (subscription.tenantStatus === 'PAST_DUE') {
    return { state: 'at-risk', source: 'tenant' };
  }
  return { state: 'none', source: null };
}

/**
 * Recurring revenue per currency.
 *
 * Only paying subscriptions produce MRR; at-risk subscriptions are reported
 * separately instead of being counted as earned. Trial, suspended, cancelled
 * and expired subscriptions never produce revenue.
 */
export function buildRevenue(subscriptions: SubscriptionLike[]): {
  byCurrency: RevenueRow[];
  paying: number;
  atRisk: number;
  basis: {
    payingFromSubscription: number;
    payingFromTenant: number;
    atRiskFromSubscription: number;
    atRiskFromTenant: number;
  };
} {
  const rows = new Map<string, RevenueRow>();
  let paying = 0;
  let atRisk = 0;
  const basis = {
    payingFromSubscription: 0,
    payingFromTenant: 0,
    atRiskFromSubscription: 0,
    atRiskFromTenant: 0,
  };

  for (const subscription of subscriptions) {
    const { state, source } = revenueState(subscription);
    if (state === 'none') continue;

    const currency = subscription.currency || 'BDT';
    const cents = monthlyEquivalentCents(
      subscription.price,
      subscription.interval,
      subscription.intervalDays,
    );

    const row =
      rows.get(currency) ??
      ({
        currency,
        mrr: 0,
        arr: 0,
        subscriptions: 0,
        atRiskMrr: 0,
      } as RevenueRow);

    if (state === 'paying') {
      paying += 1;
      row.subscriptions += 1;
      row.mrr += cents;
      if (source === 'subscription') basis.payingFromSubscription += 1;
      else basis.payingFromTenant += 1;
    } else {
      atRisk += 1;
      row.atRiskMrr += cents;
      if (source === 'subscription') basis.atRiskFromSubscription += 1;
      else basis.atRiskFromTenant += 1;
    }

    rows.set(currency, row);
  }

  const byCurrency = [...rows.values()]
    .map((row) => ({
      currency: row.currency,
      mrr: roundMoney(row.mrr / 100),
      arr: roundMoney((row.mrr * 12) / 100),
      subscriptions: row.subscriptions,
      atRiskMrr: roundMoney(row.atRiskMrr / 100),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return { byCurrency, paying, atRisk, basis };
}

export function statusCounts(subscriptions: SubscriptionLike[]): {
  ACTIVE: number;
  TRIAL: number;
  PAST_DUE: number;
  SUSPENDED: number;
  CANCELLED: number;
  EXPIRED: number;
} {
  const counts = {
    ACTIVE: 0,
    TRIAL: 0,
    PAST_DUE: 0,
    SUSPENDED: 0,
    CANCELLED: 0,
    EXPIRED: 0,
  } as Record<string, number>;

  for (const subscription of subscriptions) {
    const key = subscription.status;
    if (key in counts) counts[key] += 1;
  }

  return counts as {
    ACTIVE: number;
    TRIAL: number;
    PAST_DUE: number;
    SUSPENDED: number;
    CANCELLED: number;
    EXPIRED: number;
  };
}

/**
 * Trial health: how many trials run, how many end inside the soon-window and
 * how many already ended without converting (the actionable leak).
 */
export function trialStats(
  subscriptions: SubscriptionLike[],
  now: Date,
  soonDays: number,
): TrialStats {
  const soonLimit = now.getTime() + soonDays * DAY_MS;
  let active = 0;
  let endingSoon = 0;
  let expired = 0;

  for (const subscription of subscriptions) {
    if (subscription.status !== 'TRIAL') continue;
    active += 1;

    const endsAt = subscription.trialEndsAt
      ? new Date(subscription.trialEndsAt).getTime()
      : null;
    if (endsAt === null) continue;
    if (endsAt < now.getTime()) expired += 1;
    else if (endsAt <= soonLimit) endingSoon += 1;
  }

  return { active, endingSoon, expired };
}

/**
 * Churn inside a window.
 *
 * The rate is relative to the subscriptions that were live at window start;
 * when nothing was live the rate is null instead of a misleading zero.
 */
export function churnStats(
  subscriptions: SubscriptionLike[],
  windowStart: Date,
  windowEnd: Date,
): ChurnStats {
  const start = windowStart.getTime();
  const end = windowEnd.getTime();
  const churned: ChurnTenant[] = [];
  let base = 0;

  for (const subscription of subscriptions) {
    const startedAt = new Date(subscription.startedAt).getTime();
    const endedAt = endDateOf(subscription);
    const endedMs = endedAt ? new Date(endedAt).getTime() : null;

    const liveAtStart =
      startedAt <= end && (endedMs === null || endedMs >= start);
    if (liveAtStart) base += 1;

    if (endedMs === null) continue;
    if (endedMs < start || endedMs > end) continue;

    churned.push({
      tenantId: subscription.tenantId,
      tenantName: subscription.tenantName ?? subscription.tenantId,
      planName: subscription.planName ?? null,
      endedAt: new Date(endedMs).toISOString(),
      cause: subscription.endedAt ? 'ended' : 'canceled',
    });
  }

  churned.sort((a, b) => a.endedAt.localeCompare(b.endedAt));

  return {
    churned: churned.length,
    base,
    rate: base > 0 ? Math.round((churned.length / base) * 100) : null,
    tenants: churned,
  };
}

export function conversionRate(converted: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((converted / total) * 100);
}
