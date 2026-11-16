import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  planLabel,
} from '../lib/format';
import {
  barWidth,
  formatLimit,
  formatUsagePercent,
  usageTone,
} from '../lib/usage';
import type {
  Plan,
  PlanVersion,
  Tenant,
  TenantUsage,
  UsageMetricRow,
} from '../types';
import {
  ErrorNote,
  Loading,
  PageHeader,
  StatusBadge,
} from '../components/ui';

interface PlanOption {
  version: PlanVersion;
  planName: string;
}

function filenameFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? null;
}

export function TenantDetailPage() {
  const { tenantId } = useParams({ from: '/tenants/$tenantId' });
  const { api } = useAuth();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planVersionId, setPlanVersionId] = useState('');
  const [planEffectiveAt, setPlanEffectiveAt] = useState<'immediate' | 'next_period'>('immediate');
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(true);
  const [days, setDays] = useState('14');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [impersonationUrl, setImpersonationUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageBusy, setUsageBusy] = useState<string | null>(null);
  const [usageReload, setUsageReload] = useState(0);
  const [overrideInputs, setOverrideInputs] = useState<
    Record<string, string>
  >({});
  const [usageNotice, setUsageNotice] = useState<string | null>(null);

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
  }, [api, tenantId, refresh]);

  useEffect(() => {
    let cancelled = false;
    api('/plans')
      .then((response) => readJson<Plan[]>(response))
      .then((result) => {
        if (cancelled) return;
        const options = result
          .flatMap((plan) =>
            plan.versions
              .filter((version) => !version.archivedAt)
              .map((version) => ({ version, planName: plan.name })),
          )
          .sort((a, b) =>
            `${a.planName} v${a.version.version}`.localeCompare(
              `${b.planName} v${b.version.version}`,
            ),
          );
        setPlans(options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    const current =
      tenant?.subscription?.planVersion ?? tenant?.planVersion ?? null;
    if (current && !planVersionId) setPlanVersionId(current.id);
  }, [tenant, planVersionId]);

  useEffect(() => {
    let cancelled = false;
    api(`/usage/tenants/${tenantId}?days=14`)
      .then((response) => readJson<TenantUsage>(response))
      .then((result) => {
        if (cancelled) return;
        setUsage(result);
        setUsageError(null);
        setOverrideInputs(
          Object.fromEntries(
            result.metrics.map((metric) => [
              metric.key,
              metric.override === null ? '' : String(metric.override),
            ]),
          ),
        );
      })
      .catch((err) => {
        if (!cancelled) setUsageError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantId, usageReload]);

  async function runAction(
    key: string,
    action: () => Promise<void>,
    success: string,
  ) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    setImpersonationUrl(null);
    setActionError(null);
    try {
      await action();
      setNotice(success);
      setRefresh((value) => value + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function applyUsage(result: TenantUsage) {
    setUsage(result);
    setOverrideInputs(
      Object.fromEntries(
        result.metrics.map((metric) => [
          metric.key,
          metric.override === null ? '' : String(metric.override),
        ]),
      ),
    );
  }

  async function refreshUsage() {
    if (usageBusy) return;
    setUsageBusy('refresh');
    setUsageError(null);
    setUsageNotice(null);
    try {
      const response = await api(`/usage/tenants/${tenantId}/refresh`, {
        method: 'POST',
      });
      applyUsage(await readJson<TenantUsage>(response));
      setUsageNotice('Live usage collected and snapshotted.');
    } catch (err) {
      setUsageError(errorMessage(err));
    } finally {
      setUsageBusy(null);
    }
  }

  async function saveOverride(metric: UsageMetricRow) {
    if (usageBusy) return;
    const raw = (overrideInputs[metric.key] ?? '').trim();
    const value = Number(raw);
    if (
      raw === '' ||
      !Number.isFinite(value) ||
      value < 0 ||
      !Number.isInteger(value)
    ) {
      setUsageError('An override must be a whole number of 0 or more.');
      return;
    }

    setUsageBusy(`save:${metric.key}`);
    setUsageError(null);
    setUsageNotice(null);
    try {
      const response = await api(
        `/usage/tenants/${tenantId}/overrides/${metric.key}`,
        {
          method: 'PUT',
          body: JSON.stringify({ value }),
        },
      );
      const result = await readJson<{
        override: unknown;
        refresh: { ok: boolean; error?: string };
      }>(response);
      setUsageNotice(
        result.refresh.ok
          ? `${metric.label} override saved. The tenant registry was refreshed immediately.`
          : `${metric.label} override saved. Immediate tenant refresh failed (${result.refresh.error}); it applies on the next 60s registry poll.`,
      );
      setUsageReload((current) => current + 1);
    } catch (err) {
      setUsageError(errorMessage(err));
    } finally {
      setUsageBusy(null);
    }
  }

  async function clearOverride(metric: UsageMetricRow) {
    if (usageBusy) return;
    setUsageBusy(`clear:${metric.key}`);
    setUsageError(null);
    setUsageNotice(null);
    try {
      const response = await api(
        `/usage/tenants/${tenantId}/overrides/${metric.key}`,
        { method: 'DELETE' },
      );
      const result = await readJson<{
        cleared: boolean;
        refresh: { ok: boolean; error?: string };
      }>(response);
      setUsageNotice(
        result.refresh.ok
          ? `${metric.label} override cleared; the plan value applies again.`
          : `${metric.label} override cleared. Immediate tenant refresh failed (${result.refresh.error}); it applies on the next 60s registry poll.`,
      );
      setUsageReload((current) => current + 1);
    } catch (err) {
      setUsageError(errorMessage(err));
    } finally {
      setUsageBusy(null);
    }
  }

  async function changePlan() {
    if (!planVersionId) return;
    await runAction(
      'plan',
      async () => {
        const response = await api(`/tenants/${tenantId}/change-plan`, {
          method: 'POST',
          body: JSON.stringify({ planVersionId, effectiveAt: planEffectiveAt }),
        });
        await readJson<unknown>(response);
      },
      planEffectiveAt === 'next_period'
        ? 'Plan change scheduled for the next billing period.'
        : 'Plan changed and the entitlement snapshot was refreshed.',
    );
  }

  async function cancelTenant() {
    await runAction(
      'cancel',
      async () => {
        const response = await api(`/tenants/${tenantId}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ atPeriodEnd: cancelAtPeriodEnd }),
        });
        await readJson<unknown>(response);
      },
      cancelAtPeriodEnd
        ? 'Subscription cancels at the end of the current period.'
        : 'Subscription cancelled immediately.',
    );
  }

  async function extendTrial() {
    const value = Number(days);
    if (!Number.isFinite(value) || value < 1 || value > 365) {
      setActionError('Trial extension must be between 1 and 365 days.');
      return;
    }
    await runAction(
      'trial',
      async () => {
        const response = await api(`/tenants/${tenantId}/extend-trial`, {
          method: 'POST',
          body: JSON.stringify({ days: Math.floor(value) }),
        });
        await readJson<unknown>(response);
      },
      'Trial extended.',
    );
  }

  async function toggleSuspension() {
    if (!tenant) return;
    const next = tenant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    await runAction(
      'status',
      async () => {
        const response = await api(`/tenants/${tenantId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: next,
            reason: 'Changed from the SaaS console',
          }),
        });
        await readJson<unknown>(response);
      },
      next === 'SUSPENDED' ? 'Tenant suspended.' : 'Tenant reactivated.',
    );
  }

  async function restoreTenant() {
    await runAction(
      'restore',
      async () => {
        const response = await api(`/tenants/${tenantId}/restore`, {
          method: 'POST',
        });
        await readJson<unknown>(response);
      },
      'Tenant restored.',
    );
  }

  async function resetOwnerPassword() {
    if (!tenant) return;
    await runAction(
      'reset',
      async () => {
        const response = await api(
          `/tenants/${tenantId}/reset-owner-password`,
          { method: 'POST' },
        );
        await readJson<unknown>(response);
      },
      `Reset code sent to ${tenant.ownerEmail}.`,
    );
  }

  async function impersonateTenant() {
    if (!tenant) return;
    if (
      !window.confirm(
        `Sign in to "${tenant.name}" as its owner for 15 minutes? This is audited.`,
      )
    ) {
      return;
    }
    setBusy('impersonate');
    setNotice(null);
    setImpersonationUrl(null);
    setActionError(null);
    try {
      const response = await api(`/tenants/${tenantId}/impersonate`, {
        method: 'POST',
      });
      const data = await readJson<{ url: string }>(response);
      const popup = window.open(data.url, '_blank');
      if (popup) popup.opener = null;
      setNotice(
        'Impersonation link issued for 15 minutes. It can be used once.',
      );
      setImpersonationUrl(data.url);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function exportTenant() {
    if (!tenant) return;
    await runAction(
      'export',
      async () => {
        const response = await api(`/tenants/${tenantId}/export`);
        if (!response.ok) {
          await readJson<unknown>(response);
          return;
        }
        const blob = await response.blob();
        const filename =
          filenameFrom(response.headers.get('content-disposition')) ||
          `${tenant.slug}-export.json`;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      'Export downloaded.',
    );
  }

  async function deleteTenant() {
    if (!tenant) return;
    if (
      !window.confirm(
        `Soft-delete "${tenant.name}"? Data stays recoverable for 30 days, then the purge job removes it.`,
      )
    ) {
      return;
    }
    await runAction(
      'delete',
      async () => {
        const response = await api(`/tenants/${tenantId}`, {
          method: 'DELETE',
        });
        await readJson<unknown>(response);
        await navigate({ to: '/tenants' });
      },
      'Tenant soft-deleted.',
    );
  }

  if (loading && !tenant) return <Loading label="Loading tenant…" />;
  if (error) return <ErrorNote message={error} />;
  if (!tenant) return null;

  const version = tenant.subscription?.planVersion ?? tenant.planVersion ?? null;
  const deleted = tenant.status === 'DELETED';

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
        actions={
          <div className="head-actions">
            <StatusBadge status={tenant.status} />
            <button
              type="button"
              className="button button--ghost"
              onClick={exportTenant}
              disabled={!!busy}
            >
              {busy === 'export' ? 'Exporting…' : 'Export'}
            </button>
            {deleted ? (
              <button
                type="button"
                className="button button--ghost"
                onClick={restoreTenant}
                disabled={!!busy}
              >
                {busy === 'restore' ? 'Restoring…' : 'Restore'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={impersonateTenant}
                  disabled={!!busy}
                >
                  {busy === 'impersonate' ? 'Issuing…' : 'Impersonate'}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={toggleSuspension}
                  disabled={!!busy}
                >
                  {busy === 'status'
                    ? 'Updating…'
                    : tenant.status === 'SUSPENDED'
                      ? 'Reactivate'
                      : 'Suspend'}
                </button>
              </>
            )}
            <button
              type="button"
              className="button button--danger"
              onClick={deleteTenant}
              disabled={!!busy || deleted}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      />

      {actionError ? <ErrorNote message={actionError} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
          {impersonationUrl ? (
            <>
              {' '}
              <a href={impersonationUrl} target="_blank" rel="noreferrer">
                Open the impersonated admin
              </a>
              .
            </>
          ) : null}
        </div>
      ) : null}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Operations</h2>
            <p>
              Plan, trial and owner-access actions are audited on the platform.
            </p>
          </div>
        </div>
        <div className="action-grid">
          <div className="action-block">
            <h3>Change plan</h3>
            <p className="muted-note">
              Immediate changes prorate the unused days as credit and start a
              new billing period. Next-period changes apply at renewal.
            </p>
            <select
              value={planVersionId}
              onChange={(event) => setPlanVersionId(event.target.value)}
              disabled={!!busy}
            >
              <option value="">Select a plan version</option>
              {plans.map((option) => (
                <option key={option.version.id} value={option.version.id}>
                  {option.planName} · v{option.version.version} ·{' '}
                  {formatMoney(option.version.price, option.version.currency)}
                </option>
              ))}
            </select>
            <select
              value={planEffectiveAt}
              onChange={(event) =>
                setPlanEffectiveAt(
                  event.target.value as 'immediate' | 'next_period',
                )
              }
              disabled={!!busy}
              aria-label="When the plan change takes effect"
            >
              <option value="immediate">Effective immediately</option>
              <option value="next_period">Effective next period</option>
            </select>
            <button
              type="button"
              className="button"
              onClick={changePlan}
              disabled={!!busy || !planVersionId}
            >
              {busy === 'plan' ? 'Changing…' : 'Change plan'}
            </button>
          </div>

          <div className="action-block action-block--danger">
            <h3>Cancel subscription</h3>
            <p className="muted-note">
              At period end the tenant keeps access until the period closes.
              Immediate cancellation stops access now.
            </p>
            <select
              value={cancelAtPeriodEnd ? 'period' : 'immediate'}
              onChange={(event) =>
                setCancelAtPeriodEnd(event.target.value === 'period')
              }
              disabled={!!busy}
              aria-label="When the cancellation takes effect"
            >
              <option value="period">Cancel at period end</option>
              <option value="immediate">Cancel immediately</option>
            </select>
            <button
              type="button"
              className="button button--danger"
              onClick={cancelTenant}
              disabled={
                !!busy ||
                !tenant?.subscription ||
                tenant.subscription.status === 'CANCELLED' ||
                tenant.subscription.cancelAtPeriodEnd
              }
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel subscription'}
            </button>
          </div>

          <div className="action-block">
            <h3>Extend trial</h3>
            <p className="muted-note">Add days to the current trial window.</p>
            <label className="inline-field">
              <span>Days</span>
              <input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                disabled={!!busy}
              />
            </label>
            <button
              type="button"
              className="button"
              onClick={extendTrial}
              disabled={!!busy}
            >
              {busy === 'trial' ? 'Extending…' : 'Extend trial'}
            </button>
          </div>

          <div className="action-block">
            <h3>Owner access</h3>
            <p className="muted-note">
              Sends the tenant&apos;s 6-digit reset code to the owner email. No
              password is set from the platform.
            </p>
            <button
              type="button"
              className="button"
              onClick={resetOwnerPassword}
              disabled={!!busy}
            >
              {busy === 'reset' ? 'Sending…' : 'Send password reset'}
            </button>
          </div>

          <div className="action-block action-block--danger">
            <h3>Delete tenant</h3>
            <p className="muted-note">
              Soft-deletes the workspace and stops routing immediately. The
              export/purge window is 30 days.
            </p>
            <button
              type="button"
              className="button button--danger"
              onClick={deleteTenant}
              disabled={!!busy || deleted}
            >
              {busy === 'delete' ? 'Deleting…' : 'Soft-delete tenant'}
            </button>
          </div>
        </div>
      </section>

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
            {tenant.subscription?.pendingPlanVersionId ? (
              <div>
                <dt>Pending plan</dt>
                <dd>
                  Change scheduled for{' '}
                  {formatDate(tenant.subscription.pendingPlanEffectiveAt)}
                </dd>
              </div>
            ) : null}
            {tenant.subscription?.cancelAtPeriodEnd ? (
              <div>
                <dt>Cancels</dt>
                <dd>
                  At period end (
                  {formatDate(tenant.subscription.currentPeriodEnd)})
                </dd>
              </div>
            ) : null}
          </dl>
        </article>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Usage &amp; limits</h2>
            <p>
              Counters are collected from the tenant runtime. Overrides apply on
              top of the plan and reach the tenant through its registry refresh.
            </p>
          </div>
          <div className="head-actions">
            <span className="muted-note">
              {usage?.lastCollectedAt
                ? `Last collected ${formatDateTime(usage.lastCollectedAt)}`
                : 'No snapshot yet'}
            </span>
            <button
              type="button"
              className="button button--ghost"
              onClick={refreshUsage}
              disabled={!!usageBusy}
            >
              {usageBusy === 'refresh' ? 'Collecting…' : 'Collect live usage'}
            </button>
          </div>
        </div>
        {usageError ? <ErrorNote message={usageError} /> : null}
        {usageNotice ? (
          <div className="notice notice--success" role="status">
            {usageNotice}
          </div>
        ) : null}
        {!usage ? (
          <Loading label="Loading usage…" />
        ) : (
          <div className="table-wrap">
            <table className="usage-detail-table">
              <thead>
                <tr>
                  <th>Limit</th>
                  <th>Plan</th>
                  <th>Override</th>
                  <th>Effective</th>
                  <th>Used</th>
                  <th>Consumption</th>
                  <th>Snapshot day</th>
                </tr>
              </thead>
              <tbody>
                {usage.metrics.map((metric) => {
                  const tone = usageTone(metric);
                  return (
                    <tr key={metric.key}>
                      <td>{metric.label}</td>
                      <td>{formatLimit(metric.planLimit)}</td>
                      <td>
                        <div className="usage-override-form">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`${metric.label} override`}
                            value={overrideInputs[metric.key] ?? ''}
                            placeholder="—"
                            onChange={(event) =>
                              setOverrideInputs((current) => ({
                                ...current,
                                [metric.key]: event.target.value,
                              }))
                            }
                            disabled={!!usageBusy}
                          />
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            onClick={() => saveOverride(metric)}
                            disabled={
                              !!usageBusy ||
                              (overrideInputs[metric.key] ?? '').trim() === ''
                            }
                          >
                            {usageBusy === `save:${metric.key}`
                              ? 'Saving…'
                              : 'Save'}
                          </button>
                          {metric.override !== null ? (
                            <button
                              type="button"
                              className="button button--danger button--sm"
                              onClick={() => clearOverride(metric)}
                              disabled={!!usageBusy}
                            >
                              {usageBusy === `clear:${metric.key}`
                                ? 'Clearing…'
                                : 'Clear'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <strong>{formatLimit(metric.limit)}</strong>
                      </td>
                      <td>
                        {metric.used === null ? '—' : formatLimit(metric.used)}
                      </td>
                      <td>
                        <div className={`usage-cell usage-cell--${tone}`}>
                          <div className="usage-cell-top">
                            <span className="usage-percent">
                              {formatUsagePercent(metric.percent)}
                            </span>
                            {metric.over ? (
                              <span className="badge badge--danger">Over</span>
                            ) : metric.warning ? (
                              <span className="badge badge--warning">Near</span>
                            ) : null}
                          </div>
                          <span className="usage-bar" aria-hidden>
                            <span
                              style={{ width: `${barWidth(metric.percent)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td>{metric.capturedAt ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted-note usage-footnote">
          Every override change is audited. Clearing an override restores the
          plan value; a missing plan limit means unlimited.
        </p>
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
