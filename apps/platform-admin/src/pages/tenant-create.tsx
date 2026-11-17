import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { ErrorNote, Loading, PageHeader, useToast } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { Plan, Tenant } from '../types';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/**
 * Create a tenant (F1 — the console had NO tenant-create action at all).
 * The form always sets an owner password, so the API provisions the store
 * immediately (same flow as a verified public signup) and this page waits
 * for the definitive outcome: success navigates to the tenant detail,
 * where the provisioning banner shows the result.
 */
export function TenantCreatePage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [planVersionId, setPlanVersionId] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/plans')
      .then((response) => readJson<Plan[]>(response))
      .then((result) => {
        if (cancelled) return;
        setPlans(result);
        // Default to the signup-default version, else the first usable
        // version of the first active plan.
        const all = result.flatMap((plan) =>
          plan.versions.map((version) => ({ plan, version })),
        );
        const usable = all.filter(
          ({ plan, version }) =>
            plan.isActive && !version.archivedAt,
        );
        const preferred =
          usable.find(({ version }) => version.isDefault) ?? usable[0];
        if (preferred) setPlanVersionId(preferred.version.id);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const planOptions = useMemo(
    () =>
      plans.flatMap((plan) =>
        plan.versions
          .filter((version) => plan.isActive && !version.archivedAt)
          .map((version) => ({
            id: version.id,
            label: `${plan.name} — v${version.version} · ${formatMoney(
              version.price,
              version.currency,
            )}/${version.interval.toLowerCase()}${version.isDefault ? ' · signup default' : ''}`,
          })),
      ),
    [plans],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
        planVersionId,
      };
      if (ownerPhone.trim()) body.ownerPhone = ownerPhone.trim();
      if (trialDays.trim()) body.trialDays = Number(trialDays);
      const created = await api('/tenants', {
        method: 'POST',
        body: JSON.stringify(body),
      }).then((response) => readJson<Tenant>(response));
      const job = created.provisioningJobs?.[0];
      if (job?.status === 'FAILED') {
        pushToast(
          'Tenant created, but provisioning failed — retry it from the tenant page.',
          'error',
        );
      } else {
        pushToast(`Tenant ${created.name} is ready.`, 'success');
      }
      void navigate({
        to: '/tenants/$tenantId',
        params: { tenantId: created.id },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-breadcrumb">
        <Link to="/tenants">← Tenants</Link>
      </div>
      <PageHeader
        eyebrow="Tenants"
        title="New tenant"
        description="Create a store and provision it immediately. The owner signs in to their admin with the email and password below."
      />

      {error ? <ErrorNote message={error} /> : null}
      {plansLoading ? (
        <Loading label="Loading plans…" />
      ) : (
        <section className="card">
          <form onSubmit={submit} autoComplete="off">
            <div className="inline-form">
              <label>
                Store name
                <input
                  value={name}
                  onChange={(event) => {
                    const next = event.target.value;
                    setName(next);
                    if (!slugTouched) setSlug(slugify(next));
                  }}
                  placeholder="Acme Store"
                  required
                  minLength={2}
                  autoComplete="off"
                />
              </label>
              <label>
                Slug (store address)
                <input
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(event.target.value.toLowerCase());
                  }}
                  placeholder="acme"
                  required
                  pattern="[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])"
                  title="3–30 lowercase letters, numbers or hyphens, starting and ending with a letter or number"
                  autoComplete="off"
                />
              </label>
              <label>
                Owner email
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(event) => setOwnerEmail(event.target.value)}
                  placeholder="owner@example.com"
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                Owner phone (optional)
                <input
                  type="tel"
                  value={ownerPhone}
                  onChange={(event) => setOwnerPhone(event.target.value)}
                  placeholder="+8801XXXXXXXXX"
                  autoComplete="off"
                />
              </label>
              <label>
                Owner password
                <input
                  type="password"
                  value={ownerPassword}
                  onChange={(event) => setOwnerPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  maxLength={72}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Plan
                <select
                  value={planVersionId}
                  onChange={(event) => setPlanVersionId(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    {planOptions.length === 0
                      ? 'No usable plan versions — create a plan first'
                      : 'Choose a plan'}
                  </option>
                  {planOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Trial days (optional override)
                <input
                  type="number"
                  value={trialDays}
                  onChange={(event) => setTrialDays(event.target.value)}
                  placeholder="Plan default"
                  min={1}
                  max={365}
                  autoComplete="off"
                />
              </label>
            </div>
            <p className="muted-note" style={{ marginTop: 12 }}>
              The store is provisioned right away — this can take up to about
              30 seconds while the workspace is seeded. The owner&apos;s
              subdomain becomes live once provisioning succeeds.
            </p>
            <div className="form-actions">
              <button
                type="submit"
                className="button button--primary"
                disabled={busy || planOptions.length === 0}
              >
                {busy ? 'Creating and provisioning…' : 'Create tenant'}
              </button>
              <Link to="/tenants" className="button">
                Cancel
              </Link>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
