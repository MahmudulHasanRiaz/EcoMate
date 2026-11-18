import { useCallback, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime, formatStatus } from '../lib/format';
import type {
  DomainConfig,
  Page,
  Tenant,
  TenantDomain,
} from '../types';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../components/ui';

const DOMAIN_STATUSES = ['', 'PENDING', 'VERIFIED', 'FAILED'];

export function DomainsPage() {
  const { api } = useAuth();
  const [config, setConfig] = useState<DomainConfig | null>(null);
  const [domains, setDomains] = useState<Page<TenantDomain> | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [baseDomains, setBaseDomains] = useState('');
  const [fallbackDomain, setFallbackDomain] = useState('');
  const [customDomainCname, setCustomDomainCname] = useState('');
  const [allowExternalFallback, setAllowExternalFallback] = useState(false);
  const [primaryHealthy, setPrimaryHealthy] = useState(true);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [newTenantId, setNewTenantId] = useState('');
  const [newHost, setNewHost] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<TenantDomain | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const [nextConfig, nextDomains, tenantPage] = await Promise.all([
        api('/domains/config').then((r) => readJson<DomainConfig>(r)),
        api(`/domains/tenants?${params.toString()}`).then((r) =>
          readJson<Page<TenantDomain>>(r),
        ),
        api('/tenants?limit=100').then((r) => readJson<Page<Tenant>>(r)),
      ]);
      setConfig(nextConfig);
      setDomains(nextDomains);
      setTenants(tenantPage.data);
      setPrimaryDomain(nextConfig.primaryDomain);
      setBaseDomains(nextConfig.baseDomains.join(', '));
      setFallbackDomain(nextConfig.fallbackDomain ?? '');
      setCustomDomainCname(nextConfig.customDomainCname);
      setAllowExternalFallback(nextConfig.allowExternalFallback);
      setPrimaryHealthy(nextConfig.primaryHealthy);
      if (!newTenantId && tenantPage.data[0]) {
        setNewTenantId(tenantPage.data[0].id);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [api, status, search]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  async function saveConfig() {
    setBusy('config');
    setError(null);
    setNotice(null);
    try {
      const response = await api('/domains/config', {
        method: 'PATCH',
        body: JSON.stringify({
          primaryDomain: primaryDomain.trim(),
          baseDomains: baseDomains
            .split(',')
            .map((domain) => domain.trim())
            .filter(Boolean),
          fallbackDomain: fallbackDomain.trim(),
          customDomainCname: customDomainCname.trim(),
          allowExternalFallback,
          primaryHealthy,
        }),
      });
      const next = await readJson<DomainConfig>(response);
      setConfig(next);
      setNotice('Domain configuration saved and applied at runtime.');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function addDomain() {
    if (!newTenantId || !newHost.trim()) {
      setError('Choose a tenant and enter a hostname.');
      return;
    }
    setBusy('add');
    setError(null);
    setNotice(null);
    try {
      const response = await api(`/tenants/${newTenantId}/domains`, {
        method: 'POST',
        body: JSON.stringify({ host: newHost.trim() }),
      });
      const data = await readJson<{ dns?: unknown }>(response);
      setNotice(
        data.dns
          ? 'Domain added. Create the TXT record shown below, then re-check.'
          : 'Domain added.',
      );
      setNewHost('');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function recheck(domain: TenantDomain) {
    setBusy(`check:${domain.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await api(`/domains/tenants/${domain.id}/recheck`, {
        method: 'POST',
      });
      const result = await readJson<{ verified: boolean; domain: TenantDomain }>(
        response,
      );
      setNotice(
        result.verified
          ? `${domain.host} verified.`
          : `${domain.host} is not ready yet. Check the DNS records and try again.`,
      );
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeDomain(domain: TenantDomain) {
    if (!domain.tenantId) return;
    setBusy(`remove:${domain.id}`);
    setError(null);
    try {
      const response = await api(
        `/tenants/${domain.tenantId}/domains/${domain.id}`,
        { method: 'DELETE' },
      );
      await readJson<unknown>(response);
      setNotice(`${domain.host} removed.`);
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Domains"
        title="Routing and TLS"
        description="Platform base domains, tenant hosts and custom-domain verification."
      />

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {!config && busy ? <Skeleton /> : null}

      {config ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Domain configuration</h2>
              <p>
                Persisted in PlatformSetting.domains and applied without a
                deploy. Primary must lead the base list.
              </p>
            </div>
          </div>
          <div className="domain-config-grid">
            <label className="inline-field">
              <span>Primary domain</span>
              <input
                value={primaryDomain}
                onChange={(event) => setPrimaryDomain(event.target.value)}
                aria-label="Primary domain"
              />
            </label>
            <label className="inline-field">
              <span>Base domains (comma separated)</span>
              <input
                value={baseDomains}
                onChange={(event) => setBaseDomains(event.target.value)}
                aria-label="Base domains"
              />
            </label>
            <label className="inline-field">
              <span>Fallback domain</span>
              <input
                value={fallbackDomain}
                onChange={(event) => setFallbackDomain(event.target.value)}
                placeholder="Optional"
                aria-label="Fallback domain"
              />
            </label>
            <label className="inline-field">
              <span>Custom-domain CNAME target</span>
              <input
                value={customDomainCname}
                onChange={(event) => setCustomDomainCname(event.target.value)}
                aria-label="Custom domain CNAME"
              />
            </label>
          </div>
          <div className="domain-flags">
            <label>
              <input
                type="checkbox"
                checked={allowExternalFallback}
                onChange={(event) =>
                  setAllowExternalFallback(event.target.checked)
                }
              />
              Allow a fallback outside the base list
            </label>
            <label>
              <input
                type="checkbox"
                checked={primaryHealthy}
                onChange={(event) => setPrimaryHealthy(event.target.checked)}
              />
              Primary domain is healthy
            </label>
          </div>
          <dl className="facts">
            <div>
              <dt>Landing host</dt>
              <dd className="mono">{config.platformHosts.landing}</dd>
            </div>
            <div>
              <dt>Platform admin host</dt>
              <dd className="mono">{config.platformHosts.platformAdmin}</dd>
            </div>
            <div>
              <dt>Platform API host</dt>
              <dd className="mono">{config.platformHosts.platformApi}</dd>
            </div>
          </dl>
          <div className="progress-actions">
            <button
              type="button"
              className="button button--accent"
              onClick={saveConfig}
              disabled={!!busy}
            >
              {busy === 'config' ? 'Saving…' : 'Save configuration'}
            </button>
          </div>
        </section>
      ) : null}

      {config ? (
        <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Add tenant domain</h2>
            <p>
              Custom hosts are verified by TXT + CNAME before routing and TLS.
            </p>
          </div>
        </div>
        <div className="domain-add">
          <label className="inline-field">
            <span>Tenant</span>
            <select
              value={newTenantId}
              onChange={(event) => setNewTenantId(event.target.value)}
              aria-label="Domain tenant"
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.slug})
                </option>
              ))}
            </select>
          </label>
          <label className="inline-field">
            <span>Hostname</span>
            <input
              value={newHost}
              onChange={(event) => setNewHost(event.target.value)}
              placeholder="shop.example.com"
              aria-label="New domain host"
            />
          </label>
          <button
            type="button"
            className="button button--accent"
            onClick={addDomain}
            disabled={!!busy}
          >
            {busy === 'add' ? 'Adding…' : 'Add domain'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Tenant domains</h2>
            <p>Verification and TLS state across every workspace.</p>
          </div>
        </div>
        <div className="toolbar">
          <form
            className="toolbar-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(draftSearch.trim());
            }}
          >
            <input
              value={draftSearch}
              onChange={(event) => {
                const next = event.target.value;
                setDraftSearch(next);
                if (next.trim() === '' && search !== '') {
                  setSearch('');
                }
              }}
              placeholder="Search host or tenant"
              aria-label="Search domains"
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
                  setDraftSearch('');
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
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Domain status filter"
            >
              {DOMAIN_STATUSES.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? formatStatus(value) : 'All statuses'}
                </option>
              ))}
            </select>
          </label>
        </div>
        {domains && domains.data.length === 0 ? (
          <EmptyState icon={Globe} title="No domains match this filter">
            Try a different search or status.
          </EmptyState>
        ) : null}
        {domains && domains.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Tenant</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>TLS</th>
                  <th>Last checked</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {domains.data.map((domain) => (
                  <tr key={domain.id}>
                    <td>
                      <span className="mono">{domain.host}</span>
                      {domain.status === 'PENDING' &&
                      domain.verificationToken ? (
                        <span className="sub">
                          TXT _ecomate-verify.{domain.host} ·{' '}
                          {domain.verificationToken.slice(0, 12)}…
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {domain.tenant ? (
                        <Link
                          to="/tenants/$tenantId"
                          params={{ tenantId: domain.tenant.id }}
                          className="table-link"
                        >
                          {domain.tenant.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                      <span className="sub">{domain.tenant?.slug}</span>
                    </td>
                    <td>{domain.type}</td>
                    <td>
                      <StatusBadge status={domain.status} />
                    </td>
                    <td>
                      {domain.tlsStatus ? (
                        <StatusBadge status={domain.tlsStatus} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{formatDateTime(domain.lastCheckedAt)}</td>
                    <td>
                      <div className="row-action">
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => recheck(domain)}
                          disabled={!!busy}
                        >
                          {busy === `check:${domain.id}`
                            ? 'Checking…'
                            : 'Re-check'}
                        </button>
                        {domain.type === 'CUSTOM' ? (
                          <button
                            type="button"
                            className="button button--danger"
                            onClick={() => setConfirmRemove(domain)}
                            disabled={!!busy}
                          >
                            {busy === `remove:${domain.id}`
                              ? 'Removing…'
                              : 'Remove'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {confirmRemove ? (
        <ConfirmDialog
          open
          title={`Remove ${confirmRemove.host}?`}
          body="Traffic to this host will stop resolving."
          confirmLabel="Remove domain"
          danger
          busy={busy === `remove:${confirmRemove.id}`}
          onConfirm={async () => {
            const domain = confirmRemove;
            setConfirmRemove(null);
            await removeDomain(domain);
          }}
          onClose={() => setConfirmRemove(null)}
        />
      ) : null}
        </>
      ) : null}
    </>
  );
}
