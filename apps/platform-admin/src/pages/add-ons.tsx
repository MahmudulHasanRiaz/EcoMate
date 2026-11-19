import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Puzzle } from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import type { AddOn, ConvertFeatureResult } from '../types';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '../components/ui';

interface AddOnForm {
  slug: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  interval: 'MONTHLY' | 'YEARLY';
  features: string;
  limits: string;
  isPublic: boolean;
  sortOrder: string;
  meteringEnabled: boolean;
  meteringIncluded: string;
  meteringRate: string;
  meteringMinimum: string;
}

const EMPTY_FORM: AddOnForm = {
  slug: '',
  name: '',
  description: '',
  price: '',
  currency: 'BDT',
  interval: 'MONTHLY',
  features: '',
  limits: '',
  isPublic: true,
  sortOrder: '',
  meteringEnabled: false,
  meteringIncluded: '0',
  meteringRate: '',
  meteringMinimum: '',
};

function formFrom(addOn: AddOn): AddOnForm {
  return {
    slug: addOn.slug,
    name: addOn.name,
    description: addOn.description ?? '',
    price: String(addOn.price),
    currency: addOn.currency,
    interval: addOn.interval === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
    features: (addOn.features ?? []).join(', '),
    limits: JSON.stringify(addOn.limits ?? {}, null, 2),
    isPublic: addOn.isPublic,
    sortOrder: String(addOn.sortOrder ?? 0),
    meteringEnabled: !!addOn.metering,
    meteringIncluded: String(addOn.metering?.included ?? 0),
    meteringRate:
      addOn.metering?.ratePerUnit !== undefined
        ? String(addOn.metering.ratePerUnit)
        : '',
    meteringMinimum:
      addOn.metering?.minimumMonthly !== undefined &&
      addOn.metering.minimumMonthly !== null
        ? String(addOn.metering.minimumMonthly)
        : '',
  };
}

function parseForm(
  form: AddOnForm,
  isCreate: boolean,
): { body: Record<string, unknown> } | { error: string } {
  const body: Record<string, unknown> = {};
  if (isCreate) {
    const slug = form.slug.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(slug)) {
      return {
        error: 'Slug must be 3–60 lowercase letters, numbers or hyphens.',
      };
    }
    body.slug = slug;
  }
  if (form.name.trim().length < 2) {
    return { error: 'Name must be at least 2 characters.' };
  }
  body.name = form.name.trim();
  if (form.description.trim() !== '') body.description = form.description.trim();
  const price = Number(form.price);
  if (!Number.isFinite(price) || price < 0) {
    return { error: 'Price must be a number of 0 or more.' };
  }
  body.price = price;
  body.currency = form.currency.trim() || 'BDT';
  body.interval = form.interval;
  body.features = form.features
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean);
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
  body.isPublic = form.isPublic;
  if (form.sortOrder.trim() !== '') {
    const order = Number(form.sortOrder);
    if (!Number.isInteger(order)) {
      return { error: 'Sort order must be a whole number.' };
    }
    body.sortOrder = order;
  }
  if (form.meteringEnabled) {
    const included = Number(form.meteringIncluded);
    const rate = Number(form.meteringRate);
    if (!Number.isInteger(included) || included < 0) {
      return { error: 'Included units must be a whole number of 0 or more.' };
    }
    if (!Number.isFinite(rate) || rate < 0) {
      return { error: 'Per-order rate must be a number of 0 or more.' };
    }
    let minimum: number | null = null;
    if (form.meteringMinimum.trim() !== '') {
      minimum = Number(form.meteringMinimum);
      if (!Number.isFinite(minimum) || minimum < 0) {
        return { error: 'Minimum monthly must be a number of 0 or more.' };
      }
    }
    body.metering = {
      metric: 'orders_per_month',
      included,
      ratePerUnit: rate,
      minimumMonthly: minimum,
    };
  }
  return { body };
}

export function AddOnsPage() {
  const { api, session } = useAuth();
  const canWrite =
    session?.user.role === 'SUPERADMIN' || session?.user.role === 'BILLING';
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AddOn | null>(null);
  const [archiving, setArchiving] = useState<AddOn | null>(null);
  const [form, setForm] = useState<AddOnForm>(EMPTY_FORM);
  const [attachedFor, setAttachedFor] = useState<string | null>(null);
  const [attached, setAttached] = useState<
    Array<{ tenantId: string; tenantName: string; tenantSlug: string }>
  >([]);
  const [attachedLoading, setAttachedLoading] = useState(false);

  // Convert-feature state.
  const [converting, setConverting] = useState(false);
  const [convertFeatureKey, setConvertFeatureKey] = useState('');
  const [convertPrice, setConvertPrice] = useState('');
  const [convertName, setConvertName] = useState('');
  const [convertDescription, setConvertDescription] = useState('');
  const [convertPreview, setConvertPreview] =
    useState<ConvertFeatureResult | null>(null);

  const load = () => {
    setLoading(true);
    api('/add-ons')
      .then((response) => readJson<AddOn[]>(response))
      .then((result) => setAddOns(result))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setCreating(true);
  }

  function openEdit(addOn: AddOn) {
    setForm(formFrom(addOn));
    setError(null);
    setEditing(addOn);
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseForm(form, true);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy('create');
    setError(null);
    try {
      await api('/add-ons', {
        method: 'POST',
        body: JSON.stringify(parsed.body),
      }).then((r) => readJson(r));
      setNotice(`Add-on "${form.name.trim()}" created.`);
      setCreating(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const parsed = parseForm(form, false);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy('edit');
    setError(null);
    try {
      await api(`/add-ons/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(parsed.body),
      }).then((r) => readJson(r));
      setNotice(`Add-on "${form.name.trim()}" updated.`);
      setEditing(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function archiveAddOn() {
    if (!archiving) return;
    setBusy(`archive:${archiving.id}`);
    setError(null);
    try {
      await api(`/add-ons/${archiving.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((r) => readJson(r));
      setNotice(`Add-on "${archiving.name}" archived.`);
      setArchiving(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function showAttached(addOn: AddOn) {
    if (attachedFor === addOn.id) {
      setAttachedFor(null);
      return;
    }
    setAttachedFor(addOn.id);
    setAttachedLoading(true);
    try {
      const result = await api(`/add-ons/${addOn.id}/attached-tenants`).then(
        (r) =>
          readJson<
            Array<{
              tenantId: string;
              tenantName: string;
              tenantSlug: string;
            }>
          >(r),
      );
      setAttached(result);
    } catch (err) {
      setError(errorMessage(err));
      setAttachedFor(null);
    } finally {
      setAttachedLoading(false);
    }
  }

  async function convertDryRun(event: React.FormEvent) {
    event.preventDefault();
    const price = Number(convertPrice);
    if (!convertFeatureKey.trim()) {
      setError('Enter the feature key to convert.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Price must be a number of 0 or more.');
      return;
    }
    setBusy('convert-preview');
    setError(null);
    setConvertPreview(null);
    try {
      const result = await api('/add-ons/from-feature', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: convertFeatureKey.trim(),
          price,
          name: convertName.trim() || undefined,
          description: convertDescription.trim() || undefined,
          dryRun: true,
        }),
      }).then((r) => readJson<ConvertFeatureResult>(r));
      setConvertPreview(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function convertApply() {
    if (!convertPreview) return;
    const price = Number(convertPrice);
    setBusy('convert-apply');
    setError(null);
    try {
      const result = await api('/add-ons/from-feature', {
        method: 'POST',
        body: JSON.stringify({
          featureKey: convertFeatureKey.trim(),
          price,
          name: convertName.trim() || undefined,
          description: convertDescription.trim() || undefined,
          dryRun: false,
        }),
      }).then((r) => readJson<ConvertFeatureResult>(r));
      setNotice(
        `Feature "${result.featureKey}" converted to add-on "${result.slug}" — attached to ${result.attached ?? 0} tenant${result.attached === 1 ? '' : 's'}, ${result.plans ?? 0} plan version${result.plans === 1 ? '' : 's'} re-versioned.`,
      );
      setConverting(false);
      setConvertPreview(null);
      setConvertFeatureKey('');
      setConvertPrice('');
      setConvertName('');
      setConvertDescription('');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const formFields = (
    <>
      <div className="inline-form">
        <label>
          Name
          <input
            value={form.name}
            onChange={(event) =>
              setForm({ ...form, name: event.target.value })
            }
            placeholder="Unified Inbox"
            required
            minLength={2}
          />
        </label>
        {creating ? (
          <label>
            Slug
            <input
              value={form.slug}
              onChange={(event) =>
                setForm({ ...form, slug: event.target.value.toLowerCase() })
              }
              placeholder="unified-inbox"
              required
              pattern="[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])"
              title="3–60 lowercase letters, numbers or hyphens"
            />
          </label>
        ) : null}
        <label>
          Description
          <input
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
            placeholder="Messenger, WhatsApp and Instagram in one inbox"
          />
        </label>
        <label>
          Price
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={(event) =>
              setForm({ ...form, price: event.target.value })
            }
            required
          />
        </label>
        <label>
          Currency
          <input
            value={form.currency}
            onChange={(event) =>
              setForm({ ...form, currency: event.target.value })
            }
            placeholder="BDT"
          />
        </label>
        <label>
          Billing interval
          <select
            value={form.interval}
            onChange={(event) =>
              setForm({
                ...form,
                interval: event.target.value as AddOnForm['interval'],
              })
            }
          >
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </label>
        <label>
          Features (comma-separated keys)
          <input
            value={form.features}
            onChange={(event) =>
              setForm({ ...form, features: event.target.value })
            }
            placeholder="inbox"
          />
        </label>
        <label>
          Limits (JSON object of numbers)
          <textarea
            value={form.limits}
            onChange={(event) =>
              setForm({ ...form, limits: event.target.value })
            }
            placeholder={'{"products": 100}'}
            rows={3}
          />
        </label>
        <label>
          Sort order
          <input
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(event) =>
              setForm({ ...form, sortOrder: event.target.value })
            }
            placeholder="0"
          />
        </label>
      </div>
      <div className="domain-flags">
        <label>
          <input
            type="checkbox"
            checked={form.isPublic}
            onChange={(event) =>
              setForm({ ...form, isPublic: event.target.checked })
            }
          />
          Public (visible to tenants)
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.meteringEnabled}
            onChange={(event) =>
              setForm({ ...form, meteringEnabled: event.target.checked })
            }
          />
          Metered (bill per order on top of the price)
        </label>
      </div>
      {form.meteringEnabled ? (
        <div className="inline-form">
          <label>
            Included orders per period
            <input
              type="number"
              min={0}
              step={1}
              value={form.meteringIncluded}
              onChange={(event) =>
                setForm({ ...form, meteringIncluded: event.target.value })
              }
            />
          </label>
          <label>
            Rate per order (BDT)
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.meteringRate}
              onChange={(event) =>
                setForm({ ...form, meteringRate: event.target.value })
              }
              placeholder="10"
              required
            />
          </label>
          <label>
            Minimum monthly (BDT, empty = none)
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.meteringMinimum}
              onChange={(event) =>
                setForm({ ...form, meteringMinimum: event.target.value })
              }
              placeholder="500"
            />
          </label>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Add-ons"
        description="Optional modules tenants attach on top of their plan — billed monthly, prorated when attached mid-period."
        actions={
          canWrite ? (
            <>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setConvertPreview(null);
                  setConverting(true);
                }}
              >
                Convert feature to add-on
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={openCreate}
              >
                New add-on
              </button>
            </>
          ) : undefined
        }
      />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {loading && addOns.length === 0 ? <Skeleton /> : null}
      {!loading && addOns.length === 0 ? (
        <EmptyState icon={Puzzle} title="No add-ons yet">
          Create the first add-on, or convert an existing plan feature into
          one.
        </EmptyState>
      ) : null}
      <section className="plan-grid">
        {addOns.map((addOn) => (
          <article className="card plan-card" key={addOn.id}>
            <div className="plan-head">
              <div>
                <p className="eyebrow">{addOn.slug}</p>
                <h2>
                  <button
                    type="button"
                    className="plan-title"
                    onClick={() => openEdit(addOn)}
                    disabled={!canWrite || !!busy}
                    aria-label={`Edit add-on ${addOn.name}`}
                  >
                    {addOn.name}
                  </button>
                </h2>
              </div>
              <span className="badge badge--neutral">
                {addOn.isPublic ? 'Public' : 'Private'}
              </span>
            </div>
            <p className="muted-note">
              {addOn.description || 'No description'}
            </p>
            <dl className="facts">
              <div>
                <dt>Price</dt>
                <dd>
                  {formatMoney(addOn.price, addOn.currency)}/
                  {addOn.interval === 'YEARLY' ? 'yr' : 'mo'}
                  {addOn.metering
                    ? ` + ${formatMoney(addOn.metering.ratePerUnit, addOn.currency)}/order`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>Features</dt>
                <dd>{addOn.features.length}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge
                    status={addOn.isActive ? 'ACTIVE' : 'INACTIVE'}
                  />
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(addOn.createdAt)}</dd>
              </div>
            </dl>
            {attachedFor === addOn.id ? (
              attachedLoading ? (
                <Skeleton />
              ) : attached.length === 0 ? (
                <p className="muted-note">No tenants have this add-on.</p>
              ) : (
                <ul className="muted-note">
                  {attached.map((tenant) => (
                    <li key={tenant.tenantId}>
                      <Link
                        to="/tenants/$tenantId"
                        params={{ tenantId: tenant.tenantId }}
                        className="table-link"
                      >
                        {tenant.tenantName}
                      </Link>{' '}
                      ({tenant.tenantSlug})
                    </li>
                  ))}
                </ul>
              )
            ) : null}
            <div className="button-row">
              <button
                type="button"
                className="button"
                onClick={() => void showAttached(addOn)}
                disabled={!!busy}
              >
                {attachedFor === addOn.id ? 'Hide tenants' : 'Attached tenants'}
              </button>
              {canWrite ? (
                <>
                  <button
                    type="button"
                    className="button"
                    onClick={() => openEdit(addOn)}
                    disabled={!!busy}
                  >
                    Edit
                  </button>
                  {addOn.isActive ? (
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => setArchiving(addOn)}
                      disabled={!!busy}
                    >
                      Archive
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      <Modal
        open={creating}
        title="New add-on"
        wide
        onClose={() => setCreating(false)}
      >
        <form onSubmit={submitCreate}>
          {formFields}
          <div className="form-actions">
            <button
              type="submit"
              className="button button--accent"
              disabled={busy === 'create'}
            >
              {busy === 'create' ? 'Creating…' : 'Create add-on'}
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
        title={editing ? `Edit ${editing.name}` : 'Edit add-on'}
        wide
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form onSubmit={submitEdit}>
            {formFields}
            <p className="muted-note muted-note--gap-top">
              The slug cannot change after creation.
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
        open={converting}
        title="Convert feature to add-on"
        wide
        onClose={() => setConverting(false)}
      >
        <form onSubmit={convertDryRun}>
          <p className="muted-note muted-note--gap-bottom">
            Moves a feature out of plans into its own priced add-on: the
            feature leaves every plan version (new versions are created), and
            every tenant that had it gets the add-on attached. Preview first
            — nothing changes until you apply.
          </p>
          <div className="inline-form">
            <label>
              Feature key
              <input
                value={convertFeatureKey}
                onChange={(event) =>
                  setConvertFeatureKey(event.target.value)
                }
                placeholder="admin_reports"
                required
              />
            </label>
            <label>
              Add-on price (BDT/month)
              <input
                type="number"
                min={0}
                step="0.01"
                value={convertPrice}
                onChange={(event) => setConvertPrice(event.target.value)}
                required
              />
            </label>
            <label>
              Name (optional — defaults to the feature key)
              <input
                value={convertName}
                onChange={(event) => setConvertName(event.target.value)}
                placeholder="Reports"
              />
            </label>
            <label>
              Description (optional)
              <input
                value={convertDescription}
                onChange={(event) =>
                  setConvertDescription(event.target.value)
                }
              />
            </label>
          </div>
          {convertPreview ? (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Dry-run preview</h2>
                  <p>
                    {convertPreview.affectedPlans?.length ?? 0} plan
                    {(convertPreview.affectedPlans?.length ?? 0) === 1
                      ? ''
                      : 's'}{' '}
                    and {convertPreview.affectedTenants ?? 0} tenant
                    {(convertPreview.affectedTenants ?? 0) === 1 ? '' : 's'}{' '}
                    affected. New add-on slug: {convertPreview.slug}.
                  </p>
                </div>
              </div>
              {(convertPreview.affectedPlans ?? []).length > 0 ? (
                <ul className="muted-note">
                  {convertPreview.affectedPlans?.map((plan) => (
                    <li key={plan.planId}>
                      Plan: {plan.planName} (new version will be created)
                    </li>
                  ))}
                  {(convertPreview.tenants ?? []).slice(0, 10).map((tenant) => (
                    <li key={tenant.tenantId}>
                      Tenant: {tenant.tenantName} ({tenant.tenantSlug})
                    </li>
                  ))}
                  {(convertPreview.tenants ?? []).length > 10 ? (
                    <li>
                      …and {(convertPreview.tenants ?? []).length - 10} more
                      tenants
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="muted-note">
                  No plan currently includes this feature — the add-on will
                  be created but attached to nobody.
                </p>
              )}
            </section>
          ) : null}
          <div className="form-actions">
            {convertPreview ? (
              <button
                type="button"
                className="button button--accent"
                onClick={() => void convertApply()}
                disabled={busy === 'convert-apply'}
              >
                {busy === 'convert-apply'
                  ? 'Applying…'
                  : `Apply conversion (${convertPreview.affectedTenants ?? 0} tenants)`}
              </button>
            ) : (
              <button
                type="submit"
                className="button button--accent"
                disabled={busy === 'convert-preview'}
              >
                {busy === 'convert-preview' ? 'Checking…' : 'Preview impact'}
              </button>
            )}
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setConverting(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      {archiving ? (
        <ConfirmDialog
          open
          title={`Archive ${archiving.name}?`}
          body="The add-on stops being offered. Tenants that already have it attached keep it until detached."
          confirmLabel="Archive add-on"
          danger
          busy={busy === `archive:${archiving.id}`}
          onConfirm={() => void archiveAddOn()}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </>
  );
}
