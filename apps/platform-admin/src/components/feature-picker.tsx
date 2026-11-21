import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { errorMessage } from '../lib/api';
import {
  fetchFeatures,
  filterFeatures,
  groupFeaturesByCategory,
  kindBadgeTone,
  kindLabel,
  unknownFeatureKeys,
} from '../lib/features';
import type { FeatureSummary } from '../types';
import { ErrorNote } from './ui';

/**
 * Validated catalogue picker — replaces the free-text comma-separated
 * feature-key inputs in the plan + add-on editors (gap 11: arbitrary
 * strings are now rejected server-side too).
 *
 * - Lists the whole catalogue grouped by A–O category, with search.
 * - Per-category All/None + global Select all / Clear (a plan with 87
 *   features must not need 87 clicks).
 * - Saved keys that are NOT in the catalogue (the '*' wildcard, legacy
 *   keys) show as removable chips. Only '*' survives a save — a legacy
 *   key makes the server reject the whole save (400), so the chips warn
 *   the operator to remove them first.
 * - The emitted value is catalogue-ordered (stable diffs), unknown keys
 *   appended in their original order.
 */
export function FeaturePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}) {
  const { api } = useAuth();
  const [catalogue, setCatalogue] = useState<FeatureSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchFeatures(api)
      .then((features) => {
        if (!cancelled) setCatalogue(features);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const selected = useMemo(() => new Set(value), [value]);
  const unknown = useMemo(
    () => (catalogue ? unknownFeatureKeys(value, catalogue) : []),
    [value, catalogue],
  );
  const groups = useMemo(
    () =>
      catalogue
        ? groupFeaturesByCategory(filterFeatures(catalogue, { search }))
        : [],
    [catalogue, search],
  );

  const emit = (next: Set<string>) => {
    const ordered = (catalogue ?? [])
      .filter((feature) => next.has(feature.key))
      .map((feature) => feature.key);
    const keptUnknown = value.filter(
      (key) => next.has(key) && !ordered.includes(key),
    );
    onChange([...ordered, ...keptUnknown]);
  };

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    emit(next);
  };

  const setGroup = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    emit(next);
  };

  if (error) {
    return (
      <div>
        <ErrorNote message={`Could not load the feature catalogue: ${error}`} />
        <p className="muted-note">
          The saved features ({value.length}) are kept as-is until the
          catalogue loads.
        </p>
      </div>
    );
  }
  if (!catalogue) {
    return <p className="muted-note">Loading features…</p>;
  }

  return (
    <div className="feature-picker">
      <div className="feature-picker-tools">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search features"
          aria-label="Search features"
          disabled={disabled}
        />
        <button
          type="button"
          className="button button--sm"
          disabled={disabled}
          onClick={() =>
            emit(new Set(catalogue.map((feature) => feature.key)))
          }
        >
          Select all
        </button>
        <button
          type="button"
          className="button button--sm"
          disabled={disabled}
          onClick={() => emit(new Set())}
        >
          Clear
        </button>
        <span className="muted-note">
          {selected.size} of {catalogue.length} selected
        </span>
      </div>

      {unknown.length > 0 ? (
        <p className="muted-note">
          Not in the catalogue — remove before saving (only &apos;*&apos;
          is kept; any other key makes the save fail):{' '}
          {unknown.map((key) => (
            <span key={key} className="filter-chip">
              <span className="mono">{key}</span>
              <button
                type="button"
                aria-label={`Remove ${key}`}
                disabled={disabled}
                onClick={() => {
                  const next = new Set(selected);
                  next.delete(key);
                  emit(next);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </p>
      ) : null}

      <div className="feature-picker-list">
        {groups.length === 0 ? (
          <p className="muted-note">No features match this search.</p>
        ) : (
          groups.map((group) => {
            const keys = group.features.map((feature) => feature.key);
            const allSelected = keys.every((key) => selected.has(key));
            return (
              <div key={group.category} className="feature-picker-group">
                <div className="feature-picker-group-head">
                  <span>{group.category}</span>
                  <span className="muted-note">
                    {keys.filter((key) => selected.has(key)).length}/
                    {keys.length}
                  </span>
                  <button
                    type="button"
                    className="link-button"
                    disabled={disabled}
                    onClick={() => setGroup(keys, !allSelected)}
                  >
                    {allSelected ? 'None' : 'All'}
                  </button>
                </div>
                {group.features.map((feature) => (
                  <label
                    key={feature.key}
                    className="feature-picker-row"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(feature.key)}
                      disabled={disabled}
                      onChange={() => toggle(feature.key)}
                    />
                    <span>{feature.name}</span>
                    <span className="mono sub">{feature.key}</span>
                    <span
                      className={`badge badge--${kindBadgeTone(feature.kind)}`}
                    >
                      {kindLabel(feature.kind)}
                    </span>
                  </label>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
