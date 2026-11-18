import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import {
  leadContactLabel,
  LEAD_STATUSES,
  LEAD_TRIAGE_STATUSES,
  leadStatusLabel,
  leadsQueryString,
} from '../lib/leads';
import type { Lead, LeadStatus, Page } from '../types';
import {
  EmptyState,
  ErrorNote,
  Modal,
  Pager,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../components/ui';

export function LeadsPage() {
  const { api, session } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Page<Lead> | null>(null);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [nextStatus, setNextStatus] = useState<LeadStatus | ''>('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Export is SUPERADMIN/BILLING-only on the API (bulk PII, same rule
  // as the audit export); convert is SUPERADMIN/BILLING/SUPPORT.
  // Hide the buttons for roles that would 403 instead of showing them.
  const role = session?.user.role ?? '';
  const canExport = role === 'SUPERADMIN' || role === 'BILLING';
  const canConvert =
    role === 'SUPERADMIN' || role === 'BILLING' || role === 'SUPPORT';

  const load = () => {
    setLoading(true);
    api(`/leads${leadsQueryString({ status, search, page, limit })}`)
      .then((response) => readJson<Page<Lead>>(response))
      .then((result) => setData(result))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, status, search, page, limit]);

  // Keep the status picker in sync with the open lead. NEW is not a
  // triage target, so a new lead starts on the first triage status.
  useEffect(() => {
    if (!selected) {
      setNextStatus('');
      return;
    }
    setNextStatus(
      (LEAD_TRIAGE_STATUSES as string[]).includes(selected.status)
        ? selected.status
        : LEAD_TRIAGE_STATUSES[0],
    );
  }, [selected]);

  async function setLeadStatus(lead: Lead, next: LeadStatus) {
    setBusy(true);
    setError(null);
    try {
      const response = await api(`/leads/${lead.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      const updated = await readJson<Lead>(response);
      setNotice(
        `Lead from ${lead.name} marked ${leadStatusLabel(next).toLowerCase()}.`,
      );
      setSelected(updated);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportLeads() {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api(
        `/leads/export${leadsQueryString({ status, search })}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message =
          body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : `Export failed (${response.status})`;
        throw new Error(message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = match?.[1] ?? 'leads-export.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice('Leads export downloaded (CSV).');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Leads"
        description="Contact requests from the landing lead form. Open a lead to read the full message, move it through the pipeline, or convert it into a tenant."
      />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}

      {/* One aligned filter row on the Tenants pattern: search form +
          active-search chip + styled status filter + Export (LE1 — the
          old toolbar scattered a bare native select, a nested inline
          form and the export button across two uneven rows). */}
      <div className="toolbar">
        <form
          className="toolbar-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <input
            value={searchInput}
            onChange={(event) => {
              const next = event.target.value;
              setSearchInput(next);
              // Same as Tenants (F12): clearing the box clears the filter.
              if (next.trim() === '' && search !== '') {
                setSearch('');
                setPage(1);
              }
            }}
            placeholder="Name, contact, or message…"
            aria-label="Search leads"
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
                setSearchInput('');
                setSearch('');
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
            aria-label="Lead status filter"
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {leadStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {canExport ? (
          <button
            type="button"
            className="button"
            disabled={exporting}
            onClick={() => void exportLeads()}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        ) : null}
      </div>

      {loading && !data ? <Skeleton /> : null}
      {data ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>
                {data.meta.total} lead{data.meta.total === 1 ? '' : 's'}
              </h2>
              <p>
                Page {data.meta.page} of {Math.max(1, data.meta.totalPages)}
              </p>
            </div>
          </div>
          {data.data.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title={status ? 'No leads match this filter' : 'No leads yet'}
            >
              {status
                ? 'Try a different search or status.'
                : 'Leads arrive from the landing lead form.'}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Monthly orders</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((lead) => (
                    <tr key={lead.id}>
                      <td>{formatDate(lead.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="table-link"
                          onClick={() => setSelected(lead)}
                        >
                          {lead.name}
                        </button>
                      </td>
                      <td>
                        {lead.contact}
                        <span className="sub">
                          {leadContactLabel(lead.contactType)}
                        </span>
                      </td>
                      <td>{lead.monthlyOrders || '—'}</td>
                      <td>
                        <StatusBadge status={lead.status} />
                      </td>
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

      <Modal
        open={selected !== null}
        title={selected ? `Lead — ${selected.name}` : 'Lead'}
        wide
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <dl className="facts">
              <div>
                <dt>Received</dt>
                <dd>{formatDateTime(selected.createdAt)}</dd>
              </div>
              <div>
                <dt>{leadContactLabel(selected.contactType)}</dt>
                <dd>{selected.contact}</dd>
              </div>
              <div>
                <dt>Monthly orders</dt>
                <dd>{selected.monthlyOrders || 'Not shared'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={selected.status} />
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selected.source}</dd>
              </div>
              <div>
                <dt>Consent</dt>
                <dd>
                  {selected.consentGiven
                    ? (selected.consentText ?? 'Given')
                    : 'Not given'}
                </dd>
              </div>
              <div>
                <dt>UTM source</dt>
                <dd>{selected.utmSource || '—'}</dd>
              </div>
              <div>
                <dt>UTM campaign</dt>
                <dd>{selected.utmCampaign || '—'}</dd>
              </div>
              {selected.convertedTenant ? (
                <div>
                  <dt>Converted to tenant</dt>
                  <dd>
                    <Link
                      to="/tenants/$tenantId"
                      params={{ tenantId: selected.convertedTenant.id }}
                    >
                      {selected.convertedTenant.name} (
                      {selected.convertedTenant.slug})
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
            <h3 className="subhead">Message</h3>
            <p className="muted-note muted-note--prewrap">
              {selected.message || 'No message.'}
            </p>
            <div className="inline-form">
              <label>
                Status
                <select
                  value={nextStatus}
                  onChange={(event) =>
                    setNextStatus(event.target.value as LeadStatus)
                  }
                  disabled={busy}
                >
                  {LEAD_TRIAGE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {leadStatusLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {/* One dialog footer (LE4): Update status [accent] +
                Convert [secondary] + Close [ghost]. */}
            <div className="form-actions">
              <button
                type="button"
                className="button button--accent"
                disabled={
                  busy || !nextStatus || nextStatus === selected.status
                }
                onClick={() =>
                  nextStatus &&
                  void setLeadStatus(selected, nextStatus as LeadStatus)
                }
              >
                {busy ? 'Saving…' : 'Update status'}
              </button>
              {canConvert && !selected.convertedTenant ? (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(null);
                    void navigate({
                      to: '/tenants/new',
                      search: { leadId: selected.id },
                    });
                  }}
                >
                  Convert to tenant
                </button>
              ) : null}
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
