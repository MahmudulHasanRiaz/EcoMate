import { Inject, Injectable, Optional } from '@nestjs/common';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { METRICS_CLOCK } from './metrics.clock';
import type { MetricsClock } from './metrics.clock';
import {
  ChurnStats,
  SubscriptionLike,
  TrialStats,
  buildRevenue,
  churnStats,
  conversionRate,
  monthlyEquivalentCents,
  revenueState,
  roundMoney,
  statusCounts,
  trialStats,
} from './metrics.compute';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const SERIES_MONTHS = 6;
const TRIAL_SOON_DAYS = 7;
const DAY_MS = 86_400_000;

export interface MetricsOverview {
  generatedAt: string;
  windowDays: number;
  revenue: {
    byCurrency: Array<{
      currency: string;
      mrr: number;
      arr: number;
      subscriptions: number;
      atRiskMrr: number;
    }>;
    paying: number;
    atRisk: number;
    primaryCurrency: string;
    basis: {
      payingFromSubscription: number;
      payingFromTenant: number;
      atRiskFromSubscription: number;
      atRiskFromTenant: number;
    };
  };
  subscriptions: {
    total: number;
    counts: {
      ACTIVE: number;
      TRIAL: number;
      PAST_DUE: number;
      SUSPENDED: number;
      CANCELLED: number;
      EXPIRED: number;
    };
  };
  tenants: {
    total: number;
    active: number;
    trial: number;
    pastDue: number;
    suspended: number;
    pending: number;
    cancelled: number;
    deleted: number;
  };
  trials: TrialStats;
  churn: ChurnStats;
  conversion: { paying: number; total: number; rate: number | null };
  collections: {
    windowDays: number;
    payments: number;
    byCurrency: Array<{ currency: string; amount: number; payments: number }>;
    outstanding: {
      open: { count: number; amount: number; currency: string };
      overdue: { count: number; amount: number; currency: string };
      byCurrency: Array<{
        currency: string;
        openCount: number;
        openAmount: number;
        overdueCount: number;
        overdueAmount: number;
      }>;
    };
  };
  series: {
    primaryCurrency: string;
    months: Array<{
      month: string;
      collected: number;
      newTenants: number;
      newSubscriptions: number;
      churned: number;
    }>;
  };
  topPlans: Array<{
    plan: string;
    version: number;
    currency: string;
    tenants: number;
    mrr: number;
  }>;
}

const DHAKA_MONTH = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
});

function monthKey(date: Date): string {
  return DHAKA_MONTH.format(date);
}

function windowDays(value?: number): number {
  const days = Number(value ?? DEFAULT_WINDOW_DAYS);
  if (!Number.isFinite(days)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(days)));
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function sumBy(rows: Array<{ amount: number; currency: string }>) {
  const map = new Map<string, { currency: string; amount: number; payments: number }>();
  for (const row of rows) {
    const currency = row.currency || 'BDT';
    const entry =
      map.get(currency) ??
      ({ currency, amount: 0, payments: 0 } as {
        currency: string;
        amount: number;
        payments: number;
      });
    entry.amount += row.amount;
    entry.payments += 1;
    map.set(currency, entry);
  }
  return [...map.values()]
    .map((row) => ({
      currency: row.currency,
      amount: roundMoney(row.amount),
      payments: row.payments,
    }))
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

/**
 * Platform metrics for the operator dashboard.
 *
 * Every figure is derived from stored platform rows — subscriptions, tenants,
 * payments and invoices. Nothing is estimated and no period is invented:
 * windows that have no data stay empty instead of showing a zero series.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    @Optional()
    @Inject(METRICS_CLOCK)
    private readonly clock?: MetricsClock,
  ) {}

  async overview(days?: number): Promise<MetricsOverview> {
    const window = windowDays(days);
    const now = this.clock ? this.clock() : new Date();
    const windowStart = new Date(now.getTime() - window * DAY_MS);
    const seriesStart = addMonths(now, -(SERIES_MONTHS - 1));

    const [subscriptions, tenantGroups, payments, invoices, tenants] =
      await Promise.all([
        this.prisma.subscription.findMany({
          include: {
            planVersion: { include: { plan: true } },
            tenant: { select: { id: true, name: true, status: true } },
          },
        }),
        this.prisma.tenant.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.payment.findMany({
          where: { receivedAt: { gte: seriesStart } },
          select: { amount: true, currency: true, receivedAt: true },
        }),
        this.prisma.invoice.findMany({
          where: { status: 'OPEN' },
          select: { total: true, currency: true, dueAt: true },
        }),
        this.prisma.tenant.findMany({
          where: { createdAt: { gte: seriesStart } },
          select: { createdAt: true },
        }),
      ]);

    const rows: SubscriptionLike[] = subscriptions.map((subscription: any) => ({
      id: subscription.id,
      tenantId: subscription.tenantId,
      tenantName: subscription.tenant?.name ?? null,
      planName: subscription.planVersion?.plan?.name ?? null,
      status: subscription.status,
      tenantStatus: subscription.tenant?.status ?? null,
      planVersionNumber: subscription.planVersion?.version ?? 1,
      price: subscription.planVersion?.price ?? null,
      currency: subscription.planVersion?.currency ?? 'BDT',
      interval: subscription.planVersion?.interval ?? 'MONTHLY',
      intervalDays: subscription.planVersion?.intervalDays ?? null,
      startedAt: subscription.startedAt,
      trialEndsAt: subscription.trialEndsAt ?? null,
      endedAt: subscription.endedAt ?? null,
      canceledAt: subscription.canceledAt ?? null,
    }));

    const revenue = buildRevenue(rows);
    const counts = statusCounts(rows);
    const trials = trialStats(rows, now, TRIAL_SOON_DAYS);
    const churn = churnStats(rows, windowStart, now);

    const tenantCounts: Record<string, number> = {
      ACTIVE: 0,
      TRIAL: 0,
      PAST_DUE: 0,
      SUSPENDED: 0,
      PENDING_VERIFICATION: 0,
      PROVISIONING: 0,
      CANCELLED: 0,
      DELETED: 0,
    };
    for (const group of tenantGroups as Array<{
      status: string;
      _count: { _all: number } | number;
    }>) {
      const count =
        typeof group._count === 'number'
          ? group._count
          : (group._count?._all ?? 0);
      tenantCounts[group.status] = (tenantCounts[group.status] ?? 0) + count;
    }

    const collectedRows = payments
      .filter(
        (payment) =>
          new Date(payment.receivedAt).getTime() >= windowStart.getTime(),
      )
      .map((payment) => ({
        amount: Number(payment.amount),
        currency: payment.currency,
      }));

    const outstandingByCurrency = new Map<
      string,
      {
        currency: string;
        openCount: number;
        openAmount: number;
        overdueCount: number;
        overdueAmount: number;
      }
    >();
    for (const invoice of invoices) {
      const currency = invoice.currency || 'BDT';
      const entry =
        outstandingByCurrency.get(currency) ??
        ({
          currency,
          openCount: 0,
          openAmount: 0,
          overdueCount: 0,
          overdueAmount: 0,
        } as {
          currency: string;
          openCount: number;
          openAmount: number;
          overdueCount: number;
          overdueAmount: number;
        });
      entry.openCount += 1;
      entry.openAmount += Number(invoice.total);
      if (new Date(invoice.dueAt).getTime() < now.getTime()) {
        entry.overdueCount += 1;
        entry.overdueAmount += Number(invoice.total);
      }
      outstandingByCurrency.set(currency, entry);
    }

    const outstandingByCurrencyRows = [...outstandingByCurrency.values()]
      .map((row) => ({
        currency: row.currency,
        openCount: row.openCount,
        openAmount: roundMoney(row.openAmount),
        overdueCount: row.overdueCount,
        overdueAmount: roundMoney(row.overdueAmount),
      }))
      .sort((a, b) => b.openAmount - a.openAmount);
    const primaryOutstanding = outstandingByCurrencyRows[0];

    const primaryCurrency =
      revenue.byCurrency[0]?.currency ??
      outstandingByCurrencyRows[0]?.currency ??
      'BDT';

    const monthKeys: string[] = [];
    for (let index = SERIES_MONTHS - 1; index >= 0; index -= 1) {
      monthKeys.push(monthKey(addMonths(now, -index)));
    }
    const months = monthKeys.map((month) => ({
      month,
      collected: 0,
      newTenants: 0,
      newSubscriptions: 0,
      churned: 0,
    }));
    const monthIndex = new Map(months.map((row, index) => [row.month, index]));

    for (const payment of payments) {
      if ((payment.currency || 'BDT') !== primaryCurrency) continue;
      const index = monthIndex.get(monthKey(new Date(payment.receivedAt)));
      if (index === undefined) continue;
      months[index].collected = roundMoney(
        months[index].collected + Number(payment.amount),
      );
    }
    for (const tenant of tenants) {
      const index = monthIndex.get(monthKey(new Date(tenant.createdAt)));
      if (index === undefined) continue;
      months[index].newTenants += 1;
    }
    for (const subscription of rows) {
      const index = monthIndex.get(monthKey(new Date(subscription.startedAt)));
      if (index !== undefined) months[index].newSubscriptions += 1;

      const endedAt = subscription.endedAt ?? subscription.canceledAt ?? null;
      if (!endedAt) continue;
      const churnIndex = monthIndex.get(monthKey(new Date(endedAt)));
      if (churnIndex !== undefined) months[churnIndex].churned += 1;
    }

    const planRows = new Map<
      string,
      { plan: string; version: number; currency: string; tenants: number; mrr: number }
    >();
    for (const subscription of rows) {
      if (revenueState(subscription).state !== 'paying') continue;
      const plan = subscription.planName ?? 'No plan';
      const version = subscription.planVersionNumber ?? 1;
      const key = `${plan}#${version}#${subscription.currency}`;
      const entry =
        planRows.get(key) ??
        ({
          plan,
          version,
          currency: subscription.currency,
          tenants: 0,
          mrr: 0,
        } as {
          plan: string;
          version: number;
          currency: string;
          tenants: number;
          mrr: number;
        });
      entry.tenants += 1;
      entry.mrr = roundMoney(
        entry.mrr +
          monthlyEquivalentCents(
            subscription.price,
            subscription.interval,
            subscription.intervalDays,
          ) /
          100,
      );
      planRows.set(key, entry);
    }
    const topPlans = [...planRows.values()].sort(
      (a, b) => b.mrr - a.mrr || a.plan.localeCompare(b.plan),
    );

    return {
      generatedAt: now.toISOString(),
      windowDays: window,
      revenue: {
        byCurrency: revenue.byCurrency,
        paying: revenue.paying,
        atRisk: revenue.atRisk,
        primaryCurrency,
        basis: revenue.basis,
      },
      subscriptions: { total: rows.length, counts },
      tenants: {
        total: Object.values(tenantCounts).reduce((sum, value) => sum + value, 0),
        active: tenantCounts.ACTIVE,
        trial: tenantCounts.TRIAL,
        pastDue: tenantCounts.PAST_DUE,
        suspended: tenantCounts.SUSPENDED,
        pending:
          tenantCounts.PENDING_VERIFICATION + tenantCounts.PROVISIONING,
        cancelled: tenantCounts.CANCELLED,
        deleted: tenantCounts.DELETED,
      },
      trials,
      churn,
      conversion: {
        paying: revenue.paying,
        total: rows.length,
        rate: conversionRate(revenue.paying, rows.length),
      },
      collections: {
        windowDays: window,
        payments: collectedRows.length,
        byCurrency: sumBy(collectedRows),
        outstanding: {
          open: {
            count: primaryOutstanding?.openCount ?? 0,
            amount: primaryOutstanding?.openAmount ?? 0,
            currency: primaryOutstanding?.currency ?? primaryCurrency,
          },
          overdue: {
            count: primaryOutstanding?.overdueCount ?? 0,
            amount: primaryOutstanding?.overdueAmount ?? 0,
            currency: primaryOutstanding?.currency ?? primaryCurrency,
          },
          byCurrency: outstandingByCurrencyRows,
        },
      },
      series: { primaryCurrency, months },
      topPlans,
    };
  }
}
