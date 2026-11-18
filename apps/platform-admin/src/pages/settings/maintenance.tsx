import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ui';
import { errorMessage, readJson } from '../../lib/api';
import type { SettingsSectionProps } from './sections';

export function MaintenanceSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setMaintenanceEnabled(settings.maintenance.enabled);
    setMaintenanceMessage(settings.maintenance.message);
  }, [settings]);

  if (!settings) return null;

  async function saveMaintenance() {
    setBusy(true);
    onError('');
    try {
      await api('/settings/maintenance', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: maintenanceEnabled,
          message: maintenanceMessage.trim(),
        }),
      }).then((r) => readJson(r));
      onSaved(
        maintenanceEnabled
          ? 'Maintenance mode enabled. Writes are blocked except settings and auth.'
          : 'Maintenance mode disabled.',
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Maintenance</h2>
            <p>
              While maintenance is on, the platform API refuses writes
              except sign-in, health, internal sync and these settings.
              Reads keep working.
            </p>
          </div>
        </div>
        <div className="domain-flags">
          <label>
            <input
              type="checkbox"
              checked={maintenanceEnabled}
              onChange={(event) =>
                setMaintenanceEnabled(event.target.checked)
              }
            />
            Maintenance mode is on
          </label>
        </div>
        <div className="domain-config-grid">
          <label className="inline-field">
            <span>Message shown to API clients</span>
            <input
              value={maintenanceMessage}
              onChange={(event) =>
                setMaintenanceMessage(event.target.value)
              }
              placeholder="We are upgrading the platform. Please try again soon."
              aria-label="Maintenance message"
            />
          </label>
        </div>
        <div className="progress-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={() => {
              if (maintenanceEnabled && !settings?.maintenance.enabled) {
                setConfirmEnable(true);
              } else {
                void saveMaintenance();
              }
            }}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save maintenance'}
          </button>
        </div>
      </section>

      {confirmEnable ? (
        <ConfirmDialog
          open
          title="Enable maintenance mode?"
          body="Writes are blocked platform-wide except sign-in, health, internal sync and these settings. Reads keep working."
          confirmLabel="Enable maintenance"
          danger
          busy={busy}
          onConfirm={async () => {
            setConfirmEnable(false);
            await saveMaintenance();
          }}
          onClose={() => setConfirmEnable(false)}
        />
      ) : null}
    </>
  );
}
