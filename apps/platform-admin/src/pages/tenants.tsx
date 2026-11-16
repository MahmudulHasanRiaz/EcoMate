import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, planLabel } from '../lib/format';
import type { Page, Tenant } from '../types';
import { ErrorNote, Loading, PageHeader, StatusBadge } from '../components/ui';

const STATUSES = [
  '',
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'PROVISIONING',
  'DELETED',
];

export function TenantsPage() {
  const { api } = useAuth();
  const [data, setData] = useState<Page<Tenant> | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    api(`/tenants?${params.toString()}`)
      .then((response) => readJson<Page<Tenant>>(response))
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
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
  }, [api, page, status, search]);

  return (
    <>
      <PageHeader
        eyebrow="Tenants"
        title="Workspaces"
        description="Every provisioned store and its current lifecycle state."
      />

      <div className="toolbar">
        <form
          className="toolbar-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(draft.trim());
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search name, slug or owner email"
            aria-label="Search tenants"
          />
          <button type="submit" className="button button--ghost">
            Search
          </button>
        </form>
        <label className="toolbar-filter">
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            {STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value ? value.replaceAll('_', ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Loading /> : null}

      {data ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{data.meta.total} tenant{data.meta.total === 1 ? '' : 's'}</h2>
              <p>
                Page {data.meta.page} of {Math.max(1, data.meta.totalPages)}
              </p>
            </div>
          </div>
          {data.data.length === 0 ? (
            <p className="muted-note">No tenants match this filter.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Store</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Plan</th>
                    <th>Trial ends</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((tenant) => (
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
                      <td>{formatDate(tenant.trialEndsAt)}</td>
                      <td>{formatDate(tenant.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pager">
            <button
              type="button"
              className="button button--ghost"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <span>
              {data.meta.page} / {Math.max(1, data.meta.totalPages)}
            </span>
            <button
              type="button"
              className="button button--ghost"
              disabled={page >= data.meta.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
