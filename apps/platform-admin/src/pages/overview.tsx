import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, planLabel } from '../lib/format';
import type { Page, Tenant } from '../types';
import { ErrorNote, Loading, PageHeader, StatusBadge } from '../components/ui';

export function OverviewPage() {
  const { api } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
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
    ])
      .then(([recent, ...statusPages]) => {
        if (cancelled) return;
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
        <Loading />
      ) : (
        <>
          <section className="metric-grid">
            <article className="metric">
              <span>Total tenants</span>
              <strong>{total}</strong>
              <small>Across all statuses</small>
            </article>
            <article className="metric">
              <span>On trial</span>
              <strong>{trial}</strong>
              <small>Provisioned and evaluating</small>
            </article>
            <article className="metric">
              <span>Active</span>
              <strong>{active}</strong>
              <small>Paying or converted</small>
            </article>
            <article className="metric">
              <span>Needs attention</span>
              <strong>{attention}</strong>
              <small>Past due, suspended or mid-setup</small>
            </article>
          </section>

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
              <p className="muted-note">
                No tenants yet.{' '}
                <Link to="/tenants/new">Create the first tenant</Link> to
                provision a store.
              </p>
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
