import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Building,
  CloudOff,
  Gauge,
  TriangleAlert,
} from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  barWidth,
  formatLimit,
  formatUsagePercent,
  usageTone,
} from '../lib/usage';
import type { UsageMetricRow, UsageOverview } from '../types';
import { ErrorNote, PageHeader, Skeleton, StatusBadge } from '../components/ui';

function MetricCell({ metric }: { metric: UsageMetricRow }) {
  const tone = usageTone(metric);
  return (
    <div className={`usage-cell usage-cell--${tone}`}>
      <div className="usage-cell-top">
        <span className="usage-used">
          {metric.used === null ? '—' : formatLimit(metric.used)}
          <small> / {formatLimit(metric.limit)}</small>
        </span>
        <span className="usage-percent">
          {formatUsagePercent(metric.percent)}
        </span>
      </div>
      <span className="usage-bar" aria-hidden>
        <span style={{ width: `${barWidth(metric.percent)}%` }} />
      </span>
      {metric.override !== null ? (
        <span className="usage-override-flag">
          override {formatLimit(metric.override)}
        </span>
      ) : null}
    </div>
  );
}

export function UsagePage() {
  const { api } = useAuth();
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api('/usage/overview?days=30')
      .then((response) => readJson<UsageOverview>(response))
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
  }, [api, reload]);

  async function refreshAll() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await api('/usage/refresh', { method: 'POST' });
      const result = await readJson<{
        total: number;
        refreshed: number;
        failed: Array<{ tenantId: string; error: string }>;
      }>(response);
      if (result.failed.length > 0) {
        setError(
          `Collected ${result.refreshed}/${result.total} tenants. ` +
            `${result.failed.length} failed — first: ${result.failed[0].error}`,
        );
      } else {
        setNotice(
          `Collected live usage from ${result.refreshed}/${result.total} tenants.`,
        );
      }
      setReload((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const totals = overview?.totals;

  return (
    <>
      <PageHeader
        eyebrow="Usage"
        title="Plan consumption across tenants"
        description="Effective limits include per-tenant overrides. Counters come from each tenant runtime and are stored per Dhaka day."
        actions={
          <button
            type="button"
            className="button button--accent"
            onClick={refreshAll}
            disabled={busy}
          >
            {busy ? 'Collecting…' : 'Collect live usage'}
          </button>
        }
      />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {loading && !overview ? <Skeleton /> : null}

      {totals ? (
        <section className="metric-grid">
          <article className="metric metric--tint-1">
            <span className="metric-icon" aria-hidden="true">
              <Building size={16} strokeWidth={2} />
            </span>
            <span>Tenants</span>
            <strong>{totals.tenants}</strong>
            <small>{totals.tracked} with a stored snapshot</small>
          </article>
          <article className="metric metric--tint-2">
            <span className="metric-icon" aria-hidden="true">
              <Gauge size={16} strokeWidth={2} />
            </span>
            <span>Over limit</span>
            <strong>{totals.overLimitMetrics}</strong>
            <small>Metric rows above their effective limit</small>
          </article>
          <article className="metric metric--tint-3">
            <span className="metric-icon" aria-hidden="true">
              <TriangleAlert size={16} strokeWidth={2} />
            </span>
            <span>Warnings</span>
            <strong>{totals.warningMetrics}</strong>
            <small>At 80% or more, still under the limit</small>
          </article>
          <article className="metric metric--tint-4">
            <span className="metric-icon" aria-hidden="true">
              <CloudOff size={16} strokeWidth={2} />
            </span>
            <span>Not collected</span>
            <strong>{totals.missing}</strong>
            <small>No snapshot in the last {overview.windowDays} days</small>
          </article>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Per-tenant usage</h2>
            <p>
              Over-limit and missing rows sort first. Last collected is the
              latest snapshot write, not a real-time counter.
            </p>
          </div>
          {overview ? (
            <span className="muted-note">
              Generated {formatDateTime(overview.generatedAt)}
            </span>
          ) : null}
        </div>
        {overview && overview.tenants.length === 0 ? (
          <p className="muted-note">No tenants yet.</p>
        ) : null}
        {overview && overview.tenants.length > 0 ? (
          <div className="table-wrap">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Products</th>
                  <th>Staff</th>
                  <th>Orders / month</th>
                  <th>Storage MB</th>
                  <th>Last collected</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {overview.tenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className={tenant.over ? 'usage-row--over' : undefined}
                  >
                    <td>
                      <Link
                        to="/tenants/$tenantId"
                        params={{ tenantId: tenant.id }}
                        className="table-link"
                      >
                        {tenant.name}
                      </Link>
                      <span className="sub">
                        {tenant.slug} · {tenant.planName ?? 'No plan'}
                      </span>
                      <span className="usage-row-badges">
                        <StatusBadge status={tenant.status} />
                        {tenant.over ? (
                          <span className="badge badge--danger">Over limit</span>
                        ) : tenant.warning ? (
                          <span className="badge badge--warning">
                            Near limit
                          </span>
                        ) : null}
                      </span>
                    </td>
                    {tenant.metrics.map((metric) => (
                      <td key={metric.key}>
                        <MetricCell metric={metric} />
                      </td>
                    ))}
                    <td>
                      {tenant.lastCollectedAt
                        ? formatDateTime(tenant.lastCollectedAt)
                        : '—'}
                    </td>
                    <td>
                      <Link
                        to="/tenants/$tenantId"
                        params={{ tenantId: tenant.id }}
                        className="button button--ghost button--sm"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
