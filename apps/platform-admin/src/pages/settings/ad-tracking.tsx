import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import {
  AD_TRACKING_PLATFORMS,
  type AdTrackingPlatformDef,
} from '../../lib/ad-dispatch';
import { LEAD_TRIAGE_STATUSES, leadStatusLabel } from '../../lib/leads';
import type {
  AdTrackingMode,
  AdTrackingPlatformSettings,
  LeadStatus,
} from '../../types';
import type { SettingsSectionProps } from './sections';

/**
 * Ad tracking settings (CMS batch 2, item 21): per-platform
 * server-side lead attribution (Meta Conversions API, TikTok Events
 * API). No ad-account credentials exist yet — every platform starts
 * unconfigured and dispatch stays a no-op until an operator enters a
 * pixel id + access token here. The token is stored encrypted and is
 * never returned by the API (same pattern as the SMTP password):
 * the field is blank on load, blank means "keep the stored token",
 * and the explicit clear checkbox removes it.
 */
export function AdTrackingSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const adTracking = settings?.adTracking;
  if (!adTracking) return null;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Ad tracking</h2>
          <p>
            Server-side lead events for the ad platforms EcoMate runs
            ads on: when a visitor submits the lead form (instant mode)
            or a lead reaches a trigger status (validated mode), the
            platform sends the event to the platform&apos;s API with
            the attribution the form captured. An unconfigured platform
            simply never dispatches — nothing errors.
          </p>
        </div>
      </div>
      {AD_TRACKING_PLATFORMS.map((platform, index) => (
        <AdPlatformCard
          key={platform.id}
          platform={platform}
          config={adTracking[platform.id]}
          first={index === 0}
          onSaved={onSaved}
          onError={onError}
        />
      ))}
    </section>
  );
}

function AdPlatformCard({
  platform,
  config,
  first,
  onSaved,
  onError,
}: {
  platform: AdTrackingPlatformDef;
  config: AdTrackingPlatformSettings | undefined;
  first: boolean;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { api, session } = useAuth();
  const isSuperadmin = session?.user.role === 'SUPERADMIN';
  const [pixelId, setPixelId] = useState('');
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [mode, setMode] = useState<AdTrackingMode>('instant');
  const [triggerStatus, setTriggerStatus] =
    useState<LeadStatus>('QUALIFIED');
  const [eventName, setEventName] = useState(platform.defaultEventName);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config) return;
    setPixelId(config.pixelId);
    setToken('');
    setClearToken(false);
    setMode(config.mode);
    setTriggerStatus(config.triggerStatus);
    setEventName(config.eventName);
    setEnabled(config.enabled);
  }, [config]);

  if (!config) return null;

  async function save() {
    if (!isSuperadmin) return;
    setBusy(true);
    onError('');
    try {
      const body: Record<string, unknown> = {
        pixelId: pixelId.trim(),
        mode,
        triggerStatus,
        eventName: eventName.trim() || platform.defaultEventName,
        enabled,
      };
      // Blank token input = keep the stored token (omit it); the
      // clear checkbox sends an explicit empty string (clears it).
      if (clearToken) body.accessToken = '';
      else if (token) body.accessToken = token;
      await api(`/settings/ad-tracking/${platform.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }).then((r) => readJson(r));
      onSaved(`${platform.label} ad tracking saved.`);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!first ? <div className="section-divider" aria-hidden="true" /> : null}
      <div className="card-head">
        <div>
          <h3 className="subsection-title">{platform.label}</h3>
          <p className="muted-note">{platform.blurb}</p>
        </div>
        <span
          className={`badge badge--${config.configured ? 'accent' : 'neutral'}`}
        >
          {config.configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>{platform.idLabel}</span>
          <input
            value={pixelId}
            onChange={(event) => setPixelId(event.target.value)}
            placeholder={platform.idPlaceholder}
            aria-label={`${platform.label} ${platform.idLabel}`}
            disabled={!isSuperadmin}
          />
        </label>
        <label className="inline-field">
          <span>Access token</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={
              config.hasToken
                ? 'Token saved — leave blank to keep it'
                : 'No token saved'
            }
            aria-label={`${platform.label} access token`}
            name={`ad-token-${platform.id}`}
            autoComplete="new-password"
            disabled={!isSuperadmin || clearToken}
          />
        </label>
        <label className="inline-field">
          <span>Dispatch mode</span>
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as AdTrackingMode)
            }
            aria-label={`${platform.label} dispatch mode`}
            disabled={!isSuperadmin}
          >
            <option value="instant">Instant — on lead creation</option>
            <option value="validated">
              Validated — on trigger status
            </option>
          </select>
        </label>
        {mode === 'validated' ? (
          <label className="inline-field">
            <span>Trigger status</span>
            <select
              value={triggerStatus}
              onChange={(event) =>
                setTriggerStatus(event.target.value as LeadStatus)
              }
              aria-label={`${platform.label} trigger status`}
              disabled={!isSuperadmin}
            >
              {LEAD_TRIAGE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {leadStatusLabel(value)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="inline-field">
          <span>Event name</span>
          <input
            value={eventName}
            onChange={(event) => setEventName(event.target.value)}
            placeholder={platform.defaultEventName}
            aria-label={`${platform.label} event name`}
            disabled={!isSuperadmin}
          />
        </label>
      </div>
      <div className="domain-flags">
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={!isSuperadmin}
          />
          Enabled
        </label>
        {config.hasToken ? (
          <label>
            <input
              type="checkbox"
              checked={clearToken}
              onChange={(event) => setClearToken(event.target.checked)}
              disabled={!isSuperadmin}
            />
            Clear the saved token
          </label>
        ) : null}
      </div>
      {!config.configured ? (
        <p className="muted-note">
          {platform.label} is not configured yet — no events are sent
          until a {platform.idLabel.toLowerCase()} and an access token
          are saved.
        </p>
      ) : null}
      {!isSuperadmin ? (
        <p className="muted-note">
          Only a superadmin can change ad tracking settings.
        </p>
      ) : null}
      <div className="progress-actions">
        <button
          type="button"
          className="button button--accent"
          onClick={() => void save()}
          disabled={busy || !isSuperadmin}
        >
          {busy ? 'Saving…' : `Save ${platform.label} settings`}
        </button>
      </div>
    </>
  );
}
