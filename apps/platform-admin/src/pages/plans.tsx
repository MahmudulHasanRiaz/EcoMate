import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatMoney, planLabel } from '../lib/format';
import type { Plan, PlanVersion } from '../types';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../components/ui';

interface VersionForm {
  price: string;
  currency: string;
  interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM';
  intervalDays: string;
  trialDays: string;
  graceDays: string;
  features: string;
  limits: string;
}

const EMPTY_VERSION: VersionForm = {
  price: '0',
  currency: 'BDT',
  interval: 'MONTHLY',
  intervalDays: '',
  trialDays: '',
  graceDays: '',
  features: '',
  limits: '',
};

function versionFormFrom(version: PlanVersion): VersionForm {
  return {
    price: String(version.price),
    currency: version.currency,
    interval: (version.interval as VersionForm['interval']) ?? 'MONTHLY',
    intervalDays: version.intervalDays ? String(version.intervalDays) : '',
    trialDays: String(version.trialDays ?? ''),
    graceDays:
      version.graceDays === null || version.graceDays === undefined
        ? ''
        : String(version.graceDays),
    features: (version.features ?? []).join(', '),
    limits: JSON.stringify(version.limits ?? {}, null, 2),
  };
}

/** Parses the version form into an API body; returns a message on bad input. */
function parseVersionForm(
  form: VersionForm,
): { body: Record<string, unknown> } | { error: string } {
  const price = Number(form.price);
  if (!Number.isFinite(price) || price < 0) {
    return { error: 'Price must be a number of 0 or more.' };
  }
  const body: Record<string, unknown> = {
    price,
    currency: form.currency.trim() || 'BDT',
    interval: form.interval,
  };
  if (form.interval === 'CUSTOM') {
    const days = Number(form.intervalDays);
    if (!Number.isInteger(days) || days < 1) {
      return { error: 'A custom interval needs an interval length in days (1 or more).' };
    }
    body.intervalDays = days;
  }
  if (form.trialDays.trim() !== '') {
    const days = Number(form.trialDays);
    if (!Number.isInteger(days) || days < 0) {
      return { error: 'Trial days must be a whole number of 0 or more.' };
    }
    body.trialDays = days;
  }
  if (form.graceDays.trim() !== '') {
    const days = Number(form.graceDays);
    if (!Number.isInteger(days) || days < 0) {
      return { error: 'Grace days must be a whole number of 0 or more.' };
    }
    body.graceDays = days;
  }
  const features = form.features
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean);
  body.features = features;
  const limitsRaw = form.limits.trim();
  if (limitsRaw !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(limitsRaw);
    } catch {
      return { error: 'Limits must be valid JSON, e.g. {"products": 100}.' };
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.values(parsed).some(
        (value) => typeof value !== 'number' || !Number.isFinite(value),
      )
    ) {
      return {
        error: 'Limits must be a JSON object of numbers, e.g. {"products": 100}.',
      };
    }
    body.limits = parsed;
  }
  return { body };
}

function VersionFields({
  form,
  onChange,
}: {
  form: VersionForm;
  onChange: (next: VersionForm) => void;
}) {
  const set = (patch: Partial<VersionForm>) => onChange({ ...form, ...patch });
  return (
    <div className="inline-form">
      <label>
        Price
        <input
          type="number"
          min={0}
          step="0.01"
          value={form.price}
          onChange={(event) => set({ price: event.target.value })}
          required
        />
      </label>
      <label>
        Currency
        <input
          value={form.currency}
          onChange={(event) => set({ currency: event.target.value })}
          placeholder="BDT"
        />
      </label>
      <label>
        Billing interval
        <select
          value={form.interval}
          onChange={(event) =>
            set({ interval: event.target.value as VersionForm['interval'] })
          }
        >
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
          <option value="CUSTOM">Custom (days)</option>
        </select>
      </label>
      {form.interval === 'CUSTOM' ? (
        <label>
          Interval days
          <input
            type="number"
            min={1}
            step={1}
            value={form.intervalDays}
            onChange={(event) => set({ intervalDays: event.target.value })}
            required
          />
        </label>
      ) : null}
      <label>
        Trial days
        <input
          type="number"
          min={0}
          step={1}
          value={form.trialDays}
          onChange={(event) => set({ trialDays: event.target.value })}
          placeholder="Platform default"
        />
      </label>
      <label>
        Grace days
        <input
          type="number"
          min={0}
          step={1}
          value={form.graceDays}
          onChange={(event) => set({ graceDays: event.target.value })}
          placeholder="Platform default"
        />
      </label>
      <label>
        Features (comma-separated keys)
        <input
          value={form.features}
          onChange={(event) => set({ features: event.target.value })}
          placeholder="admin_products, admin_orders"
        />
      </label>
      <label>
        Limits (JSON object of numbers)
        <textarea
          value={form.limits}
          onChange={(event) => set({ limits: event.target.value })}
          placeholder={'{"products": 100}'}
          rows={3}
        />
      </label>
    </div>
  );
}

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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [newVersionFor, setNewVersionFor] = useState<Plan | null>(null);
  const [archiving, setArchiving] = useState<Plan | null>(null);

  // Create-plan form state.
  const [createSlug, setCreateSlug] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPublic, setCreatePublic] = useState(true);
  const [createFree, setCreateFree] = useState(false);
  const [createBadge, setCreateBadge] = useState('');
  const [createSortOrder, setCreateSortOrder] = useState('');
  const [createVersion, setCreateVersion] = useState<VersionForm>(EMPTY_VERSION);

  // Edit-plan form state.
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editPublic, setEditPublic] = useState(true);
  const [editFree, setEditFree] = useState(false);
  const [editBadge, setEditBadge] = useState('');
  const [editSortOrder, setEditSortOrder] = useState('');

  // New-version form state.
  const [versionForm, setVersionForm] = useState<VersionForm>(EMPTY_VERSION);

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

  function openCreate() {
    setCreateSlug('');
    setCreateName('');
    setCreateDescription('');
    setCreatePublic(true);
    setCreateFree(false);
    setCreateBadge('');
    setCreateSortOrder('');
    setCreateVersion(EMPTY_VERSION);
    setError(null);
    setCreating(true);
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseVersionForm(createVersion);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy('create');
    setError(null);
    try {
      const body: Record<string, unknown> = {
        slug: createSlug.trim().toLowerCase(),
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        isPublic: createPublic,
        isFree: createFree,
        badge: createBadge.trim() || undefined,
        ...parsed.body,
      };
      if (createSortOrder.trim() !== '') {
        body.sortOrder = Number(createSortOrder);
      }
      await api('/plans', { method: 'POST', body: JSON.stringify(body) }).then(
        (r) => readJson(r),
      );
      setNotice(`Plan "${createName.trim()}" created with its first version.`);
      setCreating(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function openEdit(plan: Plan) {
    setEditName(plan.name);
    setEditDescription(plan.description ?? '');
    setEditActive(plan.isActive);
    setEditPublic(plan.isPublic);
    setEditFree(plan.isFree);
    setEditBadge(plan.badge ?? '');
    setEditSortOrder(String(plan.sortOrder ?? 0));
    setError(null);
    setEditing(plan);
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy('edit');
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: editName.trim(),
        description: editDescription.trim(),
        isActive: editActive,
        isPublic: editPublic,
        isFree: editFree,
        badge: editBadge.trim(),
      };
      if (editSortOrder.trim() !== '') body.sortOrder = Number(editSortOrder);
      await api(`/plans/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }).then((r) => readJson(r));
      setNotice(`Plan "${editName.trim()}" updated.`);
      setEditing(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function openNewVersion(plan: Plan) {
    const current = plan.currentVersion ?? plan.versions[0] ?? null;
    setVersionForm(current ? versionFormFrom(current) : EMPTY_VERSION);
    setError(null);
    setNewVersionFor(plan);
  }

  async function submitNewVersion(event: React.FormEvent) {
    event.preventDefault();
    if (!newVersionFor) return;
    const parsed = parseVersionForm(versionForm);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy('version');
    setError(null);
    try {
      await api(`/plans/${newVersionFor.id}/versions`, {
        method: 'POST',
        body: JSON.stringify(parsed.body),
      }).then((r) => readJson(r));
      setNotice(
        `New version created for "${newVersionFor.name}". Existing subscriptions stay on their version until you apply it.`,
      );
      setNewVersionFor(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function archivePlan() {
    if (!archiving) return;
    setBusy(`archive:${archiving.id}`);
    setError(null);
    try {
      await api(`/plans/${archiving.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((r) => readJson(r));
      setNotice(`Plan "${archiving.name}" archived.`);
      setArchiving(null);
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
        description="Versioned pricing and feature sets. New versions never move existing subscriptions until you apply them."
        actions={
          <button
            type="button"
            className="button button--primary"
            onClick={openCreate}
          >
            New plan
          </button>
        }
      />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {loading && plans.length === 0 ? <Skeleton /> : null}
      {!loading && plans.length === 0 ? (
        <EmptyState icon={Layers} title="No plans yet">
          Create the first plan — signups and admin-created tenants need
          one.
        </EmptyState>
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
                className="button button--accent"
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
                  {/* R-PLANS: the heading opens the edit dialog, same as the
                      card's Edit plan button — a heading that does nothing
                      on click reads as broken. */}
                  <h2>
                    <button
                      type="button"
                      className="plan-title"
                      onClick={() => openEdit(plan)}
                      disabled={!!busy}
                      aria-label={`Edit plan ${plan.name}`}
                    >
                      {plan.name}
                    </button>
                  </h2>
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
                  <dd>
                    <span className="badge badge--neutral">
                      {plan.isPublic ? 'Public' : 'Private'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge
                      status={plan.isActive ? 'ACTIVE' : 'INACTIVE'}
                    />
                  </dd>
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
                      <span className="badge badge--accent">Signup default</span>
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
              <div className="button-row">
                <button
                  type="button"
                  className="button"
                  onClick={() => openEdit(plan)}
                  disabled={!!busy}
                >
                  Edit plan
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => openNewVersion(plan)}
                  disabled={!!busy}
                >
                  New version
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => setArchiving(plan)}
                  disabled={!!busy}
                >
                  Archive
                </button>
              </div>
              {plan.versions.length > 1 && version ? (
                <div className="button-row">
                  <button
                    type="button"
                    className="button"
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

      <Modal
        open={creating}
        title="New plan"
        wide
        onClose={() => setCreating(false)}
      >
        <form onSubmit={submitCreate}>
          <div className="inline-form">
            <label>
              Name
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Growth"
                required
                minLength={2}
              />
            </label>
            <label>
              Slug
              <input
                value={createSlug}
                onChange={(event) =>
                  setCreateSlug(event.target.value.toLowerCase())
                }
                placeholder="growth"
                required
                pattern="[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])"
                title="3–60 lowercase letters, numbers or hyphens"
              />
            </label>
            <label>
              Description
              <input
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="For growing stores"
              />
            </label>
            <label>
              Badge (optional)
              <input
                value={createBadge}
                onChange={(event) => setCreateBadge(event.target.value)}
                placeholder="Most popular"
              />
            </label>
            <label>
              Sort order
              <input
                type="number"
                min={0}
                value={createSortOrder}
                onChange={(event) => setCreateSortOrder(event.target.value)}
                placeholder="0"
              />
            </label>
          </div>
          <div className="domain-flags">
            <label>
              <input
                type="checkbox"
                checked={createPublic}
                onChange={(event) => setCreatePublic(event.target.checked)}
              />
              Public (shown on signup)
            </label>
            <label>
              <input
                type="checkbox"
                checked={createFree}
                onChange={(event) => setCreateFree(event.target.checked)}
              />
              Free plan
            </label>
          </div>
          <h3 className="subhead">First version</h3>
          <VersionFields form={createVersion} onChange={setCreateVersion} />
          <div className="form-actions">
            <button
              type="submit"
              className="button button--accent"
              disabled={busy === 'create'}
            >
              {busy === 'create' ? 'Creating…' : 'Create plan'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        title={editing ? `Edit ${editing.name}` : 'Edit plan'}
        wide
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form onSubmit={submitEdit}>
            <div className="inline-form">
              <label>
                Name
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  required
                  minLength={2}
                />
              </label>
              <label>
                Description
                <input
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                />
              </label>
              <label>
                Badge
                <input
                  value={editBadge}
                  onChange={(event) => setEditBadge(event.target.value)}
                />
              </label>
              <label>
                Sort order
                <input
                  type="number"
                  min={0}
                  value={editSortOrder}
                  onChange={(event) => setEditSortOrder(event.target.value)}
                />
              </label>
            </div>
            <div className="domain-flags">
              <label>
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(event) => setEditActive(event.target.checked)}
                />
                Active
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editPublic}
                  onChange={(event) => setEditPublic(event.target.checked)}
                />
                Public (shown on signup)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editFree}
                  onChange={(event) => setEditFree(event.target.checked)}
                />
                Free plan
              </label>
            </div>
            <p className="muted-note muted-note--gap-top">
              Price, features and limits live on versions — create a new
              version to change them.
            </p>
            <div className="form-actions">
              <button
                type="submit"
                className="button button--accent"
                disabled={busy === 'edit'}
              >
                {busy === 'edit' ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={newVersionFor !== null}
        title={
          newVersionFor ? `New version — ${newVersionFor.name}` : 'New version'
        }
        wide
        onClose={() => setNewVersionFor(null)}
      >
        {newVersionFor ? (
          <form onSubmit={submitNewVersion}>
            <p className="muted-note muted-note--gap-bottom">
              Prefilled from the current version. Existing subscriptions stay
              on their version until you apply the new one.
            </p>
            <VersionFields form={versionForm} onChange={setVersionForm} />
            <div className="form-actions">
              <button
                type="submit"
                className="button button--accent"
                disabled={busy === 'version'}
              >
                {busy === 'version' ? 'Creating…' : 'Create version'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setNewVersionFor(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      {archiving ? (
        <ConfirmDialog
          open
          title={`Archive ${archiving.name}?`}
          body="The plan stops being offered to new signups. Existing subscriptions are not moved."
          confirmLabel="Archive plan"
          danger
          busy={busy === `archive:${archiving.id}`}
          onConfirm={() => void archivePlan()}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}
