import { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  planLabel,
} from '../lib/format';
import type { Tenant } from '../types';
import {
  ErrorNote,
  Loading,
  PageHeader,
  StatusBadge,
} from '../components/ui';

export function TenantDetailPage() {
  const { tenantId } = useParams({ from: '/tenants/$tenantId' });
  const { api } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/tenants/${tenantId}`)
      .then((response) => readJson<Tenant>(response))
      .then((result) => {
        if (!cancelled) {
          setTenant(result);
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
  }, [api, tenantId]);

  if (loading && !tenant) return <Loading label="Loading tenant…" />;
  if (error) return <ErrorNote message={error} />;
  if (!tenant) return null;

  const version = tenant.subscription?.planVersion ?? tenant.planVersion ?? null;

  return (
    <>
      <p className="breadcrumb">
        <Link to="/tenants">Tenants</Link>
        <span>/</span>
        <span>{tenant.name}</span>
      </p>
      <PageHeader
        eyebrow={tenant.slug}
        title={tenant.name}
        description={`Owner ${tenant.ownerEmail}`}
        actions={<StatusBadge status={tenant.status} />}
      />

      <section className="detail-grid">
        <article className="card">
          <h2>Workspace</h2>
          <dl className="facts">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={tenant.status} />
              </dd>
            </div>
            <div>
              <dt>Tenant ID</dt>
              <dd className="mono">{tenant.id}</dd>
            </div>
            <div>
              <dt>Store address</dt>
              <dd>{tenant.slug}</dd>
            </div>
            <div>
              <dt>Owner phone</dt>
              <dd>{tenant.ownerPhone || '—'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDateTime(tenant.createdAt)}</dd>
            </div>
            <div>
              <dt>Deleted</dt>
              <dd>{formatDateTime(tenant.deletedAt)}</dd>
            </div>
          </dl>
        </article>

        <article className="card">
          <h2>Subscription</h2>
          <dl className="facts">
            <div>
              <dt>Plan</dt>
              <dd>{planLabel(version)}</dd>
            </div>
            <div>
              <dt>Subscription</dt>
              <dd>{tenant.subscription?.status || '—'}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatMoney(version?.price, version?.currency || 'BDT')}</dd>
            </div>
            <div>
              <dt>Trial ends</dt>
              <dd>{formatDate(tenant.trialEndsAt)}</dd>
            </div>
            <div>
              <dt>Period ends</dt>
              <dd>
                {formatDate(
                  tenant.subscription?.currentPeriodEnd ??
                    tenant.currentPeriodEnd,
                )}
              </dd>
            </div>
            <div>
              <dt>Features</dt>
              <dd>{version?.features.length ?? 0}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Domains</h2>
            <p>Primary, subdomain aliases and verified custom hosts.</p>
          </div>
        </div>
        {tenant.domains && tenant.domains.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>TLS</th>
                  <th>Primary</th>
                </tr>
              </thead>
              <tbody>
                {tenant.domains.map((domain) => (
                  <tr key={domain.id}>
                    <td className="mono">{domain.host}</td>
                    <td>{domain.type}</td>
                    <td>{domain.status}</td>
                    <td>{domain.tlsStatus || '—'}</td>
                    <td>{domain.isPrimary ? 'Yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-note">No domains recorded.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Billing footprint</h2>
            <p>Counts only; invoices and proofs arrive with the billing queue.</p>
          </div>
        </div>
        <div className="metric-grid metric-grid--compact">
          <div className="metric metric--plain">
            <span>Invoices</span>
            <strong>{tenant._count?.invoices ?? 0}</strong>
          </div>
          <div className="metric metric--plain">
            <span>Payments</span>
            <strong>{tenant._count?.payments ?? 0}</strong>
          </div>
        </div>
      </section>
    </>
  );
}
