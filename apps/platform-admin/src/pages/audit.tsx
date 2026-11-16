import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { ErrorNote, Loading, PageHeader } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { auditPayloadText, auditQueryString } from '../lib/audit';
import { formatDateTime } from '../lib/format';
import type { AuditLogEntry, Page } from '../types';

export function AuditPage() {
  const { api } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [actorId, setActorId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const filters = { action, entity, actorId, tenantId, from, to, search };

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const result = await api(
        `/audit${auditQueryString({ ...filters, page, limit: 20 })}`,
      ).then((r) => readJson<Page<AuditLogEntry>>(r));
      setEntries(result.data);
      setMeta(result.meta);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
    // Filters are read from state at call time; the effect below re-runs
    // on refresh/page changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, page, refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setRefresh((n) => n + 1);
  }

  function clearFilters() {
    setAction('');
    setEntity('');
    setActorId('');
    setTenantId('');
    setFrom('');
    setTo('');
    setSearch('');
    setPage(1);
    setRefresh((n) => n + 1);
  }

  async function download(format: 'csv' | 'json') {
    setBusy(`export-${format}`);
    setError(null);
    setNotice(null);
    try {
      const response = await api(
        `/audit/export${auditQueryString({ ...filters, format })}`,
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
      link.download = match?.[1] ?? `audit-export.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Audit export downloaded (${format.toUpperCase()}).`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="Audit log"
        description="Every audited platform action, newest first. Exports are capped at 5,000 rows."
        actions={
          <>
            <button
              type="button"
              onClick={() => void download('csv')}
              disabled={busy === 'export-csv'}
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void download('json')}
              disabled={busy === 'export-json'}
            >
              Export JSON
            </button>
          </>
        }
      />

      {notice ? <div className="notice notice--success">{notice}</div> : null}
      {error ? <ErrorNote message={error} /> : null}

      <section className="panel">
        <h2>Filters</h2>
        <form className="inline-form" onSubmit={applyFilters}>
          <label>
            Action
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="users.create"
            />
          </label>
          <label>
            Entity
            <input
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              placeholder="PlatformUser"
            />
          </label>
          <label>
            Actor ID
            <input
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="Platform user UUID"
            />
          </label>
          <label>
            Tenant ID
            <input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="Tenant UUID"
            />
          </label>
          <label>
            From
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Action or entity"
            />
          </label>
          <div className="form-actions">
            <button type="submit">Apply filters</button>
            <button type="button" onClick={clearFilters}>
              Clear
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Entries</h2>
        {busy === 'load' ? <Loading label="Loading audit entries…" /> : null}
        {entries.length === 0 && busy !== 'load' ? (
          <p className="muted-note">No audit entries match these filters.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Tenant</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="clickable-row"
                  onClick={() =>
                    setExpandedId(expandedId === entry.id ? null : entry.id)
                  }
                >
                  <td>{formatDateTime(entry.createdAt)}</td>
                  <td>
                    {entry.actor
                      ? `${entry.actor.name} (${entry.actor.email})`
                      : entry.actorId ?? 'System'}
                  </td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td>
                    {entry.entity}
                    {entry.entityId ? (
                      <div className="muted-note">{entry.entityId}</div>
                    ) : null}
                  </td>
                  <td>{entry.tenant ? entry.tenant.slug : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {expandedId ? (
          <div className="detail-panel">
            {(() => {
              const entry = entries.find((e) => e.id === expandedId);
              if (!entry) return null;
              return (
                <>
                  <h3>{entry.action}</h3>
                  <dl className="detail-list">
                    <dt>ID</dt>
                    <dd>{entry.id}</dd>
                    <dt>Actor type</dt>
                    <dd>{entry.actorType}</dd>
                    <dt>IP</dt>
                    <dd>{entry.ip ?? '—'}</dd>
                    <dt>User agent</dt>
                    <dd>{entry.userAgent ?? '—'}</dd>
                  </dl>
                  <h4>Before</h4>
                  <pre>{auditPayloadText(entry.before)}</pre>
                  <h4>After</h4>
                  <pre>{auditPayloadText(entry.after)}</pre>
                  <button type="button" onClick={() => setExpandedId(null)}>
                    Close details
                  </button>
                </>
              );
            })()}
          </div>
        ) : null}

        <div className="pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
              setRefresh((n) => n + 1);
            }}
          >
            Previous
          </button>
          <span>
            Page {meta.page} of {meta.totalPages} ({meta.total} entries)
          </span>
          <button
            type="button"
            disabled={page >= meta.totalPages}
            onClick={() => {
              setPage((p) => p + 1);
              setRefresh((n) => n + 1);
            }}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
