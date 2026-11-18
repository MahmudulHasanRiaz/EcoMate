import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  CalendarRange,
  CreditCard,
  Hourglass,
  Receipt,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserX,
} from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import {
  WINDOW_PRESETS,
  churnRateLabel,
  compactAmount,
  maxOf,
  primaryRevenueRow,
  rangeLabel,
  seriesBarWidth,
  sharePercent,
} from '../lib/metrics';
import type { MetricsOverview } from '../types';
import { ErrorNote, PageHeader, Skeleton, StatusBadge } from '../components/ui';

const STATUS_ORDER = [
  'ACTIVE',
  'TRIAL',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
] as const;

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  const date = new Date(Number(year), Number(monthNumber) - 1, 1);
  return new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(date);
}

export function MetricsPage() {
  const { api } = useAuth();
  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState(30);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/metrics/overview?window=${window}`)
      .then((response) => readJson<MetricsOverview>(response))
      .then((result) => {
        if (!cancelled) {
          setOverview(result);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, window]);

  const headline = overview ? primaryRevenueRow(overview.revenue.byCurrency) : null;
  const currency = headline?.currency ?? overview?.revenue.primaryCurrency ?? 'BDT';
  const outstanding = overview?.collections.outstanding;
  const statusTotal = overview?.subscriptions.total ?? 0;
  const seriesMax = overview
    ? maxOf(overview.series.months.map((row) => row.collected))
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="Metrics"
        title="Recurring revenue, trials and churn"
        description="Every figure is derived from stored subscriptions, tenants, payments and invoices — currencies are reported separately, never summed."
        actions={
          <div className="segmented" role="group" aria-label="Window">
            {WINDOW_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                className={
                  preset.days === window
                    ? 'button button--accent-outline button--sm'
                    : 'button button--sm'
                }
                aria-pressed={preset.days === window}
                onClick={() => setWindow(preset.days)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        }
      />
      {error ? <ErrorNote message={error} /> : null}
      {loading && !overview ? <Skeleton /> : null}

      {overview ? (
        <>
          <section className="metric-grid" aria-label="Headline metrics">
            <article className="metric metric--tint-1">
              <span className="metric-icon" aria-hidden="true">
                <TrendingUp size={16} strokeWidth={2} />
              </span>
              <span>MRR ({currency})</span>
              <strong>{formatMoney(headline?.mrr ?? 0, currency)}</strong>
              <small>
                {`${headline?.subscriptions ?? 0} paying subscription${(headline?.subscriptions ?? 0) === 1 ? '' : 's'}`}
              </small>
            </article>
            <article className="metric metric--tint-2">
              <span className="metric-icon" aria-hidden="true">
                <CalendarRange size={16} strokeWidth={2} />
              </span>
              <span>ARR ({currency})</span>
              <strong>{formatMoney(headline?.arr ?? 0, currency)}</strong>
              <small>Annualised from the same MRR</small>
            </article>
            <article className="metric metric--tint-3">
              <span className="metric-icon" aria-hidden="true">
                <CreditCard size={16} strokeWidth={2} />
              </span>
              <span>Paying subscriptions</span>
              <strong>{overview.revenue.paying}</strong>
              <small>
                {overview.conversion.rate === null
                  ? 'No subscriptions yet'
                  : `${overview.conversion.rate}% conversion of ${overview.conversion.total}`}
              </small>
            </article>
            <article className="metric metric--tint-4">
              <span className="metric-icon" aria-hidden="true">
                <TriangleAlert size={16} strokeWidth={2} />
              </span>
              <span>Past due · at risk</span>
              <strong>{formatMoney(headline?.atRiskMrr ?? 0, currency)}</strong>
              <small>
                {`${overview.revenue.atRisk} subscription${overview.revenue.atRisk === 1 ? '' : 's'} — never counted in MRR`}
              </small>
            </article>
            <article className="metric metric--tint-1">
              <span className="metric-icon" aria-hidden="true">
                <Hourglass size={16} strokeWidth={2} />
              </span>
              <span>Active trials</span>
              <strong>{overview.trials.active}</strong>
              <small>{overview.trials.endingSoon} ending within 7 days</small>
            </article>
            <article className="metric metric--tint-2">
              <span className="metric-icon" aria-hidden="true">
                <UserX size={16} strokeWidth={2} />
              </span>
              <span>Trials ended unconverted</span>
              <strong>{overview.trials.expired}</strong>
              <small>Trial date passed while still on trial</small>
            </article>
            <article className="metric metric--tint-3">
              <span className="metric-icon" aria-hidden="true">
                <TrendingDown size={16} strokeWidth={2} />
              </span>
              <span>Churn rate</span>
              <strong>{churnRateLabel(overview.churn.rate)}</strong>
              <small>
                {`${overview.churn.churned} of ${overview.churn.base} live at window start`}
              </small>
            </article>
            <article className="metric metric--tint-4">
              <span className="metric-icon" aria-hidden="true">
                <Receipt size={16} strokeWidth={2} />
              </span>
              <span>Open invoices</span>
              <strong>{outstanding?.open.count ?? 0}</strong>
              <small>
                {`${formatMoney(outstanding?.open.amount ?? 0, outstanding?.open.currency ?? currency)} · ${outstanding && outstanding.overdue.count > 0 ? `${outstanding.overdue.count} overdue` : 'none overdue'}`}
              </small>
            </article>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Revenue by currency</h2>
                <p>
                  Monthly-equivalent plan price of each paying subscription.
                  Currencies are never added together.
                </p>
              </div>
              <span className="muted-note">
                Generated {formatDateTime(overview.generatedAt)}
              </span>
            </div>
            {overview.revenue.byCurrency.length === 0 ? (
              <p className="muted-note">
                No paying subscriptions yet — nothing to report as MRR.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Currency</th>
                      <th>MRR</th>
                      <th>ARR</th>
                      <th>Paying subs</th>
                      <th>Past due (at risk)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.revenue.byCurrency.map((row) => (
                      <tr key={row.currency}>
                        <td>
                          <strong>{row.currency}</strong>
                          {row.currency === headline?.currency ? (
                            <span className="sub">headline</span>
                          ) : null}
                        </td>
                        <td>{formatMoney(row.mrr, row.currency)}</td>
                        <td>{formatMoney(row.arr, row.currency)}</td>
                        <td>{row.subscriptions}</td>
                        <td>
                          {row.atRiskMrr > 0
                            ? formatMoney(row.atRiskMrr, row.currency)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted-note">
              Paying bases: {overview.revenue.basis.payingFromSubscription}{' '}
              active subscription
              {overview.revenue.basis.payingFromSubscription === 1 ? '' : 's'},{' '}
              {overview.revenue.basis.payingFromTenant} operator-activated
              tenant{overview.revenue.basis.payingFromTenant === 1 ? '' : 's'}.
            </p>
          </section>

          <div className="detail-grid">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Subscription status</h2>
                  <p>Every subscription row, by lifecycle state.</p>
                </div>
                <span className="muted-note">{statusTotal} total</span>
              </div>
              <ul className="status-list">
                {STATUS_ORDER.map((status) => {
                  const count = overview.subscriptions.counts[status];
                  const share = sharePercent(count, statusTotal);
                  return (
                    <li key={status}>
                      <span className="status-list-head">
                        <StatusBadge status={status} />
                        <strong>{count}</strong>
                      </span>
                      <span className="usage-bar" aria-hidden>
                        <span
                          style={{ width: `${share ?? 0}%` }}
                          data-tone={
                            status === 'ACTIVE'
                              ? 'success'
                              : status === 'PAST_DUE'
                                ? 'warning'
                                : status === 'SUSPENDED' ||
                                    status === 'CANCELLED'
                                  ? 'danger'
                                  : 'muted'
                          }
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="muted-note">
                Tenants: {overview.tenants.active} active ·{' '}
                {overview.tenants.trial} trial · {overview.tenants.pastDue} past
                due · {overview.tenants.suspended} suspended ·{' '}
                {overview.tenants.pending} onboarding ·{' '}
                {overview.tenants.total} total.
              </p>
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Collections · {rangeLabel(overview.windowDays)}</h2>
                  <p>Payments received inside the window, per currency.</p>
                </div>
                <span className="muted-note">
                  {overview.collections.payments} payment
                  {overview.collections.payments === 1 ? '' : 's'}
                </span>
              </div>
              {overview.collections.byCurrency.length === 0 ? (
                <p className="muted-note">No payments collected in this window.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Currency</th>
                        <th>Collected</th>
                        <th>Payments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.collections.byCurrency.map((row) => (
                        <tr key={row.currency}>
                          <td>
                            <strong>{row.currency}</strong>
                          </td>
                          <td>{formatMoney(row.amount, row.currency)}</td>
                          <td>{row.payments}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {outstanding && outstanding.byCurrency.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Outstanding · currency</th>
                        <th>Open</th>
                        <th>Overdue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstanding.byCurrency.map((row) => (
                        <tr key={row.currency}>
                          <td>
                            <strong>{row.currency}</strong>
                          </td>
                          <td>
                            {formatMoney(row.openAmount, row.currency)}
                            <span className="sub">{row.openCount} open</span>
                          </td>
                          <td>
                            {row.overdueAmount > 0
                              ? formatMoney(row.overdueAmount, row.currency)
                              : '—'}
                            <span className="sub">
                              {row.overdueCount} overdue
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-note">No open invoices.</p>
              )}
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Six-month trend</h2>
                <p>
                  {`Collected revenue is shown in ${overview.series.primaryCurrency}; tenant and subscription counts are currency-free.`}
                </p>
              </div>
            </div>
            {overview.series.months.every(
              (row) =>
                row.collected === 0 &&
                row.newTenants === 0 &&
                row.newSubscriptions === 0 &&
                row.churned === 0,
            ) ? (
              <p className="empty-state">
                No collections, signups or churn in the last 6 months — the
                trend appears once there is activity.
              </p>
            ) : (
              <div className="series">
                {overview.series.months.map((row) => (
                <article key={row.month} className="series-col">
                  <div className="series-bars">
                    <span
                      className="series-bar series-bar--money"
                      style={{ height: `${Math.max(2, seriesBarWidth(row.collected, seriesMax))}%` }}
                      title={`Collected ${formatMoney(row.collected, overview.series.primaryCurrency)}`}
                    />
                  </div>
                  <span className="series-value">
                    {row.collected > 0
                      ? compactAmount(row.collected)
                      : '—'}
                  </span>
                  <strong>{monthLabel(row.month)}</strong>
                  <span className="sub">
                    {`+${row.newTenants} tenants · +${row.newSubscriptions} subs${row.churned > 0 ? ` · −${row.churned} churned` : ''}`}
                  </span>
                </article>
              ))}
              </div>
            )}
          </section>

          <div className="detail-grid">
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Top plans by MRR</h2>
                  <p>Paying subscriptions grouped by plan version.</p>
                </div>
              </div>
              {overview.topPlans.length === 0 ? (
                <p className="muted-note">No paying subscriptions yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Version</th>
                        <th>Tenants</th>
                        <th>MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.topPlans.map((row) => (
                        <tr key={`${row.plan}-${row.version}-${row.currency}`}>
                          <td>
                            <strong>{row.plan}</strong>
                            <span className="sub">{row.currency}</span>
                          </td>
                          <td>v{row.version}</td>
                          <td>{row.tenants}</td>
                          <td>{formatMoney(row.mrr, row.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Churn · {rangeLabel(overview.windowDays)}</h2>
                  <p>
                    Subscriptions that ended or were cancelled inside the
                    window.
                  </p>
                </div>
                <span className="muted-note">
                  {churnRateLabel(overview.churn.rate)} of{' '}
                  {overview.churn.base} live at start
                </span>
              </div>
              {overview.churn.tenants.length === 0 ? (
                <p className="muted-note">No churn in this window.</p>
              ) : (
                <ul className="churn-list">
                  {overview.churn.tenants.map((row) => (
                    <li key={`${row.tenantId}-${row.endedAt}`}>
                      <Link
                        to="/tenants/$tenantId"
                        params={{ tenantId: row.tenantId }}
                        className="table-link"
                      >
                        {row.tenantName}
                      </Link>
                      <span className="sub">
                        {row.planName ?? 'No plan'} ·{' '}
                        {row.cause === 'ended' ? 'ended' : 'cancelled'}{' '}
                        {formatDateTime(row.endedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
