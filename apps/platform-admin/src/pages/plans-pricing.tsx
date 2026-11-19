import type {
  BlockingArea,
  BlockingMode,
  OneTimeFee,
  PricingDocument,
} from '../types';
import {
  BLOCKING_AREAS,
  BLOCKING_AREA_LABELS,
  meteringExampleLine,
} from '../lib/pricing';

export const LIMIT_KEYS = [
  'products',
  'staff_users',
  'orders_per_month',
  'storage_mb',
] as const;

export const LIMIT_LABELS: Record<string, string> = {
  products: 'Products',
  staff_users: 'Staff users',
  orders_per_month: 'Orders per month',
  storage_mb: 'Media storage (MB)',
};

export type PricingCycle = 'MONTHLY' | 'YEARLY' | 'WEEKLY_7D' | 'CUSTOM';

export interface OneTimeFeeForm {
  key: string;
  label: string;
  amount: string;
  effectType: 'setup' | 'limit_increase' | 'rate_tier' | 'feature_unlock';
  limitKey: string;
  limitDelta: string;
  perOrderRate: string;
  features: string;
}

export interface PricingForm {
  cycle: PricingCycle;
  intervalDays: string;
  meteringEnabled: boolean;
  meteringIncluded: string;
  meteringRate: string;
  meteringMinimum: string;
  freeMonths: string;
  oneTimeFees: OneTimeFeeForm[];
  overLimit: Record<string, 'block' | 'charge'>;
  blockingMode: BlockingMode;
  blockedAreas: BlockingArea[];
}

export const EMPTY_ONE_TIME_FEE: OneTimeFeeForm = {
  key: '',
  label: '',
  amount: '',
  effectType: 'setup',
  limitKey: 'products',
  limitDelta: '',
  perOrderRate: '',
  features: '',
};

export const EMPTY_PRICING_FORM: PricingForm = {
  cycle: 'MONTHLY',
  intervalDays: '',
  meteringEnabled: false,
  meteringIncluded: '0',
  meteringRate: '',
  meteringMinimum: '',
  freeMonths: '',
  oneTimeFees: [],
  overLimit: {},
  blockingMode: 'grace_then_block',
  blockedAreas: [],
};

/** Hydrate the pricing form from a stored document (new-version prefill). */
export function pricingFormFrom(
  pricing: PricingDocument | null | undefined,
  interval: string,
  intervalDays?: number | null,
): PricingForm {
  const cycle: PricingCycle =
    pricing?.billingCycle === 'WEEKLY_7D'
      ? 'WEEKLY_7D'
      : pricing?.billingCycle === 'YEARLY'
        ? 'YEARLY'
        : interval === 'CUSTOM' && intervalDays === 7
          ? 'WEEKLY_7D'
          : interval === 'CUSTOM'
            ? 'CUSTOM'
            : interval === 'YEARLY'
              ? 'YEARLY'
              : 'MONTHLY';
  const metering = pricing?.metering;
  return {
    cycle,
    intervalDays:
      cycle === 'CUSTOM' && intervalDays ? String(intervalDays) : '',
    meteringEnabled: !!metering,
    meteringIncluded: String(metering?.included ?? 0),
    meteringRate:
      metering?.ratePerUnit !== undefined ? String(metering.ratePerUnit) : '',
    meteringMinimum:
      metering?.minimumMonthly !== undefined &&
      metering.minimumMonthly !== null
        ? String(metering.minimumMonthly)
        : '',
    freeMonths:
      pricing?.freeMonths !== undefined && pricing.freeMonths > 0
        ? String(pricing.freeMonths)
        : '',
    oneTimeFees: (pricing?.oneTimeFees ?? []).map((fee) => {
      const base: OneTimeFeeForm = {
        ...EMPTY_ONE_TIME_FEE,
        key: fee.key,
        label: fee.label,
        amount: String(fee.amount),
        effectType: fee.effect.type,
      };
      if (fee.effect.type === 'limit_increase') {
        const [limitKey, limitDelta] = Object.entries(fee.effect.limits)[0] ?? [
          'products',
          0,
        ];
        base.limitKey = limitKey;
        base.limitDelta = String(limitDelta);
      } else if (fee.effect.type === 'rate_tier') {
        base.perOrderRate = String(fee.effect.perOrderRate);
      } else if (fee.effect.type === 'feature_unlock') {
        base.features = fee.effect.features.join(', ');
      }
      return base;
    }),
    overLimit: { ...(pricing?.overLimit ?? {}) },
    blockingMode: pricing?.blocking?.mode ?? 'grace_then_block',
    blockedAreas: [...(pricing?.blocking?.blockedAreas ?? [])],
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds the pricing document + interval fields for a version write.
 * The document drives price (baseFee) and interval (billingCycle) on the
 * server; the returned interval fields must agree with the cycle or the
 * server rejects the write (400), so they are derived here, never typed
 * separately.
 */
export function buildPricingBody(
  form: PricingForm,
  price: number,
  currency: string,
): {
  body: Record<string, unknown>;
} | { error: string } {
  const pricing: Record<string, unknown> = {
    pricingVersion: 1,
    baseFee: { amount: price, currency },
  };
  let interval: 'MONTHLY' | 'YEARLY' | 'CUSTOM' = 'MONTHLY';
  let intervalDays: number | undefined;
  if (form.cycle === 'MONTHLY') {
    pricing.billingCycle = 'MONTHLY';
  } else if (form.cycle === 'YEARLY') {
    pricing.billingCycle = 'YEARLY';
    interval = 'YEARLY';
  } else if (form.cycle === 'WEEKLY_7D') {
    pricing.billingCycle = 'WEEKLY_7D';
    interval = 'CUSTOM';
    intervalDays = 7;
  } else {
    const days = Number(form.intervalDays);
    if (!Number.isInteger(days) || days < 1) {
      return { error: 'A custom interval needs an interval length in days (1 or more).' };
    }
    interval = 'CUSTOM';
    intervalDays = days;
  }

  if (form.freeMonths.trim() !== '') {
    const months = Number(form.freeMonths);
    if (!Number.isInteger(months) || months < 0 || months > 120) {
      return { error: 'Free months must be a whole number between 0 and 120.' };
    }
    if (months > 0) pricing.freeMonths = months;
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
    pricing.metering = {
      metric: 'orders_per_month',
      included,
      ratePerUnit: rate,
      minimumMonthly: minimum,
    };
  }

  if (form.oneTimeFees.length > 0) {
    const fees: OneTimeFee[] = [];
    const seen = new Set<string>();
    for (const [index, fee] of form.oneTimeFees.entries()) {
      const at = `One-time fee ${index + 1}`;
      const key = slugify(fee.key || fee.label);
      if (!key) return { error: `${at}: give it a label (or a key).` };
      if (seen.has(key)) {
        return { error: `${at}: the key "${key}" is used twice.` };
      }
      seen.add(key);
      if (!fee.label.trim()) return { error: `${at}: label is required.` };
      const amount = Number(fee.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return { error: `${at}: amount must be a number of 0 or more.` };
      }
      let effect: OneTimeFee['effect'];
      if (fee.effectType === 'setup') {
        effect = { type: 'setup' };
      } else if (fee.effectType === 'limit_increase') {
        const delta = Number(fee.limitDelta);
        if (!Number.isInteger(delta) || delta <= 0) {
          return { error: `${at}: limit increase needs a positive whole-number delta.` };
        }
        effect = {
          type: 'limit_increase',
          limits: { [fee.limitKey]: delta },
        };
      } else if (fee.effectType === 'rate_tier') {
        const rate = Number(fee.perOrderRate);
        if (!Number.isFinite(rate) || rate < 0) {
          return { error: `${at}: per-order rate must be a number of 0 or more.` };
        }
        effect = { type: 'rate_tier', perOrderRate: rate };
      } else {
        const features = fee.features
          .split(',')
          .map((feature) => feature.trim())
          .filter(Boolean);
        if (features.length === 0) {
          return { error: `${at}: list at least one feature key to unlock.` };
        }
        effect = { type: 'feature_unlock', features };
      }
      fees.push({ key, label: fee.label.trim(), amount, effect });
    }
    pricing.oneTimeFees = fees;
  }

  const overLimit: Record<string, 'block' | 'charge'> = {};
  for (const [key, behaviour] of Object.entries(form.overLimit)) {
    if (behaviour === 'charge') overLimit[key] = 'charge';
  }
  if (Object.keys(overLimit).length > 0) pricing.overLimit = overLimit;

  if (form.blockedAreas.length > 0) {
    pricing.blocking = {
      mode: form.blockingMode,
      blockedAreas: form.blockedAreas,
    };
  }

  const body: Record<string, unknown> = { pricing, interval };
  if (intervalDays !== undefined) body.intervalDays = intervalDays;
  return { body };
}

export function PricingFields({
  form,
  onChange,
  currency,
}: {
  form: PricingForm;
  onChange: (next: PricingForm) => void;
  currency: string;
}) {
  const set = (patch: Partial<PricingForm>) => onChange({ ...form, ...patch });
  const setFee = (index: number, patch: Partial<OneTimeFeeForm>) =>
    set({
      oneTimeFees: form.oneTimeFees.map((fee, i) =>
        i === index ? { ...fee, ...patch } : fee,
      ),
    });
  const rate = Number(form.meteringRate);
  const minimum =
    form.meteringMinimum.trim() === '' ? null : Number(form.meteringMinimum);
  const included = Number(form.meteringIncluded);

  return (
    <>
      <h3 className="subhead">Billing cycle</h3>
      <div className="inline-form">
        <label>
          Billing cycle
          <select
            value={form.cycle}
            onChange={(event) =>
              set({ cycle: event.target.value as PricingCycle })
            }
          >
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
            <option value="WEEKLY_7D">Every 7 days</option>
            <option value="CUSTOM">Custom (days)</option>
          </select>
        </label>
        {form.cycle === 'CUSTOM' ? (
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
          Free months (0 = none)
          <input
            type="number"
            min={0}
            max={120}
            step={1}
            value={form.freeMonths}
            onChange={(event) => set({ freeMonths: event.target.value })}
            placeholder="0"
          />
        </label>
      </div>
      <p className="muted-note">
        Free months are billed at ৳0 after the trial — the first
        {form.freeMonths.trim() !== '' && Number(form.freeMonths) > 0
          ? ` ${form.freeMonths}`
          : ''}{' '}
        billing period{Number(form.freeMonths) === 1 ? '' : 's'} generate no
        invoice.
      </p>

      <h3 className="subhead">Metering (per-order billing)</h3>
      <div className="domain-flags">
        <label>
          <input
            type="checkbox"
            checked={form.meteringEnabled}
            onChange={(event) =>
              set({ meteringEnabled: event.target.checked })
            }
          />
          Bill per order on top of the base fee
        </label>
      </div>
      {form.meteringEnabled ? (
        <>
          <div className="inline-form">
            <label>
              Metric
              <select value="orders_per_month" disabled>
                <option value="orders_per_month">Orders per month</option>
              </select>
            </label>
            <label>
              Included orders per period
              <input
                type="number"
                min={0}
                step={1}
                value={form.meteringIncluded}
                onChange={(event) =>
                  set({ meteringIncluded: event.target.value })
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
                onChange={(event) => set({ meteringRate: event.target.value })}
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
                  set({ meteringMinimum: event.target.value })
                }
                placeholder="500"
              />
            </label>
          </div>
          {Number.isFinite(rate) && rate >= 0 ? (
            <p className="muted-note">
              Example:{' '}
              {meteringExampleLine(
                rate,
                minimum !== null && Number.isFinite(minimum) ? minimum : null,
                Number.isInteger(included) && included >= 0 ? included : 0,
                currency,
              )}
            </p>
          ) : null}
        </>
      ) : null}

      <h3 className="subhead">One-time fees</h3>
      {form.oneTimeFees.length === 0 ? (
        <p className="muted-note">
          No one-time fees. Add setup fees, limit-increase packs, rate tiers
          or feature unlocks — operators sell them from the tenant page.
        </p>
      ) : null}
      {form.oneTimeFees.map((fee, index) => (
        <div className="inline-form" key={index}>
          <label>
            Label
            <input
              value={fee.label}
              onChange={(event) =>
                setFee(index, { label: event.target.value })
              }
              placeholder="Extra products pack"
              required
            />
          </label>
          <label>
            Key (optional — derived from the label)
            <input
              value={fee.key}
              onChange={(event) => setFee(index, { key: event.target.value })}
              placeholder="extra-products"
            />
          </label>
          <label>
            Amount (BDT)
            <input
              type="number"
              min={0}
              step="0.01"
              value={fee.amount}
              onChange={(event) =>
                setFee(index, { amount: event.target.value })
              }
              required
            />
          </label>
          <label>
            Effect
            <select
              value={fee.effectType}
              onChange={(event) =>
                setFee(index, {
                  effectType: event.target.value as OneTimeFeeForm['effectType'],
                })
              }
            >
              <option value="setup">Setup fee (no effect)</option>
              <option value="limit_increase">Limit increase</option>
              <option value="rate_tier">Per-order rate tier</option>
              <option value="feature_unlock">Feature unlock</option>
            </select>
          </label>
          {fee.effectType === 'limit_increase' ? (
            <>
              <label>
                Limit
                <select
                  value={fee.limitKey}
                  onChange={(event) =>
                    setFee(index, { limitKey: event.target.value })
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
                  value={fee.limitDelta}
                  onChange={(event) =>
                    setFee(index, { limitDelta: event.target.value })
                  }
                  placeholder="200"
                  required
                />
              </label>
            </>
          ) : null}
          {fee.effectType === 'rate_tier' ? (
            <label>
              New per-order rate (BDT)
              <input
                type="number"
                min={0}
                step="0.01"
                value={fee.perOrderRate}
                onChange={(event) =>
                  setFee(index, { perOrderRate: event.target.value })
                }
                placeholder="1.50"
                required
              />
            </label>
          ) : null}
          {fee.effectType === 'feature_unlock' ? (
            <label>
              Features to unlock (comma-separated keys)
              <input
                value={fee.features}
                onChange={(event) =>
                  setFee(index, { features: event.target.value })
                }
                placeholder="admin_reports"
                required
              />
            </label>
          ) : null}
          <div className="button-row">
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() =>
                set({
                  oneTimeFees: form.oneTimeFees.filter((_, i) => i !== index),
                })
              }
            >
              Remove fee
            </button>
          </div>
        </div>
      ))}
      <div className="button-row">
        <button
          type="button"
          className="button"
          onClick={() =>
            set({
              oneTimeFees: [...form.oneTimeFees, { ...EMPTY_ONE_TIME_FEE }],
            })
          }
        >
          Add one-time fee
        </button>
      </div>

      <h3 className="subhead">Over-limit behaviour</h3>
      <p className="muted-note">
        What happens when a tenant passes a plan limit. Block is the default;
        Charge bills the overage instead (only meaningful for metered
        metrics).
      </p>
      <div className="inline-form">
        {LIMIT_KEYS.map((key) => (
          <label key={key}>
            {LIMIT_LABELS[key]}
            <select
              value={form.overLimit[key] ?? 'block'}
              onChange={(event) =>
                set({
                  overLimit: {
                    ...form.overLimit,
                    [key]: event.target.value as 'block' | 'charge',
                  },
                })
              }
            >
              <option value="block">Block</option>
              <option value="charge">Charge</option>
            </select>
          </label>
        ))}
      </div>

      <h3 className="subhead">Strict blocking</h3>
      <p className="muted-note">
        When a subscription is past due, these areas stop working for the
        tenant until payment lands. Reads are never blocked. Leave all areas
        unchecked for the default (grace, then nothing blocked).
      </p>
      <div className="inline-form">
        <label>
          Blocking mode
          <select
            value={form.blockingMode}
            onChange={(event) =>
              set({ blockingMode: event.target.value as BlockingMode })
            }
          >
            <option value="grace_then_block">
              Block after the grace period
            </option>
            <option value="block_immediately">
              Block immediately when past due
            </option>
          </select>
        </label>
      </div>
      <div className="domain-flags">
        {BLOCKING_AREAS.map((area) => (
          <label key={area}>
            <input
              type="checkbox"
              checked={form.blockedAreas.includes(area)}
              onChange={(event) =>
                set({
                  blockedAreas: event.target.checked
                    ? [...form.blockedAreas, area]
                    : form.blockedAreas.filter((a) => a !== area),
                })
              }
            />
            {BLOCKING_AREA_LABELS[area]}
          </label>
        ))}
      </div>
    </>
  );
}
