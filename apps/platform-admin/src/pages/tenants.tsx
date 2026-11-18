import { useEffect, useState } from 'react';
import { Building } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatStatus, planLabel } from '../lib/format';
import type { Page, Tenant } from '../types';
import { EmptyState, ErrorNote, Pager, PageHeader, Skeleton, StatusBadge } from '../components/ui';

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
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
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
  }, [api, page, limit, status, search]);

  return (
    <>
      <PageHeader
        eyebrow="Tenants"
        title="Workspaces"
        description="Every provisioned store and its current lifecycle state."
        actions={
          <Link to="/tenants/new" className="button button--primary">
            New tenant
          </Link>
        }
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
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              // F12: clearing the box clears the filter. Previously the
              // list stayed filtered with an empty box, so "No tenants
              // match this filter." appeared with nothing in the search.
              if (next.trim() === '' && search !== '') {
                setSearch('');
                setPage(1);
              }
            }}
            placeholder="Search name, slug or owner email"
            aria-label="Search tenants"
          />
          <button type="submit" className="button">
            Search
          </button>
        </form>
        {search ? (
          <span className="filter-chip">
            Search: {search}
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch('');
                setDraft('');
                setPage(1);
              }}
            >
              ×
            </button>
          </span>
        ) : null}
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
                {value ? formatStatus(value) : 'All statuses'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <ErrorNote message={error} /> : null}
      {loading && !data ? <Skeleton /> : null}

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
            search || status ? (
              <EmptyState icon={Building} title="No tenants match this filter">
                Try a different search or status.
              </EmptyState>
            ) : (
              <EmptyState icon={Building} title="No tenants yet">
                <Link to="/tenants/new">Create the first tenant</Link> to
                provision a store.
              </EmptyState>
            )
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
          <Pager
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            limit={limit}
            onPage={setPage}
            onLimit={(next) => {
              setLimit(next);
              setPage(1);
            }}
          />
        </section>
      ) : null}
    </>
  );
}
