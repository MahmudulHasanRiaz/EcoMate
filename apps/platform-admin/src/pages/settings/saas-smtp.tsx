import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import type { SettingsSectionProps } from './sections';

type ExpiryMode = 'NONE' | 'FIXED_DAYS' | 'END_OF_PERIOD';

/** Emails a BDT amount buys at the current rate (floor, micro-units). */
function emailsForAmount(
  amountBDT: number,
  unit: 'PER_EMAIL' | 'PER_1000',
  pricePerUnit: number | null,
): number {
  if (
    typeof pricePerUnit !== 'number' ||
    !Number.isFinite(pricePerUnit) ||
    pricePerUnit <= 0
  ) {
    return 0;
  }
  const amountMicro = Math.round(amountBDT * 1_000_000);
  const priceMicro = Math.round(pricePerUnit * 1_000_000);
  if (amountMicro <= 0 || priceMicro <= 0) return 0;
  return Math.floor((amountMicro * (unit === 'PER_1000' ? 1000 : 1)) / priceMicro);
}

export function SaasSmtpSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api, session } = useAuth();
  const isSuperadmin = session?.user.role === 'SUPERADMIN';
  const [unit, setUnit] = useState<'PER_EMAIL' | 'PER_1000'>('PER_EMAIL');
  const [price, setPrice] = useState('');
  const [freeAllowance, setFreeAllowance] = useState('10');
  const [threshold, setThreshold] = useState('10');
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>('NONE');
  const [expiryDays, setExpiryDays] = useState('90');
  const [warnDays, setWarnDays] = useState('7');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings?.saasSmtp) return;
    const s = settings.saasSmtp;
    setUnit(s.unit);
    setPrice(s.pricePerUnit === null ? '' : String(s.pricePerUnit));
    setFreeAllowance(String(s.freeAllowance));
    setThreshold(String(s.lowBalanceThreshold));
    setExpiryMode(s.expiry.mode);
    setExpiryDays(String(s.expiry.days));
    setWarnDays(String(s.expiry.warnDays));
  }, [settings]);

  if (!settings?.saasSmtp) return null;
  const saasSmtp = settings.saasSmtp;

  const priceNumber = price.trim() === '' ? null : Number(price);
  const previewEmails =
    priceNumber !== null && Number.isFinite(priceNumber)
      ? emailsForAmount(500, unit, priceNumber)
      : 0;
  const minimumTopUp =
    priceNumber !== null && priceNumber > 0
      ? priceNumber / (unit === 'PER_1000' ? 1000 : 1)
      : null;

  async function save() {
    if (!isSuperadmin) return;
    const allowance = Number(freeAllowance);
    if (!Number.isInteger(allowance) || allowance < 0 || allowance > 20) {
      onError('Free allowance must be a whole number between 0 and 20.');
      return;
    }
    const thresholdNumber = Number(threshold);
    if (!Number.isInteger(thresholdNumber) || thresholdNumber < 0) {
      onError('Low-balance threshold must be a whole number of 0 or more.');
      return;
    }
    if (priceNumber !== null && (!Number.isFinite(priceNumber) || priceNumber < 0)) {
      onError('Price must be empty (unpriced) or a number of 0 or more.');
      return;
    }
    const days = Number(expiryDays);
    if (!Number.isInteger(days) || days < 1) {
      onError('Expiry days must be a whole number of 1 or more.');
      return;
    }
    const warn = Number(warnDays);
    if (!Number.isInteger(warn) || warn < 0) {
      onError('Warning days must be a whole number of 0 or more.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      await api('/settings/saas-smtp', {
        method: 'PATCH',
        body: JSON.stringify({
          unit,
          pricePerUnit: priceNumber,
          freeAllowance: allowance,
          lowBalanceThreshold: thresholdNumber,
          expiry: { mode: expiryMode, days, warnDays: warn },
        }),
      }).then((r) => readJson(r));
      onSaved('SaaS SMTP settings saved.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>SaaS SMTP</h2>
          <p>
            The shared email service tenants use when they have no SMTP of
            their own: the rate, the free starter emails, and when topped-up
            emails expire. Tenants pay per this rate and receive an email
            balance — a count of sendable emails, never a money balance.
          </p>
        </div>
        <span
          className={`badge badge--${saasSmtp.pricePerUnit !== null && saasSmtp.pricePerUnit > 0 ? 'accent' : 'neutral'}`}
        >
          {saasSmtp.pricePerUnit !== null && saasSmtp.pricePerUnit > 0
            ? 'Priced'
            : 'Not priced'}
        </span>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>Rate unit</span>
          <select
            value={unit}
            onChange={(event) =>
              setUnit(event.target.value as 'PER_EMAIL' | 'PER_1000')
            }
            aria-label="Rate unit"
            disabled={!isSuperadmin}
          >
            <option value="PER_EMAIL">Per email</option>
            <option value="PER_1000">Per 1,000 emails</option>
          </select>
        </label>
        <label className="inline-field">
          <span>
            Price per {unit === 'PER_1000' ? '1,000 emails' : 'email'} (৳)
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="Empty = not priced (top-ups disabled)"
            aria-label="Price per unit"
            disabled={!isSuperadmin}
          />
        </label>
        <label className="inline-field">
          <span>Free starter emails (0–20)</span>
          <input
            type="number"
            min="0"
            max="20"
            step="1"
            value={freeAllowance}
            onChange={(event) => setFreeAllowance(event.target.value)}
            aria-label="Free starter emails"
            disabled={!isSuperadmin}
          />
        </label>
        <label className="inline-field">
          <span>Low-balance threshold (emails)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            aria-label="Low-balance threshold"
            disabled={!isSuperadmin}
          />
        </label>
        <label className="inline-field">
          <span>Email expiry</span>
          <select
            value={expiryMode}
            onChange={(event) =>
              setExpiryMode(event.target.value as ExpiryMode)
            }
            aria-label="Email expiry mode"
            disabled={!isSuperadmin}
          >
            <option value="NONE">Never expires</option>
            <option value="FIXED_DAYS">Fixed days after grant</option>
            <option value="END_OF_PERIOD">End of billing period</option>
          </select>
        </label>
        {expiryMode === 'FIXED_DAYS' ? (
          <label className="inline-field">
            <span>Expiry days</span>
            <input
              type="number"
              min="1"
              step="1"
              value={expiryDays}
              onChange={(event) => setExpiryDays(event.target.value)}
              aria-label="Expiry days"
              disabled={!isSuperadmin}
            />
          </label>
        ) : null}
        <label className="inline-field">
          <span>Warn before expiry (days)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={warnDays}
            onChange={(event) => setWarnDays(event.target.value)}
            aria-label="Warning days before expiry"
            disabled={!isSuperadmin}
          />
        </label>
      </div>
      {priceNumber !== null && priceNumber > 0 ? (
        <p className="muted-note">
          At this rate, ৳500 buys {previewEmails.toLocaleString('en-US')}{' '}
          emails
          {minimumTopUp !== null
            ? ` — the smallest top-up is ৳${minimumTopUp.toFixed(2)} (the price of 1 email)`
            : ''}
          .
        </p>
      ) : (
        <p className="muted-note">
          No rate is set: tenants cannot buy top-ups yet (their free starter
          emails still work).
        </p>
      )}
      <p className="muted-note">
        Changing the expiry never rewrites emails already granted — only
        lots granted after the change use the new rule.
      </p>
      {!isSuperadmin ? (
        <p className="muted-note">
          Only a superadmin can change SaaS SMTP settings.
        </p>
      ) : null}
      <div className="progress-actions">
        <button
          type="button"
          className="button button--accent"
          onClick={() => void save()}
          disabled={busy || !isSuperadmin}
        >
          {busy ? 'Saving…' : 'Save SaaS SMTP settings'}
        </button>
      </div>
    </section>
  );
}
