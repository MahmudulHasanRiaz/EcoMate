import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import {
  ORGANIZATION_LIMIT_DEFAULT,
  ORGANIZATION_LIMIT_MAX,
  ORGANIZATION_LIMIT_MIN,
  parseOrganizationLimitInput,
} from '../../lib/organization-limit';
import type { SettingsSectionProps } from './sections';

/**
 * Organization limit (D12, Phase 4): how many organizations (stores)
 * one user may own. The cap is enforced by the central auth service;
 * this section edits the stored `organization_limit` platform setting
 * the service reads (60 s cache, no restart needed).
 *
 * Until the platform-api half lands, `GET /settings` carries no
 * `organizationLimit` field and the save 404s — the section still
 * renders with the platform default (5) and surfaces the API error.
 */
export function OrganizationLimitSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const [limit, setLimit] = useState(String(ORGANIZATION_LIMIT_DEFAULT));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setLimit(String(settings.organizationLimit?.limit ?? ORGANIZATION_LIMIT_DEFAULT));
  }, [settings]);

  if (!settings) return null;

  const source = settings.organizationLimit?.source ?? 'default';

  async function save() {
    const parsed = parseOrganizationLimitInput(limit);
    if (!parsed.ok) {
      onError(parsed.error);
      return;
    }
    setBusy(true);
    onError('');
    try {
      await api('/settings/organization-limit', {
        method: 'PATCH',
        body: JSON.stringify({ limit: parsed.limit }),
      }).then((r) => readJson(r));
      onSaved('Organization limit saved.');
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
          <h2>Organization limit</h2>
          <p>
            The maximum number of stores one user may own. The central auth
            service enforces this at organization creation; raising it
            lets one email run more stores, lowering it only affects new
            stores — existing ones keep working.
          </p>
        </div>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>Organizations per user</span>
          <input
            type="number"
            min={ORGANIZATION_LIMIT_MIN}
            max={ORGANIZATION_LIMIT_MAX}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            aria-label="Organizations per user"
          />
        </label>
      </div>
      <p className="muted-note">
        {source === 'setting'
          ? 'A stored value is in effect. Changes apply within about a minute (the auth service caches the setting).'
          : `No stored value yet — the platform default of ${ORGANIZATION_LIMIT_DEFAULT} applies.`}
      </p>
      <div className="progress-actions">
        <button
          type="button"
          className="button button--accent"
          onClick={() => void save()}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Save organization limit'}
        </button>
      </div>
    </section>
  );
}
