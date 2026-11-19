import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  BadgeCheck,
  Building,
  Hourglass,
  TriangleAlert,
} from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatMoney, planLabel } from '../lib/format';
import type { EmailBalanceOverview, Page, Tenant } from '../types';
import { EmptyState, ErrorNote, PageHeader, Skeleton, StatusBadge } from '../components/ui';

export function OverviewPage() {
  const { api } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [emailOverview, setEmailOverview] =
    useState<EmailBalanceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const statuses = [
      'TRIAL',
      'ACTIVE',
      'PAST_DUE',
      'SUSPENDED',
      'PROVISIONING',
    ] as const;

    Promise.all([
      api('/tenants?limit=8').then((response) => readJson<Page<Tenant>>(response)),
      ...statuses.map((status) =>
        api(`/tenants?status=${status}&limit=1`).then((response) =>
          readJson<Page<Tenant>>(response),
        ),
      ),
      api('/email-balance/overview')
        .then((response) => readJson<EmailBalanceOverview>(response))
        .catch(() => null),
    ])
      .then(([recent, ...rest]) => {
        if (cancelled) return;
        const statusPages = rest.slice(0, statuses.length) as Page<Tenant>[];
        const email = rest[statuses.length] as EmailBalanceOverview | null;
        setEmailOverview(email);
        setTenants(recent.data);
        setTotal(recent.meta.total);
        setCounts(
          Object.fromEntries(
            statuses.map((status, index) => [
              status,
              statusPages[index]?.meta.total ?? 0,
            ]),
          ),
        );
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
  }, [api]);

  const trial = counts.TRIAL ?? 0;
  const active = counts.ACTIVE ?? 0;
  const attention = ['PAST_DUE', 'SUSPENDED', 'PROVISIONING'].reduce(
    (sum, status) => sum + (counts[status] ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        eyebrow="Platform overview"
        title="Every store, one control plane"
        description="Live tenant state from the platform registry."
      />
      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Skeleton />
      ) : (
        <>
          {/* Colored stat cards (Boss 2026-11-18): each card its own
              SUBTLE gradient tint — indigo family only, from the landing
              palette tokens (--em-stat-1..4). No outside colors. */}
          <section className="metric-grid">
            <article className="metric metric--tint-1">
              <span className="metric-icon" aria-hidden="true">
                <Building size={16} strokeWidth={2} />
              </span>
              <span>Total tenants</span>
              <strong>{total}</strong>
              <small>Across all statuses</small>
            </article>
            <article className="metric metric--tint-2">
              <span className="metric-icon" aria-hidden="true">
                <Hourglass size={16} strokeWidth={2} />
              </span>
              <span>On trial</span>
              <strong>{trial}</strong>
              <small>Provisioned and evaluating</small>
            </article>
            <article className="metric metric--tint-3">
              <span className="metric-icon" aria-hidden="true">
                <BadgeCheck size={16} strokeWidth={2} />
              </span>
              <span>Active</span>
              <strong>{active}</strong>
              <small>Paying or converted</small>
            </article>
            <article className="metric metric--tint-4">
              <span className="metric-icon" aria-hidden="true">
                <TriangleAlert size={16} strokeWidth={2} />
              </span>
              <span>Needs attention</span>
              <strong>{attention}</strong>
              <small>Past due, suspended or mid-setup</small>
            </article>
          </section>

          {emailOverview ? (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Email balance</h2>
                  <p>
                    Shared SMTP usage across tenants. Low means at or below
                    the {emailOverview.threshold}-email warning threshold.
                  </p>
                </div>
              </div>
              <div className="metric-grid">
                <article className="metric metric--tint-2">
                  <span>Low-balance tenants</span>
                  <strong>{emailOverview.lowBalanceTenants.length}</strong>
                  <small>At or below the threshold</small>
                </article>
                <article className="metric metric--tint-3">
                  <span>Lots expiring in 7 days</span>
                  <strong>{emailOverview.expiringLots.length}</strong>
                  <small>
                    {emailOverview.expiringLots
                      .reduce((sum, lot) => sum + lot.emailsRemaining, 0)
                      .toLocaleString('en-US')}{' '}
                    emails
                  </small>
                </article>
                <article className="metric metric--tint-4">
                  <span>Top-ups sold</span>
                  <strong>{emailOverview.topUpVolume.count}</strong>
                  <small>
                    {emailOverview.topUpVolume.emailsGranted.toLocaleString(
                      'en-US',
                    )}{' '}
                    emails · {formatMoney(emailOverview.topUpVolume.revenueBDT)}
                  </small>
                </article>
              </div>
              {emailOverview.lowBalanceTenants.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Status</th>
                        <th>Emails left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emailOverview.lowBalanceTenants
                        .slice(0, 8)
                        .map((row) => (
                          <tr key={row.tenantId}>
                            <td>
                              <Link
                                to="/tenants/$tenantId"
                                params={{ tenantId: row.tenantId }}
                                className="table-link"
                              >
                                {row.name}
                              </Link>
                              <span className="sub">{row.slug}</span>
                            </td>
                            <td>
                              <StatusBadge status={row.status} />
                            </td>
                            <td>{row.balance.toLocaleString('en-US')}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted-note">
                  No tenant is at or below the low-balance threshold.
                </p>
              )}
            </section>
          ) : null}

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Recent tenants</h2>
                <p>Newest workspaces first.</p>
              </div>
              <Link to="/tenants" className="button button--ghost">
                All tenants
              </Link>
            </div>
            {tenants.length === 0 ? (
              <EmptyState icon={Building} title="No tenants yet">
                <Link to="/tenants/new">Create the first tenant</Link> to
                provision a store.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Store</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Plan</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((tenant) => (
                      <tr key={tenant.id}>
                        <td>
                          <Link
                            to="/tenants/$tenantId"
                            params={{ tenantId: tenant.id }}
                            className="table-link"
                          >
                            {tenant.name}
                          </Link>
                          <span className="sub">{tenant.slug}</span>
                        </td>
                        <td>{tenant.ownerEmail}</td>
                        <td>
                          <StatusBadge status={tenant.status} />
                        </td>
                        <td>
                          {planLabel(
                            tenant.subscription?.planVersion ??
                              tenant.planVersion ??
                              null,
                          )}
                        </td>
                        <td>{formatDate(tenant.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
