import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import type { SettingsSectionProps } from './sections';

export function TaxSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const [taxRate, setTaxRate] = useState('0');
  const [taxLabel, setTaxLabel] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTaxRate(String(settings.tax.ratePercent));
    setTaxLabel(settings.tax.label);
    setTaxInclusive(settings.tax.inclusive);
  }, [settings]);

  if (!settings) return null;

  async function saveTax() {
    setBusy(true);
    onError('');
    try {
      await api('/settings/tax', {
        method: 'PATCH',
        body: JSON.stringify({
          ratePercent: Number(taxRate),
          label: taxLabel.trim(),
          inclusive: taxInclusive,
        }),
      }).then((r) => readJson(r));
      onSaved('Tax settings saved.');
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
          <h2>Tax</h2>
          <p>
            Default tax for invoices. It applies to new invoices; the
            label shows on the invoice itself.
          </p>
        </div>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>Tax rate (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
            aria-label="Tax rate percent"
          />
        </label>
        <label className="inline-field">
          <span>Tax label</span>
          <input
            value={taxLabel}
            onChange={(event) => setTaxLabel(event.target.value)}
            placeholder="VAT"
            aria-label="Tax label"
          />
        </label>
        <div className="domain-flags">
          <label>
            <input
              type="checkbox"
              checked={taxInclusive}
              onChange={(event) => setTaxInclusive(event.target.checked)}
            />
            Prices include tax
          </label>
        </div>
      </div>
      <div className="progress-actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void saveTax()}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save tax settings'}
        </button>
      </div>
    </section>
  );
}
