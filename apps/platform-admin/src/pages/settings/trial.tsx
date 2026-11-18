import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import type { SettingsSectionProps } from './sections';

export function TrialSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const [trialDays, setTrialDays] = useState('14');
  const [graceDays, setGraceDays] = useState('7');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTrialDays(String(settings.trial.trialDays));
    setGraceDays(String(settings.trial.graceDays));
  }, [settings]);

  if (!settings) return null;

  async function saveTrial() {
    setBusy(true);
    onError('');
    try {
      await api('/settings/trial', {
        method: 'PATCH',
        body: JSON.stringify({
          trialDays: Number(trialDays),
          graceDays: Number(graceDays),
        }),
      }).then((r) => readJson(r));
      onSaved('Trial and grace defaults saved.');
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
          <h2>Trial and grace defaults</h2>
          <p>
            Applied to new plans and tenants that do not set their own
            values. A plan version&apos;s own values always win.
          </p>
        </div>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>Default trial days</span>
          <input
            type="number"
            min="0"
            max="365"
            value={trialDays}
            onChange={(event) => setTrialDays(event.target.value)}
            aria-label="Default trial days"
          />
        </label>
        <label className="inline-field">
          <span>Default grace days</span>
          <input
            type="number"
            min="0"
            max="90"
            value={graceDays}
            onChange={(event) => setGraceDays(event.target.value)}
            aria-label="Default grace days"
          />
        </label>
      </div>
      <div className="progress-actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void saveTrial()}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save trial defaults'}
        </button>
      </div>
    </section>
  );
}
