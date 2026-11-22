import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth';
import { errorMessage, readJson } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import type { AddOn, TrialEndPolicy } from '../../types';
import type { SettingsSectionProps } from './sections';

/** Custom Domain is never part of a trial (Boss 2026-11-19) — it is not
 * offered in the picker at all. */
const CUSTOM_DOMAIN_SLUG = 'custom-domain';

export function TrialSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const [trialDays, setTrialDays] = useState('14');
  const [graceDays, setGraceDays] = useState('7');
  const [busy, setBusy] = useState(false);

  // Trial add-ons (trial-end design 2026-11-22).
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [addOnsLoading, setAddOnsLoading] = useState(true);
  const [addOnMode, setAddOnMode] = useState<'default' | 'custom'>('default');
  const [checkedSlugs, setCheckedSlugs] = useState<Set<string>>(new Set());
  const [addOnsBusy, setAddOnsBusy] = useState(false);

  // Trial-end policy.
  const [trialEndPolicy, setTrialEndPolicy] =
    useState<TrialEndPolicy>('grace_then_suspend');
  const [policyBusy, setPolicyBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setTrialDays(String(settings.trial.trialDays));
    setGraceDays(String(settings.trial.graceDays));
    setTrialEndPolicy(settings.trial.trialEndPolicy ?? 'grace_then_suspend');
    if (settings.trial.trialAddOnSlugs === null) {
      setAddOnMode('default');
    } else {
      setAddOnMode('custom');
      setCheckedSlugs(new Set(settings.trial.trialAddOnSlugs));
    }
  }, [settings]);

  useEffect(() => {
    setAddOnsLoading(true);
    api('/add-ons')
      .then((response) => readJson<AddOn[]>(response))
      .then((result) => setAddOns(result))
      .catch((err) => onError(errorMessage(err)))
      .finally(() => setAddOnsLoading(false));
    // The add-on list loads once; the settings prop drives the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trialEligible = useMemo(
    () => addOns.filter((a) => a.isActive && a.slug !== CUSTOM_DOMAIN_SLUG),
    [addOns],
  );

  const selectedTotal = useMemo(
    () =>
      trialEligible
        .filter((a) => checkedSlugs.has(a.slug))
        .reduce((sum, a) => sum + Number(a.price ?? 0), 0),
    [trialEligible, checkedSlugs],
  );

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

  function switchToCustom() {
    // Start from today's behaviour (everything checked) so the operator
    // removes what they do not want instead of rebuilding the list.
    if (addOnMode === 'default') {
      setCheckedSlugs(new Set(trialEligible.map((a) => a.slug)));
    }
    setAddOnMode('custom');
  }

  function toggleSlug(slug: string) {
    setCheckedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function saveTrialAddOns() {
    setAddOnsBusy(true);
    onError('');
    try {
      await api('/settings/trial', {
        method: 'PATCH',
        body: JSON.stringify({
          trialAddOnSlugs:
            addOnMode === 'default' ? null : [...checkedSlugs],
        }),
      }).then((r) => readJson(r));
      onSaved(
        addOnMode === 'default'
          ? 'Trial add-ons reset to the default (all active add-ons).'
          : 'Trial add-ons saved.',
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setAddOnsBusy(false);
    }
  }

  async function saveTrialEndPolicy() {
    setPolicyBusy(true);
    onError('');
    try {
      await api('/settings/trial', {
        method: 'PATCH',
        body: JSON.stringify({ trialEndPolicy }),
      }).then((r) => readJson(r));
      onSaved('Trial-end policy saved.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setPolicyBusy(false);
    }
  }

  return (
    <>
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
            className="button button--accent"
            onClick={() => void saveTrial()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save trial defaults'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Trial add-ons</h2>
            <p>
              Which add-ons a new trial includes, free for the trial period.
              Changes affect new signups only — existing trials keep what
              they started with. Custom Domain is never part of a trial.
            </p>
          </div>
        </div>
        <div className="domain-config-grid">
          <label className="inline-field">
            <span>Trial add-on list</span>
            <select
              value={addOnMode}
              onChange={(event) =>
                event.target.value === 'custom'
                  ? switchToCustom()
                  : setAddOnMode('default')
              }
              aria-label="Trial add-on list"
            >
              <option value="default">
                Default — every active add-on (except Custom Domain)
              </option>
              <option value="custom">Custom list</option>
            </select>
          </label>
        </div>
        {addOnMode === 'custom' && (
          <>
            {addOnsLoading ? (
              <p className="muted-note">Loading add-ons…</p>
            ) : trialEligible.length === 0 ? (
              <p className="muted-note">
                No active add-ons to choose from.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th aria-label="Include">
                        <input
                          type="checkbox"
                          checked={
                            trialEligible.length > 0 &&
                            trialEligible.every((a) =>
                              checkedSlugs.has(a.slug),
                            )
                          }
                          onChange={() =>
                            setCheckedSlugs(
                              trialEligible.every((a) =>
                                checkedSlugs.has(a.slug),
                              )
                                ? new Set()
                                : new Set(trialEligible.map((a) => a.slug)),
                            )
                          }
                          aria-label="Include all add-ons in the trial"
                        />
                      </th>
                      <th>Add-on</th>
                      <th>Monthly price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialEligible.map((addOn) => (
                      <tr key={addOn.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={checkedSlugs.has(addOn.slug)}
                            onChange={() => toggleSlug(addOn.slug)}
                            aria-label={`Include ${addOn.name} in the trial`}
                          />
                        </td>
                        <td>
                          {addOn.name}
                          <span className="mono sub">{addOn.slug}</span>
                        </td>
                        <td>{formatMoney(addOn.price, addOn.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted-note">
              {checkedSlugs.size} add-on
              {checkedSlugs.size === 1 ? '' : 's'} selected
              {checkedSlugs.size > 0 && (
                <>
                  {' '}
                  — {formatMoney(selectedTotal)} a month if the tenant kept
                  them all after the trial.
                </>
              )}{' '}
              Trial add-ons are never billed until the tenant confirms them
              at conversion.
            </p>
          </>
        )}
        <div className="progress-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={() => void saveTrialAddOns()}
            disabled={addOnsBusy || (addOnMode === 'custom' && addOnsLoading)}
          >
            {addOnsBusy ? 'Saving…' : 'Save trial add-ons'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>When a trial ends</h2>
            <p>
              Trial-plan tenants are never invoiced at trial end — they
              choose a plan and confirm their add-ons first. This setting
              decides what happens to their workspace while they choose.
            </p>
          </div>
        </div>
        <div className="domain-config-grid">
          <label className="inline-field">
            <span>Trial-end policy</span>
            <select
              value={trialEndPolicy}
              onChange={(event) =>
                setTrialEndPolicy(event.target.value as TrialEndPolicy)
              }
              aria-label="Trial-end policy"
            >
              <option value="grace_then_suspend">
                Grace period, then suspend
              </option>
              <option value="suspend_immediately">
                Suspend immediately
              </option>
            </select>
          </label>
        </div>
        <p className="muted-note">
          {trialEndPolicy === 'grace_then_suspend'
            ? 'The tenant keeps full access for the grace period (the plan version\u2019s grace days, or the default above), then the workspace is suspended until they choose a plan. Their shop stays up during grace.'
            : 'The workspace is suspended at trial end, with no grace period. The tenant can still open the subscription page and choose a plan to restore it.'}
        </p>
        <div className="progress-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={() => void saveTrialEndPolicy()}
            disabled={policyBusy}
          >
            {policyBusy ? 'Saving…' : 'Save trial-end policy'}
          </button>
        </div>
      </section>
    </>
  );
}
