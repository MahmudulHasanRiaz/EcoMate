import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import {
  ConfirmDialog,
  ErrorNote,
  Modal,
  Skeleton,
  StatusBadge,
} from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatMoney } from '../lib/format';
import {
  BLOCKING_AREAS,
  BLOCKING_AREA_LABELS,
  effectSummary,
  formatMoney2dp,
  OVERRIDE_LABELS,
  parsePricingDocument,
  traceSourceLabel,
} from '../lib/pricing';
import type {
  AddOn,
  BlockingArea,
  BlockingMode,
  OneTimeFee,
  PricingPreview,
  SubscriptionAddOn,
  Tenant,
  TenantBlockingOverride,
  TenantPricingOverride,
  TenantPurchase,
} from '../types';
import { LIMIT_KEYS, LIMIT_LABELS } from './plans-pricing';

interface OverridesResponse {
  tenantId: string;
  planValues: { per_order_rate: number | null; minimum_monthly: number | null };
  overrides: TenantPricingOverride[];
}

interface BlockingResponse {
  tenantId: string;
  override: TenantBlockingOverride | null;
  planBlocking: { mode: BlockingMode; blockedAreas: BlockingArea[] } | null;
  effective: { mode: BlockingMode; blockedAreas: BlockingArea[] };
  blockedAreasNow: BlockingArea[];
}

function sourceNote(source: string | undefined): string | null {
  if (!source || source === 'plan') return null;
  return traceSourceLabel(source);
}

/**
 * Pricing card for the tenant detail page (design §8): the effective
 * pricing (plan values with overridden values highlighted), the
 * per-client overrides editor, one-time purchases (sell + cancel),
 * attached add-ons, the blocking override, and free periods remaining.
 * Writes are SUPERADMIN/BILLING only (mirrors the API roles).
 */
export function TenantPricingCard({ tenant }: { tenant: Tenant }) {
  const { api, session } = useAuth();
  const tenantId = tenant.id;
  const canWrite =
    session?.user.role === 'SUPERADMIN' || session?.user.role === 'BILLING';
  const version =
    tenant.subscription?.planVersion ?? tenant.planVersion ?? null;
  const planId = (version as { planId?: string } | null)?.planId ?? null;
  const pricing = parsePricingDocument(version?.pricing);
  const freePeriods = tenant.subscription?.freePeriodsRemaining;

  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [previewOrders, setPreviewOrders] = useState('0');
  const [overrides, setOverrides] = useState<OverridesResponse | null>(null);
  const [purchases, setPurchases] = useState<TenantPurchase[]>([]);
  const [blocking, setBlocking] = useState<BlockingResponse | null>(null);
  const [attached, setAttached] = useState<SubscriptionAddOn[]>([]);
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  // Override editor state (key -> { value, note }).
  const [overrideInputs, setOverrideInputs] = useState<
    Record<string, { value: string; note: string }>
  >({});
  // Sell one-time dialog state.
  const [selling, setSelling] = useState(false);
  const [sellMode, setSellMode] = useState<'fee' | 'custom'>('fee');
  const [sellFeeKey, setSellFeeKey] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customType, setCustomType] = useState<
    'setup' | 'limit_increase' | 'rate_tier' | 'feature_unlock'
  >('setup');
  const [customLimitKey, setCustomLimitKey] = useState('products');
  const [customLimitDelta, setCustomLimitDelta] = useState('');
  const [customRate, setCustomRate] = useState('');
  const [customFeatures, setCustomFeatures] = useState('');
  const [cancelling, setCancelling] = useState<TenantPurchase | null>(null);
  // Add-on attach state.
  const [attachAddOnId, setAttachAddOnId] = useState('');
  const [attachEffectiveAt, setAttachEffectiveAt] = useState<
    'immediate' | 'next_period'
  >('immediate');
  const [detaching, setDetaching] = useState<SubscriptionAddOn | null>(null);
  // Blocking override editor state.
  const [blockingMode, setBlockingMode] =
    useState<BlockingMode>('grace_then_block');
  const [blockingAreas, setBlockingAreas] = useState<BlockingArea[]>([]);
  const [blockingNote, setBlockingNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const orders = Number(previewOrders);
    const previewPromise =
      planId && version
        ? api(
            `/plans/${planId}/versions/${version.id}/pricing-preview?tenantId=${tenantId}&orders=${Number.isInteger(orders) && orders >= 0 ? orders : 0}`,
          ).then((r) => readJson<PricingPreview>(r))
        : Promise.resolve(null);
    Promise.all([
      previewPromise,
      api(`/tenants/${tenantId}/pricing-overrides`).then((r) =>
        readJson<OverridesResponse>(r),
      ),
      api(`/tenants/${tenantId}/purchases`).then((r) =>
        readJson<TenantPurchase[]>(r),
      ),
      api(`/tenants/${tenantId}/blocking-override`).then((r) =>
        readJson<BlockingResponse>(r),
      ),
      api(`/tenants/${tenantId}/add-ons`).then((r) =>
        readJson<SubscriptionAddOn[]>(r),
      ),
      api('/add-ons').then((r) => readJson<AddOn[]>(r)),
    ])
      .then(
        ([
          previewResult,
          overridesResult,
          purchasesResult,
          blockingResult,
          attachedResult,
          addOnsResult,
        ]) => {
          if (cancelled) return;
          setPreview(previewResult);
          setOverrides(overridesResult);
          setPurchases(purchasesResult);
          setBlocking(blockingResult);
          setAttached(attachedResult);
          setAddOns(addOnsResult);
          setOverrideInputs(
            Object.fromEntries(
              (overridesResult.overrides ?? []).map((row) => [
                row.key,
                { value: String(row.value), note: row.note ?? '' },
              ]),
            ),
          );
          setBlockingMode(
            blockingResult.override?.mode ??
              blockingResult.planBlocking?.mode ??
              'grace_then_block',
          );
          setBlockingAreas(
            blockingResult.override?.blockedAreas ??
              blockingResult.planBlocking?.blockedAreas ??
              [],
          );
          setBlockingNote(blockingResult.override?.note ?? '');
          setError(null);
        },
      )
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, tenantId, reload, previewOrders, planId, version?.id]);

  async function saveOverride(key: string) {
    const input = overrideInputs[key] ?? { value: '', note: '' };
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) {
      setError(`${OVERRIDE_LABELS[key] ?? key} must be a number of 0 or more.`);
      return;
    }
    setBusy(`override:${key}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/tenants/${tenantId}/pricing-overrides`, {
        method: 'POST',
        body: JSON.stringify({
          key,
          value,
          note: input.note.trim() || undefined,
        }),
      }).then((r) => readJson(r));
      setNotice(`${OVERRIDE_LABELS[key] ?? key} override saved.`);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteOverride(key: string) {
    setBusy(`override-del:${key}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/tenants/${tenantId}/pricing-overrides/${key}`, {
        method: 'DELETE',
      }).then((r) => readJson(r));
      setNotice(`${OVERRIDE_LABELS[key] ?? key} override removed — the plan value applies again.`);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function sellPurchase() {
    setBusy('sell');
    setError(null);
    setNotice(null);
    try {
      let body: Record<string, unknown>;
      if (sellMode === 'fee') {
        if (!sellFeeKey) {
          setError('Pick a one-time fee from the plan.');
          setBusy(null);
          return;
        }
        body = { feeKey: sellFeeKey };
      } else {
        const amount = Number(customAmount);
        if (!customLabel.trim()) {
          setError('Give the custom fee a label.');
          setBusy(null);
          return;
        }
        if (!Number.isFinite(amount) || amount < 0) {
          setError('Amount must be a number of 0 or more.');
          setBusy(null);
          return;
        }
        let effect: Record<string, unknown>;
        if (customType === 'setup') {
          effect = { type: 'setup' };
        } else if (customType === 'limit_increase') {
          const delta = Number(customLimitDelta);
          if (!Number.isInteger(delta) || delta <= 0) {
            setError('Limit increase needs a positive whole-number delta.');
            setBusy(null);
            return;
          }
          effect = { type: 'limit_increase', limits: { [customLimitKey]: delta } };
        } else if (customType === 'rate_tier') {
          const rate = Number(customRate);
          if (!Number.isFinite(rate) || rate < 0) {
            setError('Per-order rate must be a number of 0 or more.');
            setBusy(null);
            return;
          }
          effect = { type: 'rate_tier', perOrderRate: rate };
        } else {
          const features = customFeatures
            .split(',')
            .map((feature) => feature.trim())
            .filter(Boolean);
          if (features.length === 0) {
            setError('List at least one feature key to unlock.');
            setBusy(null);
            return;
          }
          effect = { type: 'feature_unlock', features };
        }
        body = {
          custom: { label: customLabel.trim(), amount, effect },
        };
      }
      const created = await api(`/tenants/${tenantId}/purchases`, {
        method: 'POST',
        body: JSON.stringify(body),
      }).then((r) => readJson<TenantPurchase>(r));
      setNotice(
        `One-time purchase "${created.label}" created — invoice ${created.invoice?.number ?? ''} is open. The effect applies once the payment proof is approved.`,
      );
      setSelling(false);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancelPurchase() {
    if (!cancelling) return;
    setBusy(`cancel:${cancelling.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/tenants/${tenantId}/purchases/${cancelling.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((r) => readJson(r));
      setNotice(`Purchase "${cancelling.label}" cancelled and its open invoice voided.`);
      setCancelling(null);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function attachAddOn() {
    if (!attachAddOnId) {
      setError('Pick an add-on to attach.');
      return;
    }
    setBusy('attach');
    setError(null);
    setNotice(null);
    try {
      const result = await api(
        `/tenants/${tenantId}/add-ons/${attachAddOnId}/attach`,
        {
          method: 'POST',
          body: JSON.stringify({ effectiveAt: attachEffectiveAt }),
        },
      ).then((r) => readJson<SubscriptionAddOn>(r));
      setNotice(
        result.invoice
          ? `Add-on attached — prorated invoice ${result.invoice.number} (${formatMoney(result.invoice.total, 'BDT')}) created for the rest of this period.`
          : 'Add-on attached — it takes effect next period, so no proration invoice was created.',
      );
      setAttachAddOnId('');
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function detachAddOn() {
    if (!detaching) return;
    setBusy(`detach:${detaching.addOnId}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/tenants/${tenantId}/add-ons/${detaching.addOnId}`, {
        method: 'DELETE',
        body: JSON.stringify({ effectiveAt: 'immediate' }),
      }).then((r) => readJson(r));
      setNotice(`Add-on "${detaching.addOn?.name ?? ''}" detached.`);
      setDetaching(null);
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveBlocking() {
    setBusy('blocking');
    setError(null);
    setNotice(null);
    try {
      await api(`/tenants/${tenantId}/blocking-override`, {
        method: 'PUT',
        body: JSON.stringify({
          mode: blockingMode,
          blockedAreas: blockingAreas,
          note: blockingNote.trim() || undefined,
        }),
      }).then((r) => readJson(r));
      setNotice('Blocking override saved — it replaces the plan blocking for this tenant.');
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteBlocking() {
    setBusy('blocking-del');
    setError(null);
    setNotice(null);
    try {
      await api(`/tenants/${tenantId}/blocking-override`, {
        method: 'DELETE',
      }).then((r) => readJson(r));
      setNotice('Blocking override removed — the plan blocking applies again.');
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const effective = preview?.effectivePricing;
  const rateNote = sourceNote(preview?.sources.ratePerUnit);
  const minNote = sourceNote(preview?.sources.minimumMonthly);
  const baseNote = sourceNote(preview?.sources.baseFee);
  const planFees: OneTimeFee[] = pricing?.oneTimeFees ?? [];
  const attachable = addOns.filter(
    (addOn) =>
      addOn.isActive &&
      !attached.some(
        (row) => row.addOnId === addOn.id && !row.endedAt,
      ),
  );

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Pricing</h2>
          <p>
            Effective pricing, per-client overrides, one-time purchases,
            add-ons and strict blocking.
          </p>
        </div>
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {loading ? (
        <Skeleton />
      ) : (
        <>
          <h3 className="subhead">Effective pricing</h3>
          {!version ? (
            <p className="muted-note">
              This tenant has no plan version yet — assign a plan first.
            </p>
          ) : (
            <>
              <dl className="facts">
                <div>
                  <dt>Plan</dt>
                  <dd>
                    {preview?.planName ?? '—'} v{preview?.version ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt>Base fee</dt>
                  <dd>
                    {formatMoney2dp(
                      effective?.baseFee?.amount ?? Number(version.price),
                      effective?.baseFee?.currency ?? version.currency,
                    )}
                    {baseNote ? (
                      <span className="badge badge--accent">{baseNote}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Per-order rate</dt>
                  <dd>
                    {effective?.metering
                      ? `${formatMoney2dp(effective.metering.ratePerUnit, effective.baseFee?.currency ?? version.currency)}/order`
                      : '—'}
                    {rateNote ? (
                      <span className="badge badge--accent">{rateNote}</span>
                    ) : null}
                    {rateNote && overrides?.planValues.per_order_rate !== null ? (
                      <span className="muted-note">
                        {' '}
                        plan says{' '}
                        {formatMoney2dp(
                          overrides?.planValues.per_order_rate,
                          version.currency,
                        )}
                        /order
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Minimum monthly</dt>
                  <dd>
                    {effective?.metering?.minimumMonthly
                      ? formatMoney2dp(
                          effective.metering.minimumMonthly,
                          effective.baseFee?.currency ?? version.currency,
                        )
                      : 'None'}
                    {minNote ? (
                      <span className="badge badge--accent">{minNote}</span>
                    ) : null}
                    {minNote && overrides?.planValues.minimum_monthly !== null ? (
                      <span className="muted-note">
                        {' '}
                        plan says{' '}
                        {formatMoney2dp(
                          overrides?.planValues.minimum_monthly,
                          version.currency,
                        )}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt>Free periods remaining</dt>
                  <dd>
                    {freePeriods === undefined || freePeriods === null
                      ? '—'
                      : `${freePeriods} period${freePeriods === 1 ? '' : 's'} at ৳0`}
                  </dd>
                </div>
              </dl>
              <div className="inline-form">
                <label>
                  Preview bill for (orders this period)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={previewOrders}
                    onChange={(event) => setPreviewOrders(event.target.value)}
                  />
                </label>
              </div>
              {preview ? (
                <p className="muted-note">
                  {preview.bill.lines.map((line) => line.description).join(' · ')}
                  {' — '}
                  <strong>
                    {formatMoney2dp(
                      preview.bill.total,
                      effective?.baseFee?.currency ?? version.currency,
                    )}
                  </strong>
                </p>
              ) : null}
            </>
          )}

          <h3 className="subhead">Per-client overrides</h3>
          <p className="muted-note">
            A per-client rate or minimum replaces the plan value for this
            tenant only, even on the same public plan. Changes are audited.
          </p>
          {(['per_order_rate', 'minimum_monthly'] as const).map((key) => {
            const input = overrideInputs[key] ?? { value: '', note: '' };
            const planValue = overrides?.planValues[key];
            const hasOverride = (overrides?.overrides ?? []).some(
              (row) => row.key === key,
            );
            return (
              <div className="inline-form" key={key}>
                <label>
                  {OVERRIDE_LABELS[key]}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={input.value}
                    onChange={(event) =>
                      setOverrideInputs((prev) => ({
                        ...prev,
                        [key]: { ...input, value: event.target.value },
                      }))
                    }
                    placeholder={
                      planValue === null || planValue === undefined
                        ? 'Plan has no value'
                        : `Plan: ${planValue}`
                    }
                    disabled={!canWrite}
                  />
                </label>
                <label>
                  Note (optional)
                  <input
                    value={input.note}
                    onChange={(event) =>
                      setOverrideInputs((prev) => ({
                        ...prev,
                        [key]: { ...input, note: event.target.value },
                      }))
                    }
                    placeholder="Why this client pays differently"
                    disabled={!canWrite}
                  />
                </label>
                {canWrite ? (
                  <div className="button-row">
                    <button
                      type="button"
                      className="button button--accent"
                      onClick={() => void saveOverride(key)}
                      disabled={busy === `override:${key}`}
                    >
                      {busy === `override:${key}` ? 'Saving…' : 'Save override'}
                    </button>
                    {hasOverride ? (
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => void deleteOverride(key)}
                        disabled={busy === `override-del:${key}`}
                      >
                        Remove override
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          <h3 className="subhead">One-time purchases</h3>
          {canWrite ? (
            <div className="button-row">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  setSellMode('fee');
                  setSellFeeKey(planFees[0]?.key ?? '');
                  setSelling(true);
                }}
              >
                Sell one-time
              </button>
            </div>
          ) : null}
          {purchases.length === 0 ? (
            <p className="muted-note">No one-time purchases yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fee</th>
                    <th>Amount</th>
                    <th>Effect</th>
                    <th>Status</th>
                    <th>Invoice</th>
                    <th>Created</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td>{purchase.label}</td>
                      <td>
                        {formatMoney(purchase.amount, purchase.currency)}
                      </td>
                      <td>{effectSummary(purchase.effect)}</td>
                      <td>
                        <StatusBadge status={purchase.status} />
                      </td>
                      <td>
                        {purchase.invoice
                          ? purchase.invoice.number
                          : '—'}
                      </td>
                      <td>{formatDate(purchase.createdAt)}</td>
                      <td>
                        {canWrite && purchase.status === 'PENDING' ? (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            onClick={() => setCancelling(purchase)}
                            disabled={!!busy}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="subhead">Add-ons</h3>
          {attached.filter((row) => !row.endedAt).length === 0 ? (
            <p className="muted-note">No add-ons attached.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Add-on</th>
                    <th>Price</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {attached
                    .filter((row) => !row.endedAt)
                    .map((row) => (
                      <tr key={row.id}>
                        <td>{row.addOn?.name ?? row.addOnId}</td>
                        <td>
                          {row.addOn
                            ? `${formatMoney(row.addOn.price, row.addOn.currency)}/${row.addOn.interval === 'YEARLY' ? 'yr' : 'mo'}`
                            : '—'}
                        </td>
                        <td>{formatDate(row.startedAt)}</td>
                        <td>
                          {canWrite ? (
                            <button
                              type="button"
                              className="button button--ghost button--sm"
                              onClick={() => setDetaching(row)}
                              disabled={!!busy}
                            >
                              Detach
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {canWrite && attachable.length > 0 ? (
            <div className="inline-form">
              <label>
                Attach add-on
                <select
                  value={attachAddOnId}
                  onChange={(event) => setAttachAddOnId(event.target.value)}
                >
                  <option value="">Pick an add-on…</option>
                  {attachable.map((addOn) => (
                    <option key={addOn.id} value={addOn.id}>
                      {addOn.name} —{' '}
                      {formatMoney(addOn.price, addOn.currency)}/
                      {addOn.interval === 'YEARLY' ? 'yr' : 'mo'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Effective
                <select
                  value={attachEffectiveAt}
                  onChange={(event) =>
                    setAttachEffectiveAt(
                      event.target.value as 'immediate' | 'next_period',
                    )
                  }
                >
                  <option value="immediate">
                    Immediately (prorated invoice)
                  </option>
                  <option value="next_period">Next period (no invoice)</option>
                </select>
              </label>
              <div className="button-row">
                <button
                  type="button"
                  className="button button--accent"
                  onClick={() => void attachAddOn()}
                  disabled={busy === 'attach' || !attachAddOnId}
                >
                  {busy === 'attach' ? 'Attaching…' : 'Attach'}
                </button>
              </div>
            </div>
          ) : null}

          <h3 className="subhead">Strict blocking</h3>
          <p className="muted-note">
            Effective:{' '}
            {blocking?.effective.mode === 'block_immediately'
              ? 'block immediately'
              : 'block after grace'}
            {', '}
            {(blocking?.effective.blockedAreas ?? []).length === 0
              ? 'no areas blocked'
              : blocking?.effective.blockedAreas
                  .map((area) => BLOCKING_AREA_LABELS[area])
                  .join(', ')}
            {blocking?.override ? ' (per-client override)' : ' (from the plan)'}.
            {blocking && blocking.blockedAreasNow.length > 0 ? (
              <>
                {' '}
                Currently blocked:{' '}
                {blocking.blockedAreasNow
                  .map((area) => BLOCKING_AREA_LABELS[area])
                  .join(', ')}
                .
              </>
            ) : null}
          </p>
          <div className="inline-form">
            <label>
              Blocking mode
              <select
                value={blockingMode}
                onChange={(event) =>
                  setBlockingMode(event.target.value as BlockingMode)
                }
                disabled={!canWrite}
              >
                <option value="grace_then_block">
                  Block after the grace period
                </option>
                <option value="block_immediately">
                  Block immediately when past due
                </option>
              </select>
            </label>
            <label>
              Note (optional)
              <input
                value={blockingNote}
                onChange={(event) => setBlockingNote(event.target.value)}
                placeholder="Why this client blocks differently"
                disabled={!canWrite}
              />
            </label>
          </div>
          <div className="domain-flags">
            {BLOCKING_AREAS.map((area) => (
              <label key={area}>
                <input
                  type="checkbox"
                  checked={blockingAreas.includes(area)}
                  onChange={(event) =>
                    setBlockingAreas((prev) =>
                      event.target.checked
                        ? [...prev, area]
                        : prev.filter((a) => a !== area),
                    )
                  }
                  disabled={!canWrite}
                />
                {BLOCKING_AREA_LABELS[area]}
              </label>
            ))}
          </div>
          {canWrite ? (
            <div className="button-row">
              <button
                type="button"
                className="button button--accent"
                onClick={() => void saveBlocking()}
                disabled={busy === 'blocking'}
              >
                {busy === 'blocking' ? 'Saving…' : 'Save blocking override'}
              </button>
              {blocking?.override ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void deleteBlocking()}
                  disabled={busy === 'blocking-del'}
                >
                  Revert to plan blocking
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={selling}
        title="Sell one-time fee"
        wide
        onClose={() => setSelling(false)}
      >
        <div className="inline-form">
          <label>
            Source
            <select
              value={sellMode}
              onChange={(event) =>
                setSellMode(event.target.value as 'fee' | 'custom')
              }
            >
              <option value="fee">From the plan&apos;s one-time fees</option>
              <option value="custom">Custom fee (no new version needed)</option>
            </select>
          </label>
          {sellMode === 'fee' ? (
            <label>
              Fee
              <select
                value={sellFeeKey}
                onChange={(event) => setSellFeeKey(event.target.value)}
              >
                {planFees.length === 0 ? (
                  <option value="">
                    This plan version has no one-time fees
                  </option>
                ) : null}
                {planFees.map((fee) => (
                  <option key={fee.key} value={fee.key}>
                    {fee.label} — {formatMoney(fee.amount, 'BDT')} (
                    {effectSummary(fee.effect)})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Label
                <input
                  value={customLabel}
                  onChange={(event) => setCustomLabel(event.target.value)}
                  placeholder="Onboarding setup"
                  required
                />
              </label>
              <label>
                Amount (BDT)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={customAmount}
                  onChange={(event) => setCustomAmount(event.target.value)}
                  required
                />
              </label>
              <label>
                Effect
                <select
                  value={customType}
                  onChange={(event) =>
                    setCustomType(
                      event.target.value as typeof customType,
                    )
                  }
                >
                  <option value="setup">Setup fee (no effect)</option>
                  <option value="limit_increase">Limit increase</option>
                  <option value="rate_tier">Per-order rate tier</option>
                  <option value="feature_unlock">Feature unlock</option>
                </select>
              </label>
              {customType === 'limit_increase' ? (
                <>
                  <label>
                    Limit
                    <select
                      value={customLimitKey}
                      onChange={(event) =>
                        setCustomLimitKey(event.target.value)
                      }
                    >
                      {LIMIT_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {LIMIT_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Increase by
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={customLimitDelta}
                      onChange={(event) =>
                        setCustomLimitDelta(event.target.value)
                      }
                      placeholder="200"
                      required
                    />
                  </label>
                </>
              ) : null}
              {customType === 'rate_tier' ? (
                <label>
                  New per-order rate (BDT)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={customRate}
                    onChange={(event) => setCustomRate(event.target.value)}
                    placeholder="1.50"
                    required
                  />
                </label>
              ) : null}
              {customType === 'feature_unlock' ? (
                <label>
                  Features to unlock (comma-separated keys)
                  <input
                    value={customFeatures}
                    onChange={(event) =>
                      setCustomFeatures(event.target.value)
                    }
                    placeholder="admin_reports"
                    required
                  />
                </label>
              ) : null}
            </>
          )}
        </div>
        <p className="muted-note">
          Selling creates a one-time invoice. The effect applies once the
          payment proof is approved — paying never extends the subscription.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={() => void sellPurchase()}
            disabled={busy === 'sell'}
          >
            {busy === 'sell' ? 'Creating…' : 'Create purchase + invoice'}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setSelling(false)}
          >
            Cancel
          </button>
        </div>
      </Modal>

      {cancelling ? (
        <ConfirmDialog
          open
          title={`Cancel "${cancelling.label}"?`}
          body="The purchase is cancelled and its open invoice voided. Only pending purchases can be cancelled."
          confirmLabel="Cancel purchase"
          danger
          busy={busy === `cancel:${cancelling.id}`}
          onConfirm={() => void cancelPurchase()}
          onClose={() => setCancelling(null)}
        />
      ) : null}

      {detaching ? (
        <ConfirmDialog
          open
          title={`Detach "${detaching.addOn?.name ?? 'add-on'}"?`}
          body="The add-on stops billing immediately and its features and limits leave the tenant at once."
          confirmLabel="Detach add-on"
          danger
          busy={busy === `detach:${detaching.addOnId}`}
          onConfirm={() => void detachAddOn()}
          onClose={() => setDetaching(null)}
        />
      ) : null}
    </section>
  );
}
