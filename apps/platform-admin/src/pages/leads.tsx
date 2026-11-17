import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import {
  leadContactLabel,
  LEAD_STATUSES,
  leadStatusLabel,
  leadsQueryString,
} from '../lib/leads';
import type { Lead, LeadStatus, Page } from '../types';
import {
  ErrorNote,
  Loading,
  Modal,
  PageHeader,
  StatusBadge,
} from '../components/ui';

export function LeadsPage() {
  const { api } = useAuth();
  const [data, setData] = useState<Page<Lead> | null>(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api(`/leads${leadsQueryString({ status, page, limit: 20 })}`)
      .then((response) => readJson<Page<Lead>>(response))
      .then((result) => setData(result))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, status, page]);

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

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Leads"
        description="Contact requests from the landing lead form. Open a lead to read the full message and mark it contacted or closed."
      />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}

      <div className="toolbar">
        <label>
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {leadStatusLabel(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && !data ? <Loading /> : null}
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
            <p className="muted-note">
              {status
                ? 'No leads match this filter.'
                : 'No leads yet. Leads arrive from the landing lead form.'}
            </p>
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
            </dl>
            <h3 className="subhead">Message</h3>
            <p className="muted-note" style={{ whiteSpace: 'pre-wrap' }}>
              {selected.message || 'No message.'}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button button--primary"
                disabled={busy || selected.status === 'CONTACTED'}
                onClick={() => void setLeadStatus(selected, 'CONTACTED')}
              >
                {busy ? 'Saving…' : 'Mark contacted'}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy || selected.status === 'CLOSED'}
                onClick={() => void setLeadStatus(selected, 'CLOSED')}
              >
                {busy ? 'Saving…' : 'Close lead'}
              </button>
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
