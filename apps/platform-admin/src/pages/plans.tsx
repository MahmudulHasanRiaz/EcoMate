import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatMoney, planLabel } from '../lib/format';
import type { Plan } from '../types';
import { ErrorNote, Loading, PageHeader } from '../components/ui';

export function PlansPage() {
  const { api } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    planId: string;
    versionId: string;
    affected: number;
    tenants: { tenantName: string; tenantSlug: string; status: string }[];
  } | null>(null);

  const load = () => {
    setLoading(true);
    api('/plans')
      .then((response) => readJson<Plan[]>(response))
      .then((result) => setPlans(result))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function previewApply(planId: string, versionId: string) {
    setBusy(`preview:${versionId}`);
    setError(null);
    setNotice(null);
    try {
      const response = await api(`/plans/${planId}/versions/${versionId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      });
      const result = await readJson<{
        affected: number;
        tenants: { tenantName: string; tenantSlug: string; status: string }[];
      }>(response);
      setPreview({ planId, versionId, ...result });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function applyVersion() {
    if (!preview) return;
    setBusy(`apply:${preview.versionId}`);
    setError(null);
    try {
      const response = await api(
        `/plans/${preview.planId}/versions/${preview.versionId}/apply`,
        { method: 'POST', body: JSON.stringify({ dryRun: false }) },
      );
      const result = await readJson<{ affected: number }>(response);
      setNotice(
        `Plan version applied to ${result.affected} subscription${result.affected === 1 ? '' : 's'}.`,
      );
      setPreview(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function setDefaultVersion(planId: string, versionId: string) {
    setBusy(`default:${versionId}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/plans/${planId}/versions/${versionId}/set-default`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((r) => readJson(r));
      setNotice('Signup default updated. New signups provision onto this version.');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Plans"
        description="Versioned pricing and feature sets. Editing lands with the billing unit."
      />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {loading ? <Loading /> : null}
      {!loading && plans.length === 0 ? (
        <p className="muted-note">No plans yet.</p>
      ) : null}
      {preview ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Apply this version to existing subscriptions?</h2>
              <p>
                {preview.affected} subscription
                {preview.affected === 1 ? '' : 's'} on older versions of this
                plan will move to the selected version. New signups follow the
                signup-default version; this only moves existing tenants.
              </p>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="button"
                onClick={() => void applyVersion()}
                disabled={!!busy || preview.affected === 0}
              >
                {busy === `apply:${preview.versionId}`
                  ? 'Applying…'
                  : `Apply to ${preview.affected}`}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setPreview(null)}
              >
                Cancel
              </button>
            </div>
          </div>
          {preview.tenants.length > 0 ? (
            <ul className="muted-note">
              {preview.tenants.slice(0, 10).map((tenant) => (
                <li key={tenant.tenantSlug}>
                  {tenant.tenantName} ({tenant.tenantSlug}) — {tenant.status}
                </li>
              ))}
              {preview.tenants.length > 10 ? (
                <li>…and {preview.tenants.length - 10} more</li>
              ) : null}
            </ul>
          ) : (
            <p className="muted-note">
              No existing subscriptions are on an older version of this plan.
            </p>
          )}
        </section>
      ) : null}
      <section className="plan-grid">
        {plans.map((plan) => {
          const version = plan.currentVersion ?? plan.versions[0] ?? null;
          return (
            <article className="card plan-card" key={plan.id}>
              <div className="plan-head">
                <div>
                  <p className="eyebrow">{plan.slug}</p>
                  <h2>{plan.name}</h2>
                </div>
                {plan.badge ? <span className="badge">{plan.badge}</span> : null}
              </div>
              <p className="muted-note">{plan.description || 'No description'}</p>
              <dl className="facts">
                <div>
                  <dt>Current</dt>
                  <dd>{planLabel(version)}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{formatMoney(version?.price, version?.currency)}</dd>
                </div>
                <div>
                  <dt>Trial</dt>
                  <dd>{version?.trialDays ?? 0} days</dd>
                </div>
                <div>
                  <dt>Features</dt>
                  <dd>{version?.features.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Visibility</dt>
                  <dd>{plan.isPublic ? 'Public' : 'Private'}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(plan.createdAt)}</dd>
                </div>
              </dl>
              <p className="muted-note">
                {plan.versions.length} version{plan.versions.length === 1 ? '' : 's'}
              </p>
              <ul className="muted-note">
                {plan.versions.map((v) => (
                  <li key={v.id}>
                    v{v.version} — {formatMoney(v.price, v.currency)}
                    {v.archivedAt ? ' (archived)' : ''}
                    {v.isDefault ? (
                      <span className="badge badge--success"> Signup default</span>
                    ) : !v.archivedAt ? (
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => void setDefaultVersion(plan.id, v.id)}
                        disabled={!!busy}
                      >
                        {busy === `default:${v.id}`
                          ? 'Setting…'
                          : 'Set as signup default'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {plan.versions.length > 1 && version ? (
                <div className="button-row">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => void previewApply(plan.id, version.id)}
                    disabled={!!busy}
                  >
                    {busy === `preview:${version.id}`
                      ? 'Checking…'
                      : `Apply v${version.version} to existing subscriptions`}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </>
  );
}
