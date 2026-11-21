import { useEffect, useMemo, useState } from 'react';
import { Info, Layers } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage } from '../lib/api';
import {
  bulkKind,
  convertFeature,
  fetchFeatureDetail,
  fetchFeatures,
  filterFeatures,
  groupFeaturesByCategory,
  kindBadgeTone,
  kindLabel,
  updateFeature,
} from '../lib/features';
import { formatMoney } from '../lib/format';
import type {
  ConvertFeatureResult,
  FeatureDetail,
  FeatureKind,
  FeatureSummary,
} from '../types';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';

/**
 * Features page (Boss point 1): every catalogue feature in one place,
 * grouped by A–O category, classified initial vs add-on (Boss's words).
 * Each feature has an i-button/detail view with its scope, what a
 * tenant without it cannot see or do, dependencies, the plans that
 * include it, and its linked add-on + price. Classification is open:
 * any feature (or bulk selection) can be marked initial/add-on, and an
 * initial feature can be converted to a paid add-on with a dry-run
 * preview + grandfathering (pricing design §10.3).
 */
export function FeaturesPage() {
  const { api } = useAuth();
  const { pushToast } = useToast();
  const [features, setFeatures] = useState<FeatureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<FeatureKind | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [bulkKindTarget, setBulkKindTarget] = useState<FeatureKind | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    fetchFeatures(api)
      .then((result) => {
        setFeatures(result);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [api]);

  const categories = useMemo(
    () => [...new Set(features.map((feature) => feature.category))].sort(),
    [features],
  );
  const filtered = useMemo(
    () =>
      filterFeatures(features, {
        search,
        kind: kindFilter,
        category: categoryFilter,
      }),
    [features, search, kindFilter, categoryFilter],
  );
  const groups = useMemo(
    () => groupFeaturesByCategory(filtered),
    [filtered],
  );
  const counts = useMemo(() => {
    const addOn = features.filter((f) => f.kind === 'add-on').length;
    return { total: features.length, addOn, initial: features.length - addOn };
  }, [features]);

  const toggleSelect = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (keys: string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = keys.every((key) => next.has(key));
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  async function applyBulkKind() {
    if (!bulkKindTarget) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bulkKind(api, [...selected], bulkKindTarget);
      pushToast(
        `${result.updated} feature${result.updated === 1 ? '' : 's'} marked ${kindLabel(bulkKindTarget).toLowerCase()}.`,
        'success',
      );
      setSelected(new Set());
      setBulkKindTarget(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
      setBulkKindTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Billing"
        title="Features"
        description={`Every feature in the catalogue, classified initial vs add-on. ${counts.initial} initial · ${counts.addOn} add-on · ${counts.total} total.`}
      />

      <div className="toolbar">
        <div className="toolbar-search">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search features"
            aria-label="Search features"
          />
        </div>
        <label className="toolbar-filter">
          <span>Kind</span>
          <select
            value={kindFilter}
            onChange={(event) =>
              setKindFilter(event.target.value as FeatureKind | '')
            }
          >
            <option value="">All kinds</option>
            <option value="initial">Initial</option>
            <option value="add-on">Add-on</option>
          </select>
        </label>
        <label className="toolbar-filter">
          <span>Category</span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected.size > 0 ? (
        <div className="notice" role="status">
          {selected.size} feature{selected.size === 1 ? '' : 's'} selected.{' '}
          <button
            type="button"
            className="button button--sm"
            disabled={busy}
            onClick={() => setBulkKindTarget('add-on')}
          >
            Mark as add-on
          </button>{' '}
          <button
            type="button"
            className="button button--sm"
            disabled={busy}
            onClick={() => setBulkKindTarget('initial')}
          >
            Mark as initial
          </button>{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      {error ? <ErrorNote message={error} /> : null}
      {loading ? <Skeleton /> : null}

      {!loading && groups.length === 0 ? (
        <EmptyState icon={Layers} title="No features match this filter">
          Try a different search, kind, or category.
        </EmptyState>
      ) : null}

      {!loading &&
        groups.map((group) => {
          const keys = group.features.map((feature) => feature.key);
          const allSelected = keys.every((key) => selected.has(key));
          return (
            <section className="card" key={group.category}>
              <div className="card-head">
                <div>
                  <h2>{group.category}</h2>
                  <p>
                    {group.features.length} feature
                    {group.features.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => toggleGroup(keys)}
                >
                  {allSelected ? 'Deselect group' : 'Select group'}
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th aria-label="Select">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => toggleGroup(keys)}
                          aria-label={`Select all in ${group.category}`}
                        />
                      </th>
                      <th>Feature</th>
                      <th>Kind</th>
                      <th>Depends on</th>
                      <th>Add-on</th>
                      <th aria-label="Details" />
                    </tr>
                  </thead>
                  <tbody>
                    {group.features.map((feature) => (
                      <tr key={feature.key}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(feature.key)}
                            onChange={() => toggleSelect(feature.key)}
                            aria-label={`Select ${feature.name}`}
                          />
                        </td>
                        <td>
                          {feature.name}
                          <span className="mono sub">{feature.key}</span>
                        </td>
                        <td>
                          <span
                            className={`badge badge--${kindBadgeTone(feature.kind)}`}
                          >
                            {kindLabel(feature.kind)}
                          </span>
                        </td>
                        <td>
                          {feature.dependencies.length > 0 ? (
                            <span className="mono sub">
                              {feature.dependencies.join(', ')}
                            </span>
                          ) : (
                            <span className="muted-note">—</span>
                          )}
                        </td>
                        <td>
                          {feature.addOn ? (
                            <span>
                              {feature.addOn.name}{' '}
                              <span className="muted-note">
                                {formatMoney(
                                  feature.addOn.price,
                                  feature.addOn.currency,
                                )}
                                /mo
                              </span>
                            </span>
                          ) : (
                            <span className="muted-note">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button--sm"
                            aria-label={`Details for ${feature.name}`}
                            onClick={() => setDetailKey(feature.key)}
                          >
                            <Info size={14} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

      {detailKey ? (
        <FeatureDetailDialog
          featureKey={detailKey}
          onClose={() => setDetailKey(null)}
          onChanged={load}
        />
      ) : null}

      <ConfirmDialog
        open={bulkKindTarget !== null}
        title={`Mark ${selected.size} feature${selected.size === 1 ? '' : 's'} as ${bulkKindTarget ? kindLabel(bulkKindTarget).toLowerCase() : ''}?`}
        body={
          <p>
            This only changes the classification shown on this page. It does
            not move any tenant or change any billing — the paid conversion
            is a separate step per feature.
          </p>
        }
        confirmLabel="Mark"
        busy={busy}
        onConfirm={() => void applyBulkKind()}
        onClose={() => setBulkKindTarget(null)}
      />
    </div>
  );
}

function FeatureDetailDialog({
  featureKey,
  onClose,
  onChanged,
}: {
  featureKey: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api } = useAuth();
  const { pushToast } = useToast();
  const [detail, setDetail] = useState<FeatureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<FeatureKind>('initial');
  const [scope, setScope] = useState('');
  const [withoutAccess, setWithoutAccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [convertPrice, setConvertPrice] = useState('');
  const [convertPreview, setConvertPreview] =
    useState<ConvertFeatureResult | null>(null);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertConfirm, setConvertConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFeatureDetail(api, featureKey)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setKind(result.kind);
        setScope(result.scope ?? '');
        setWithoutAccess(result.withoutAccess ?? '');
        setError(null);
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
  }, [api, featureKey]);

  async function save() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateFeature(api, featureKey, {
        kind,
        scope: scope.trim(),
        withoutAccess: withoutAccess.trim(),
      });
      pushToast(`"${updated.name}" saved.`, 'success');
      onChanged();
      setDetail((current) =>
        current ? { ...current, ...updated, plans: current.plans } : current,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function previewConvert() {
    const price = Number(convertPrice);
    if (!Number.isFinite(price) || price < 0) {
      setError('Price must be a number of 0 or more.');
      return;
    }
    setConvertBusy(true);
    setError(null);
    setConvertPreview(null);
    try {
      const result = await convertFeature(api, featureKey, {
        price,
        dryRun: true,
      });
      setConvertPreview(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setConvertBusy(false);
    }
  }

  async function applyConvert() {
    if (!convertPreview) return;
    const price = Number(convertPrice);
    setConvertBusy(true);
    setError(null);
    try {
      const result = await convertFeature(api, featureKey, {
        price,
        dryRun: false,
      });
      pushToast(
        `"${result.featureKey}" converted to add-on "${result.slug}" — attached to ${result.attached ?? 0} tenant${result.attached === 1 ? '' : 's'}, ${(result.plans ?? []).length} plan version${(result.plans ?? []).length === 1 ? '' : 's'} re-versioned.`,
        'success',
      );
      setConvertConfirm(false);
      setConvertPreview(null);
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setConvertConfirm(false);
    } finally {
      setConvertBusy(false);
    }
  }

  const dirty =
    detail !== null &&
    (kind !== detail.kind ||
      scope.trim() !== (detail.scope ?? '') ||
      withoutAccess.trim() !== (detail.withoutAccess ?? ''));

  return (
    <Modal open title={detail ? detail.name : featureKey} onClose={onClose} wide>
      {loading ? <Skeleton /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {detail ? (
        <div>
          <p className="muted-note">
            <span className="mono">{detail.key}</span> · {detail.category} ·{' '}
            <span className={`badge badge--${kindBadgeTone(detail.kind)}`}>
              {kindLabel(detail.kind)}
            </span>
          </p>

          <div className="inline-form">
            <label>
              Kind
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as FeatureKind)
                }
              >
                <option value="initial">Initial</option>
                <option value="add-on">Add-on</option>
              </select>
            </label>
          </div>
          <label>
            Scope (EN only)
            <textarea
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              rows={3}
              placeholder="What this feature covers."
            />
          </label>
          <label>
            Without access (EN only)
            <textarea
              value={withoutAccess}
              onChange={(event) => setWithoutAccess(event.target.value)}
              rows={3}
              placeholder="What a tenant without this feature cannot see or do."
            />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="button button--accent"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <h3>Depends on</h3>
          {detail.dependencies.length > 0 ? (
            <p className="mono sub">{detail.dependencies.join(', ')}</p>
          ) : (
            <p className="muted-note">
              No dependencies — this feature stands alone.
            </p>
          )}
          <p className="muted-note">
            Dependencies are shown for information; enforcement is per
            feature, not per dependency.
          </p>

          <h3>Plans including it</h3>
          {detail.plans.length === 0 ? (
            <p className="muted-note">
              No plan version includes this feature.
            </p>
          ) : (
            <ul>
              {detail.plans.map((plan) => (
                <li key={plan.versionId}>
                  {plan.planName} — v{plan.version}
                  {plan.isLatest ? ' (latest)' : ''} ·{' '}
                  {formatMoney(plan.price, plan.currency)}
                </li>
              ))}
            </ul>
          )}

          <h3>Add-on</h3>
          {detail.addOn ? (
            <p>
              <Link to="/add-ons">{detail.addOn.name}</Link> —{' '}
              {formatMoney(detail.addOn.price, detail.addOn.currency)}
              /mo
              {!detail.addOn.isActive ? ' (archived)' : ''}
            </p>
          ) : (
            <p className="muted-note">
              Not sold as an add-on yet.
            </p>
          )}

          {!detail.addOn ? (
            <div>
              <h3>Convert to add-on</h3>
              <p className="muted-note">
                Creates the add-on, attaches it to every tenant on a plan
                that includes this feature (grandfathered — no invoice for
                the first period), and re-versions those plans without the
                key. Tenants keep the feature through the add-on.
              </p>
              <div className="inline-form">
                <label>
                  Monthly price (BDT)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={convertPrice}
                    onChange={(event) => setConvertPrice(event.target.value)}
                    placeholder="299"
                  />
                </label>
              </div>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button"
                  disabled={convertBusy}
                  onClick={() => void previewConvert()}
                >
                  {convertBusy ? 'Working…' : 'Preview dry-run'}
                </button>
              </div>
              {convertPreview ? (
                <div>
                  <p>
                    <strong>{convertPreview.affectedPlans?.length ?? 0}</strong>{' '}
                    plan{(convertPreview.affectedPlans?.length ?? 0) === 1
                      ? ''
                      : 's'}{' '}
                    ·{' '}
                    <strong>{convertPreview.affectedTenants ?? 0}</strong>{' '}
                    affected tenant
                    {(convertPreview.affectedTenants ?? 0) === 1 ? '' : 's'}
                  </p>
                  {(convertPreview.affectedPlans ?? []).length > 0 ? (
                    <ul>
                      {convertPreview.affectedPlans?.map((plan) => (
                        <li key={plan.planId}>{plan.planName}</li>
                      ))}
                    </ul>
                  ) : null}
                  {(convertPreview.tenants ?? []).length > 0 ? (
                    <p className="muted-note">
                      Tenants:{' '}
                      {(convertPreview.tenants ?? [])
                        .slice(0, 10)
                        .map((tenant) => tenant.tenantName)
                        .join(', ')}
                      {(convertPreview.tenants ?? []).length > 10
                        ? `, +${(convertPreview.tenants ?? []).length - 10} more`
                        : ''}
                    </p>
                  ) : null}
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="button button--accent"
                      disabled={convertBusy}
                      onClick={() => setConvertConfirm(true)}
                    >
                      Convert
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={convertConfirm}
        title={`Convert "${detail?.name ?? featureKey}" to a paid add-on?`}
        body={
          <p>
            The add-on will be created at{' '}
            {formatMoney(Number(convertPrice) || 0, 'BDT')}
            /mo and attached to{' '}
            {convertPreview?.affectedTenants ?? 0} tenant
            {(convertPreview?.affectedTenants ?? 0) === 1 ? '' : 's'}{' '}
            (grandfathered — no first-period invoice), and{' '}
            {convertPreview?.affectedPlans?.length ?? 0} plan
            {(convertPreview?.affectedPlans?.length ?? 0) === 1 ? '' : 's'}{' '}
            will get a new version without this feature.
          </p>
        }
        confirmLabel="Convert"
        busy={convertBusy}
        onConfirm={() => void applyConvert()}
        onClose={() => setConvertConfirm(false)}
      />
    </Modal>
  );
}
