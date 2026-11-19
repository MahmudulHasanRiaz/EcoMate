import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth';
import {
  adDispatchStatusLabel,
  adDispatchTone,
  adPlatformLabel,
} from '../lib/ad-dispatch';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import {
  isLeadOverdue,
  leadContactLabel,
  LEAD_STATUSES,
  LEAD_TRIAGE_STATUSES,
  leadStatusLabel,
  leadsQueryString,
} from '../lib/leads';
import type { AdDispatch, Lead, LeadAssignee, LeadStatus, Page } from '../types';
import {
  EmptyState,
  ErrorNote,
  Modal,
  Pager,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../components/ui';

/** Format an ISO date for a datetime-local input (local time). */
function toLocalInputValue(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function LeadsPage() {
  const { api, session } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Page<Lead> | null>(null);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [kanban, setKanban] = useState<Record<
    string,
    Page<Lead> | null
  > | null>(null);
  const [kanbanLoading, setKanbanLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [nextStatus, setNextStatus] = useState<LeadStatus | ''>('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Ad dispatch sync status for the open lead (CMS batch 2, item 21).
  const [dispatches, setDispatches] = useState<AdDispatch[] | null>(null);
  const [dispatchesLoading, setDispatchesLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Follow-up drawer state (Batch 2, item 12): the assignee roster is
  // loaded once, when the first lead is opened; the three drafts are
  // re-synced from the selected lead on every open.
  const [assignees, setAssignees] = useState<LeadAssignee[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [draftAssignee, setDraftAssignee] = useState('');
  const [draftFollowUp, setDraftFollowUp] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  // Export is SUPERADMIN/BILLING-only on the API (bulk PII, same rule
  // as the audit export); convert is SUPERADMIN/BILLING/SUPPORT.
  // Hide the buttons for roles that would 403 instead of showing them.
  const role = session?.user.role ?? '';
  const canExport = role === 'SUPERADMIN' || role === 'BILLING';
  const canConvert =
    role === 'SUPERADMIN' || role === 'BILLING' || role === 'SUPPORT';

  const load = () => {
    setLoading(true);
    api(
      `/leads${leadsQueryString({ status, search, page, limit, overdue: overdueOnly || undefined })}`,
    )
      .then((response) => readJson<Page<Lead>>(response))
      .then((result) => setData(result))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  // Kanban (Batch 2, item 13): one list call per status column, on the
  // existing list API — each call's meta.total is the column count.
  // The search + overdue filters apply to the board too; the status
  // dropdown does not (the board IS the status view).
  const loadKanban = () => {
    setKanbanLoading(true);
    Promise.all(
      LEAD_STATUSES.map((columnStatus) =>
        api(
          `/leads${leadsQueryString({ status: columnStatus, search, limit: 100, overdue: overdueOnly || undefined })}`,
        )
          .then((response) => readJson<Page<Lead>>(response))
          .then(
            (result) =>
              [columnStatus, result] as [LeadStatus, Page<Lead>],
          ),
      ),
    )
      .then((entries) => setKanban(Object.fromEntries(entries)))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setKanbanLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, status, search, overdueOnly, page, limit]);

  useEffect(() => {
    if (view === 'kanban') loadKanban();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, view, search, overdueOnly]);

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
    // Follow-up drafts re-sync from the open lead (Batch 2, item 12).
    setDraftAssignee(selected.assignedToId ?? '');
    setDraftFollowUp(toLocalInputValue(selected.followUpAt));
    setDraftNotes(selected.internalNotes ?? '');
  }, [selected]);

  // Load the assignee roster once, when the first lead is opened.
  useEffect(() => {
    if (!selected || assignees !== null) return;
    api('/leads/assignees')
      .then((response) => readJson<LeadAssignee[]>(response))
      .then((result) => setAssignees(result))
      .catch((err) => setRosterError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, selected]);

  // Ad dispatch status for the open lead (CMS batch 2, item 21).
  // Reloads whenever the selected lead changes — including after a
  // status update, which may have enqueued a validated-mode dispatch.
  useEffect(() => {
    if (!selected) {
      setDispatches(null);
      setDispatchError(null);
      return;
    }
    setDispatchesLoading(true);
    setDispatchError(null);
    api(`/ad-dispatch/leads/${selected.id}`)
      .then((response) => readJson<AdDispatch[]>(response))
      .then((result) => setDispatches(result))
      .catch((err) => {
        // A dispatch-list failure must not break the lead drawer —
        // the error shows inline in the ad section instead.
        setDispatches([]);
        setDispatchError(errorMessage(err));
      })
      .finally(() => setDispatchesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function retryDispatch(dispatch: AdDispatch) {
    if (!selected) return;
    setRetryingId(dispatch.id);
    setError(null);
    try {
      await api(`/ad-dispatch/${dispatch.id}/retry`, {
        method: 'POST',
      }).then((r) => readJson(r));
      setNotice(
        `${adPlatformLabel(dispatch.platform)} dispatch requeued — it will send on the next run.`,
      );
      const result = await api(`/ad-dispatch/leads/${selected.id}`).then(
        (r) => readJson<AdDispatch[]>(r),
      );
      setDispatches(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRetryingId(null);
    }
  }

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
      // Refresh the open modal only when it shows this lead — a kanban
      // move must NOT pop the modal open (the board is the context).
      if (selected?.id === lead.id) setSelected(updated);
      load();
      if (view === 'kanban') loadKanban();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Save the follow-up drawer (Batch 2, item 12): only the fields that
  // changed are sent, each to its own endpoint; the modal then
  // refreshes from a fresh detail read so assignee name + dates match
  // the server. An empty follow-up date clears the follow-up.
  async function saveFollowUp(lead: Lead) {
    setSavingFollowUp(true);
    setError(null);
    try {
      const nextAssignee = draftAssignee || null;
      if (nextAssignee !== (lead.assignedToId ?? null)) {
        await api(`/leads/${lead.id}/assign`, {
          method: 'PATCH',
          body: JSON.stringify({ assignedToId: nextAssignee }),
        }).then((response) => readJson<Lead>(response));
      }
      const nextFollowUp = draftFollowUp
        ? new Date(draftFollowUp).toISOString()
        : null;
      // Compare at minute precision: the datetime-local input drops
      // seconds, so an ISO comparison would report a change on every
      // open for a date stored with non-zero seconds.
      if (draftFollowUp !== toLocalInputValue(lead.followUpAt)) {
        await api(`/leads/${lead.id}/follow-up`, {
          method: 'PATCH',
          body: JSON.stringify({ followUpAt: nextFollowUp }),
        }).then((response) => readJson<Lead>(response));
      }
      const nextNotes = draftNotes.trim() ? draftNotes.trim() : null;
      if (nextNotes !== (lead.internalNotes ?? null)) {
        await api(`/leads/${lead.id}/notes`, {
          method: 'PATCH',
          body: JSON.stringify({ internalNotes: nextNotes }),
        }).then((response) => readJson<Lead>(response));
      }
      const refreshed = await api(`/leads/${lead.id}`).then((response) =>
        readJson<Lead>(response),
      );
      setSelected(refreshed);
      setNotice(`Follow-up details saved for ${lead.name}.`);
      load();
      if (view === 'kanban') loadKanban();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingFollowUp(false);
    }
  }

  async function exportLeads() {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api(
        `/leads/export${leadsQueryString({ status, search, overdue: overdueOnly || undefined })}`,
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
        {overdueOnly ? (
          <span className="filter-chip filter-chip--active">
            Overdue only
            <button
              type="button"
              aria-label="Clear overdue filter"
              onClick={() => {
                setOverdueOnly(false);
                setPage(1);
              }}
            >
              ×
            </button>
          </span>
        ) : null}
        {view === 'list' ? (
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
        ) : null}
        <button
          type="button"
          className={
            overdueOnly ? 'button button--accent' : 'button'
          }
          aria-pressed={overdueOnly}
          onClick={() => {
            setOverdueOnly((current) => !current);
            setPage(1);
          }}
        >
          Overdue only
        </button>
        <div
          className="segmented"
          role="group"
          aria-label="Leads view"
        >
          <button
            type="button"
            className={
              view === 'list' ? 'button button--accent' : 'button'
            }
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={
              view === 'kanban' ? 'button button--accent' : 'button'
            }
            aria-pressed={view === 'kanban'}
            onClick={() => setView('kanban')}
          >
            Kanban
          </button>
        </div>
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

      {view === 'list' ? (
        <>
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
                    <th>Assigned to</th>
                    <th>Follow-up</th>
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
                      <td>{lead.assignedTo?.name || '—'}</td>
                      <td>
                        {lead.followUpAt ? (
                          <>
                            {formatDate(lead.followUpAt)}
                            {isLeadOverdue(lead) ? (
                              <span className="badge badge--danger">
                                Overdue
                              </span>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
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
        </>
      ) : (
        <>
          {kanbanLoading && !kanban ? <Skeleton /> : null}
          {kanban ? (
            <div className="kanban">
              {LEAD_STATUSES.map((columnStatus) => {
                const column = kanban[columnStatus];
                const rows = column?.data ?? [];
                const total = column?.meta.total ?? 0;
                return (
                  <section
                    key={columnStatus}
                    className="kanban-column"
                    aria-label={`${leadStatusLabel(columnStatus)} column`}
                  >
                    <div className="kanban-column-head">
                      <h2>{leadStatusLabel(columnStatus)}</h2>
                      <span className="kanban-count">{total}</span>
                    </div>
                    {rows.length === 0 ? (
                      <p className="muted-note">No leads</p>
                    ) : (
                      <ul className="kanban-cards">
                        {rows.map((lead) => (
                          <li key={lead.id} className="kanban-card">
                            <button
                              type="button"
                              className="table-link kanban-card-name"
                              onClick={() => setSelected(lead)}
                            >
                              {lead.name}
                            </button>
                            <span className="sub">{lead.contact}</span>
                            {lead.assignedTo ? (
                              <span className="sub">
                                Assigned: {lead.assignedTo.name}
                              </span>
                            ) : null}
                            {lead.followUpAt ? (
                              <span className="sub">
                                Follow-up {formatDate(lead.followUpAt)}
                                {isLeadOverdue(lead) ? (
                                  <span className="badge badge--danger">
                                    Overdue
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            {canConvert ? (
                              <label className="kanban-move">
                                <span className="sr-only">
                                  Move {lead.name} to
                                </span>
                                <select
                                  value=""
                                  aria-label={`Move ${lead.name} to another status`}
                                  disabled={busy}
                                  onChange={(event) => {
                                    const next = event.target
                                      .value as LeadStatus;
                                    if (next) void setLeadStatus(lead, next);
                                  }}
                                >
                                  <option value="">Move to…</option>
                                  {LEAD_TRIAGE_STATUSES.filter(
                                    (value) => value !== lead.status,
                                  ).map((value) => (
                                    <option key={value} value={value}>
                                      {leadStatusLabel(value)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {column && column.meta.total > rows.length ? (
                      <p className="muted-note">
                        Showing first {rows.length} of {column.meta.total}.
                      </p>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : null}
        </>
      )}

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
                <dt>Assigned to</dt>
                <dd>{selected.assignedTo?.name || 'Unassigned'}</dd>
              </div>
              <div>
                <dt>Follow-up</dt>
                <dd>
                  {selected.followUpAt
                    ? formatDateTime(selected.followUpAt)
                    : 'None scheduled'}
                  {isLeadOverdue(selected) ? (
                    <span className="badge badge--danger">Overdue</span>
                  ) : null}
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
            {/* Follow-up drawer (Batch 2, item 12): assignee + follow-up
                date + internal notes. READONLY cannot read leads at all,
                so everyone who sees this modal can save it. */}
            <h3 className="subhead">Follow-up</h3>
            {rosterError ? (
              <p className="muted-note">
                Could not load the operator roster: {rosterError}
              </p>
            ) : null}
            <div className="inline-form">
              <label>
                Assigned to
                <select
                  value={draftAssignee}
                  onChange={(event) => setDraftAssignee(event.target.value)}
                  disabled={savingFollowUp || assignees === null}
                  aria-label="Assign lead to operator"
                >
                  <option value="">Unassigned</option>
                  {(assignees ?? []).map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.name} ({operator.email})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Follow-up date
                <input
                  type="datetime-local"
                  value={draftFollowUp}
                  onChange={(event) => setDraftFollowUp(event.target.value)}
                  disabled={savingFollowUp}
                  aria-label="Follow-up date and time"
                />
              </label>
            </div>
            <label className="field">
              Internal notes
              <textarea
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.target.value)}
                disabled={savingFollowUp}
                rows={4}
                maxLength={5000}
                placeholder="Operator-only working notes — never shown to the lead."
                aria-label="Internal notes"
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button button--accent"
                disabled={
                  savingFollowUp ||
                  ((draftAssignee || null) ===
                    (selected.assignedToId ?? null) &&
                    draftFollowUp ===
                      toLocalInputValue(selected.followUpAt) &&
                    (draftNotes.trim() ? draftNotes.trim() : null) ===
                      (selected.internalNotes ?? null))
                }
                onClick={() => void saveFollowUp(selected)}
              >
                {savingFollowUp ? 'Saving…' : 'Save follow-up'}
              </button>
            </div>
            {/* Ad tracking sync status (CMS batch 2, item 21): one row
                per platform dispatch — status, attempts, error text,
                and a Retry button for terminal failures. */}
            <h3 className="subhead">Ad tracking</h3>
            {dispatchesLoading && dispatches === null ? (
              <p className="muted-note">Loading ad dispatch status…</p>
            ) : dispatchError ? (
              <p className="muted-note">
                Could not load ad dispatch status: {dispatchError}
              </p>
            ) : dispatches && dispatches.length === 0 ? (
              <p className="muted-note">
                No ad dispatches for this lead yet. Dispatches appear
                when a configured platform is in instant mode, or when
                the lead reaches a platform&apos;s trigger status.
              </p>
            ) : (
              (dispatches ?? []).map((dispatch) => (
                <div key={dispatch.id}>
                  <dl className="facts">
                    <div>
                      <dt>Platform</dt>
                      <dd>
                        {adPlatformLabel(dispatch.platform)} ·{' '}
                        {dispatch.eventName}
                      </dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span
                          className={`badge badge--${adDispatchTone(dispatch.status)}`}
                        >
                          {adDispatchStatusLabel(dispatch.status)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Attempts</dt>
                      <dd>
                        {dispatch.attempts}
                        {dispatch.sentAt
                          ? ` · sent ${formatDateTime(dispatch.sentAt)}`
                          : dispatch.nextRetryAt
                            ? ` · retries ${formatDateTime(dispatch.nextRetryAt)}`
                            : ''}
                      </dd>
                    </div>
                    {dispatch.lastError ? (
                      <div>
                        <dt>Error</dt>
                        <dd>{dispatch.lastError}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {dispatch.status === 'failed' && canConvert ? (
                    <div className="progress-actions">
                      <button
                        type="button"
                        className="button"
                        disabled={retryingId === dispatch.id}
                        onClick={() => void retryDispatch(dispatch)}
                      >
                        {retryingId === dispatch.id
                          ? 'Requeuing…'
                          : 'Retry dispatch'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
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
