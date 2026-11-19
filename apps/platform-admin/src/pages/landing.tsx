import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { ApiError, errorMessage, readJson } from '../lib/api';
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  groupLandingRows,
  isValidLandingKey,
  landingContentQueryString,
  landingFieldDefs,
  landingFormToValue,
  landingScalarFieldLabel,
  landingScalarFieldNames,
  landingValueToForm,
  LANDING_LOCALES,
  LANDING_LOCALE_LABELS,
  LANDING_OBJECT_KEY,
  LANDING_OBJECT_SECTIONS,
  LANDING_SCALAR_SECTIONS,
  LANDING_SECTIONS,
  LANDING_SECTION_LABELS,
  SECTION_VISIBILITY_IDS,
  SECTION_VISIBILITY_LABELS,
  type LandingFieldDef,
  type LandingFormState,
  type LandingLocale,
  type LandingRowGroup,
  type LandingSection,
} from '../lib/landing-content';
import { resolveMediaUrl, type MediaAsset } from '../lib/media';
import type {
  LandingContentHealth,
  LandingContentRevision,
  LandingContentRow,
  Page,
} from '../types';
import {
  ConfirmDialog,
  ErrorNote,
  Modal,
  PageHeader,
  ScrollableTabs,
  Skeleton,
} from '../components/ui';
import { MediaPicker } from '../components/media-picker';

type ApiFn = (path: string, init?: RequestInit) => Promise<Response>;

/** One-line preview of a revision payload (strings as-is, objects as compact JSON). */
function previewRevisionValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/** One editable locale column inside a row card. */
function LocaleEditor({
  groupKey,
  locale,
  row,
  defs,
  scalar,
  busy,
  conflict,
  onSave,
  onDelete,
  onPublish,
  onHistory,
  onLoadTheirVersion,
  onKeepMine,
}: {
  groupKey: string;
  locale: LandingLocale;
  row?: LandingContentRow;
  defs: LandingFieldDef[];
  scalar: boolean;
  busy: boolean;
  /** Set when a save hit a 409 optimistic-locking conflict. */
  conflict?: { currentVersion: number; changedKeys: string[] } | null;
  onSave: (locale: LandingLocale, form: LandingFormState, isActive: boolean) => void;
  onDelete: (locale: LandingLocale) => void;
  onPublish: (locale: LandingLocale) => void;
  onHistory: (locale: LandingLocale) => void;
  onLoadTheirVersion: (locale: LandingLocale) => void;
  onKeepMine: (locale: LandingLocale) => void;
}) {
  const [form, setForm] = useState<LandingFormState>(() =>
    landingValueToForm(row?.value, defs, scalar),
  );
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [formError, setFormError] = useState<string | null>(null);
  // Media-picker state: which 'media' field the open picker fills.
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // Re-sync when the underlying row changes (after a save + reload).
  useEffect(() => {
    setForm(landingValueToForm(row?.value, defs, scalar));
    setIsActive(row?.isActive ?? true);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.updatedAt]);

  const setField = (name: string, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));

  /** A library pick stores the asset's ABSOLUTE content URL (the
      landing consumes it from another origin — same as branding). */
  function pickFromLibrary(asset: MediaAsset) {
    if (!pickerFor) return;
    setField(pickerFor, resolveMediaUrl(asset.contentUrl));
    setPickerFor(null);
  }

  const save = () => {
    const parsed = landingFormToValue(form, defs, scalar);
    if ('error' in parsed) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    onSave(locale, form, isActive);
  };

  // Scalar rows have a single field; unknown scalar keys still get a
  // plain text input so the row stays editable.
  const fields: LandingFieldDef[] =
    scalar && defs.length === 0
      ? [{ name: '__value', label: groupKey, kind: 'text' }]
      : defs;

  return (
    <div className="locale-col">
      <h4>
        {LANDING_LOCALE_LABELS[locale]}
        {row ? null : (
          <span className="badge">Not saved yet</span>
        )}
        {row?.status === 'draft' ? (
          <span className="badge badge--accent">Draft</span>
        ) : null}
      </h4>
      {conflict ? (
        <div className="notice notice--warning" role="alert">
          <strong>Someone else changed this row</strong> (now version{' '}
          {conflict.currentVersion}
          {conflict.changedKeys.length > 0 ? (
            <>
              ; changed: {conflict.changedKeys.join(', ')}
            </>
          ) : (
            '.'
          )}
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => onLoadTheirVersion(locale)}
            >
              Load their version
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onKeepMine(locale)}
            >
              Keep editing mine
            </button>
          </div>
        </div>
      ) : null}
      {scalar ? (
        <label>
          {fields[0]?.label ?? groupKey}
          {fields[0]?.kind === 'textarea' ? (
            <textarea
              value={form.__value ?? ''}
              onChange={(event) => setField('__value', event.target.value)}
              rows={3}
            />
          ) : (
            <input
              value={form.__value ?? ''}
              onChange={(event) => setField('__value', event.target.value)}
            />
          )}
        </label>
      ) : (
        fields.map((field) => (
          <label key={field.name}>
            {field.label}
            {field.kind === 'textarea' || field.kind === 'lines' || field.kind === 'metrics' ? (
              <textarea
                value={form[field.name] ?? ''}
                onChange={(event) => setField(field.name, event.target.value)}
                rows={field.kind === 'textarea' ? 3 : 4}
                placeholder={field.hint}
              />
            ) : field.kind === 'select' ? (
              <select
                value={form[field.name] ?? ''}
                onChange={(event) => setField(field.name, event.target.value)}
              >
                <option value="">—</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.kind === 'media' ? (
              <span className="media-field">
                <input
                  value={form[field.name] ?? ''}
                  onChange={(event) => setField(field.name, event.target.value)}
                  placeholder="https://… or pick from the library"
                />
                <button
                  type="button"
                  className="button button--sm"
                  onClick={() => setPickerFor(field.name)}
                >
                  Choose from library
                </button>
              </span>
            ) : field.kind === 'number' ? (
              <input
                type="number"
                inputMode="numeric"
                value={form[field.name] ?? ''}
                onChange={(event) => setField(field.name, event.target.value)}
              />
            ) : (
              <input
                value={form[field.name] ?? ''}
                onChange={(event) => setField(field.name, event.target.value)}
              />
            )}
            {field.hint && field.kind !== 'textarea' ? (
              <small className="muted-note">{field.hint}</small>
            ) : null}
          </label>
        ))
      )}
      {formError ? <ErrorNote message={formError} /> : null}
      <div className="domain-flags">
        <label>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          Active (shown on the landing when published)
        </label>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="button button--accent"
          disabled={busy}
          onClick={save}
        >
          {busy ? 'Saving…' : row ? 'Save' : 'Create'}
        </button>
        {row?.status === 'draft' ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => onPublish(locale)}
          >
            Publish
          </button>
        ) : null}
        {row ? (
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => onHistory(locale)}
          >
            History
          </button>
        ) : null}
        {row ? (
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={() => onDelete(locale)}
          >
            Delete
          </button>
        ) : null}
      </div>
      <MediaPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onSelect={pickFromLibrary}
        kinds={['image']}
        title="Choose an image"
      />
    </div>
  );
}

/** One key (field / capability / list item) with its en + bn editors. */
function LandingRowCard({
  api,
  section,
  group,
  pending,
  onChanged,
  onError,
  onRemovePending,
}: {
  api: ApiFn;
  section: LandingSection;
  group: LandingRowGroup;
  pending: boolean;
  onChanged: (message?: string) => void;
  onError: (message: string) => void;
  onRemovePending: (key: string) => void;
}) {
  const scalar = LANDING_SCALAR_SECTIONS.has(section);
  const defs = landingFieldDefs(section, group.key);
  const [sortOrder, setSortOrder] = useState(String(group.sortOrder));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<LandingLocale | null>(null);
  // Optimistic-locking state, per locale: a 409 conflict to resolve,
  // and the version a resolved conflict moved the editor to.
  const [conflict, setConflict] = useState<
    Partial<
      Record<LandingLocale, { currentVersion: number; changedKeys: string[] }>
    >
  >({});
  const [versionOverride, setVersionOverride] = useState<
    Partial<Record<LandingLocale, number>>
  >({});
  const [history, setHistory] = useState<{
    locale: LandingLocale;
    revisions: LandingContentRevision[] | null;
    loading: boolean;
  } | null>(null);
  const [restoreTarget, setRestoreTarget] =
    useState<LandingContentRevision | null>(null);

  // A reload (after any save/publish/restore) brings fresh rows — a
  // conflict or version override from the old rows no longer applies.
  useEffect(() => {
    setConflict({});
    setVersionOverride({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.en?.id, group.en?.updatedAt, group.bn?.id, group.bn?.updatedAt]);

  const order = Number(sortOrder);
  const orderValid = Number.isInteger(order) && order >= 0;

  async function saveLocale(
    locale: LandingLocale,
    form: LandingFormState,
    isActive: boolean,
  ) {
    const parsed = landingFormToValue(form, defs, scalar);
    if ('error' in parsed) {
      onError(parsed.error);
      return;
    }
    if (!orderValid) {
      onError('Order must be a whole number of 0 or more.');
      return;
    }
    const row = locale === 'en' ? group.en : group.bn;
    setBusy(true);
    try {
      if (row) {
        await api(`/landing-content/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            // Optimistic locking: the version this editor loaded — or
            // the version a resolved conflict moved it to.
            expectedVersion: versionOverride[locale] ?? row.version,
            value: parsed.value,
            sortOrder: order,
            isActive,
          }),
        }).then((r) => readJson(r));
        setVersionOverride((current) => {
          const next = { ...current };
          delete next[locale];
          return next;
        });
        setConflict((current) => {
          const next = { ...current };
          delete next[locale];
          return next;
        });
      } else {
        await api('/landing-content', {
          method: 'POST',
          body: JSON.stringify({
            section,
            key: group.key,
            locale,
            value: parsed.value,
            sortOrder: order,
            isActive,
          }),
        }).then((r) => readJson(r));
      }
      onChanged();
    } catch (err) {
      // A 409 is a resolvable conflict, not a page error: show the
      // banner in this editor instead of the page-level error note.
      if (err instanceof ApiError && err.status === 409) {
        const body = (err.body ?? {}) as {
          currentVersion?: number;
          changedKeys?: string[];
        };
        setConflict((current) => ({
          ...current,
          [locale]: {
            currentVersion: body.currentVersion ?? row?.version ?? 0,
            changedKeys: Array.isArray(body.changedKeys)
              ? body.changedKeys
              : [],
          },
        }));
      } else {
        onError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function publishLocale(locale: LandingLocale) {
    const row = locale === 'en' ? group.en : group.bn;
    if (!row || row.status !== 'draft') return;
    setBusy(true);
    try {
      const result = await api(`/landing-content/${row.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((r) => readJson<{ cachePurged?: boolean }>(r));
      onChanged(
        result.cachePurged
          ? 'Published — live on the landing now.'
          : 'Published — the landing cache refreshes within 5 minutes.',
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(locale: LandingLocale) {
    const row = locale === 'en' ? group.en : group.bn;
    if (!row) return;
    setHistory({ locale, revisions: null, loading: true });
    try {
      const result = await api(
        `/landing-content/${row.id}/revisions`,
      ).then((r) => readJson<LandingContentRevision[]>(r));
      setHistory({ locale, revisions: result, loading: false });
    } catch (err) {
      setHistory(null);
      onError(errorMessage(err));
    }
  }

  async function restoreRevision(revisionId: string) {
    if (!history) return;
    const row = history.locale === 'en' ? group.en : group.bn;
    if (!row) return;
    setBusy(true);
    try {
      await api(`/landing-content/${row.id}/restore/${revisionId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((r) => readJson(r));
      setRestoreTarget(null);
      setHistory(null);
      onChanged('Restored as a draft — publish it when ready.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function loadTheirVersion(locale: LandingLocale) {
    setConflict((current) => {
      const next = { ...current };
      delete next[locale];
      return next;
    });
    // Reloading re-syncs the editor form from the server row.
    onChanged('Loaded the latest version.');
  }

  function keepMine(locale: LandingLocale) {
    const entry = conflict[locale];
    if (!entry) return;
    // The operator saw what changed and chooses to overwrite it: the
    // next save uses the current version, so it succeeds.
    setVersionOverride((current) => ({
      ...current,
      [locale]: entry.currentVersion,
    }));
    setConflict((current) => {
      const next = { ...current };
      delete next[locale];
      return next;
    });
  }

  async function deleteLocale(locale: LandingLocale) {
    const row = locale === 'en' ? group.en : group.bn;
    if (!row) return;
    setBusy(true);
    try {
      await api(`/landing-content/${row.id}`, { method: 'DELETE' }).then(
        (r) => readJson(r),
      );
      setDeleting(null);
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title =
    section === 'capabilities'
      ? `${CAPABILITY_LABELS[group.key] ?? group.key} (${group.key})`
      : LANDING_OBJECT_SECTIONS.has(section)
        ? LANDING_SECTION_LABELS[section]
        : scalar
          ? landingScalarFieldLabel(section, group.key)
          : group.key;

  return (
    <article className="card landing-card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {scalar ? <p>Field: {group.key}</p> : null}
        </div>
        <div className="landing-order">
          <label>
            Order
            <input
              type="number"
              min={0}
              step={1}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </label>
          {pending ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onRemovePending(group.key)}
            >
              Discard
            </button>
          ) : null}
        </div>
      </div>
      <div className="locale-cols">
        {LANDING_LOCALES.map((locale) => (
          <LocaleEditor
            key={locale}
            groupKey={group.key}
            locale={locale}
            row={locale === 'en' ? group.en : group.bn}
            defs={defs}
            scalar={scalar}
            busy={busy}
            conflict={conflict[locale]}
            onSave={(loc, form, isActive) =>
              void saveLocale(loc, form, isActive)
            }
            onDelete={(loc) => setDeleting(loc)}
            onPublish={(loc) => void publishLocale(loc)}
            onHistory={(loc) => void openHistory(loc)}
            onLoadTheirVersion={(loc) => loadTheirVersion(loc)}
            onKeepMine={(loc) => keepMine(loc)}
          />
        ))}
      </div>
      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete the ${LANDING_LOCALE_LABELS[deleting]} version of "${group.key}"?`}
          body="The landing falls back to its built-in content for this item until you publish it again."
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => void deleteLocale(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
      {history ? (
        <Modal
          open
          wide
          title={`History — ${LANDING_LOCALE_LABELS[history.locale]} version of "${group.key}"`}
          onClose={() => setHistory(null)}
        >
          {history.loading ? (
            <p className="muted-note">Loading revisions…</p>
          ) : history.revisions && history.revisions.length > 0 ? (
            <ul className="revision-list">
              {history.revisions.map((revision) => (
                <li key={revision.id} className="revision-row">
                  <div>
                    <strong>Version {revision.version}</strong>{' '}
                    <span className="muted-note">
                      {new Date(revision.createdAt).toLocaleString()}
                    </span>
                    {revision.note ? (
                      <p className="muted-note">{revision.note}</p>
                    ) : (
                      <p className="muted-note">Published snapshot</p>
                    )}
                    <code className="revision-preview">
                      {previewRevisionValue(revision.value)}
                    </code>
                  </div>
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={busy}
                    onClick={() => setRestoreTarget(revision)}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-note">
              No published snapshots yet — publish this row once to create
              the first.
            </p>
          )}
        </Modal>
      ) : null}
      {restoreTarget ? (
        <ConfirmDialog
          open
          title={`Restore version ${restoreTarget.version} as a draft?`}
          body="The current draft is replaced with this snapshot. Nothing is published until you publish the restored draft — history is never rewritten."
          confirmLabel="Restore as draft"
          busy={busy}
          onConfirm={() => void restoreRevision(restoreTarget.id)}
          onClose={() => setRestoreTarget(null)}
        />
      ) : null}
    </article>
  );
}

function AddRowForm({
  section,
  existingKeys,
  pendingKeys,
  onAdd,
  onError,
}: {
  section: LandingSection;
  existingKeys: string[];
  pendingKeys: string[];
  onAdd: (key: string) => void;
  onError: (message: string) => void;
}) {
  const [key, setKey] = useState('');
  const taken = useMemo(
    () => new Set([...existingKeys, ...pendingKeys]),
    [existingKeys, pendingKeys],
  );

  const scalarOptions = landingScalarFieldNames(section).filter(
    (name) => !taken.has(name),
  );
  const capabilityOptions = CAPABILITY_KEYS.filter(
    (name) => !taken.has(name),
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = key.trim();
    if (!isValidLandingKey(value)) {
      onError(
        'Key must start with a letter or number, then letters, numbers or hyphens (max 80).',
      );
      return;
    }
    if (taken.has(value)) {
      onError(`"${value}" already exists in this section.`);
      return;
    }
    onAdd(value);
    setKey('');
  };

  if (LANDING_SCALAR_SECTIONS.has(section)) {
    if (scalarOptions.length === 0) return null;
    return (
      <section className="card">
        <form className="inline-form" onSubmit={submit}>
          <label>
            Add a field
            <select
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required
            >
              <option value="">Choose a field…</option>
              {scalarOptions.map((name) => (
                <option key={name} value={name}>
                  {landingScalarFieldLabel(section, name)} ({name})
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="button button--accent">
              Add field
            </button>
          </div>
        </form>
      </section>
    );
  }

  // Object sections hold exactly one row per locale (key 'main'); once
  // it exists there is nothing more to add.
  if (LANDING_OBJECT_SECTIONS.has(section)) {
    if (taken.has(LANDING_OBJECT_KEY)) return null;
    return (
      <section className="card">
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(LANDING_OBJECT_KEY);
          }}
        >
          <p className="muted-note">
            This section has one content block per locale — add it to start
            editing the landing copy.
          </p>
          <div className="form-actions">
            <button type="submit" className="button button--accent">
              Add content
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (section === 'capabilities') {
    if (capabilityOptions.length === 0) return null;
    return (
      <section className="card">
        <form className="inline-form" onSubmit={submit}>
          <label>
            Add a capability section
            <select
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required
            >
              <option value="">Choose a section…</option>
              {capabilityOptions.map((name) => (
                <option key={name} value={name}>
                  {CAPABILITY_LABELS[name] ?? name} ({name})
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="button button--accent">
              Add section
            </button>
          </div>
        </form>
      </section>
    );
  }

  const placeholder =
    section === 'faq'
      ? 'faq-5'
      : section === 'testimonials'
        ? 'story-business-name'
        : section === 'nav'
          ? 'nav-5'
          : section === 'footerLinks'
            ? 'footer-5'
            : section === 'legal.privacy' || section === 'legal.terms'
              ? 'block-1'
              : 'partner-brand-name';
  return (
    <section className="card">
      <form className="inline-form" onSubmit={submit}>
        <label>
          New item key
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={placeholder}
            required
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="button button--accent">
            Add item
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Section visibility toggles (CMS Batch 2, item 11): one switch per
 * page section. Visibility is locale-independent — a single 'en' row
 * per section id. A toggle takes effect immediately: the row is saved
 * AND published in one click (a switch that stages a draft would
 * surprise — the previous state is one click away, and publish keeps
 * the revision history anyway). A row that is somehow a draft (a
 * failed publish, or created outside this tab) shows a Publish button.
 */
function VisibilityTab({
  api,
  rows,
  loading,
  onChanged,
  onError,
}: {
  api: ApiFn;
  rows: LandingContentRow[];
  loading: boolean;
  onChanged: (message?: string) => void;
  onError: (message: string) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const byKey = useMemo(() => {
    const map = new Map<string, LandingContentRow>();
    for (const row of rows) {
      if (row.locale === 'en') map.set(row.key, row);
    }
    return map;
  }, [rows]);

  async function publishRow(rowId: string) {
    await api(`/landing-content/${rowId}/publish`, {
      method: 'POST',
      body: JSON.stringify({}),
    }).then((r) => readJson(r));
  }

  async function setVisible(id: string, visible: boolean) {
    const row = byKey.get(id);
    const label = SECTION_VISIBILITY_LABELS[id] ?? id;
    const sortOrder = SECTION_VISIBILITY_IDS.indexOf(
      id as (typeof SECTION_VISIBILITY_IDS)[number],
    );
    setBusyKey(id);
    try {
      let rowId = row?.id;
      if (row) {
        await api(`/landing-content/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: row.version,
            value: { visible },
            sortOrder,
            isActive: true,
          }),
        }).then((r) => readJson(r));
      } else {
        const created = await api('/landing-content', {
          method: 'POST',
          body: JSON.stringify({
            section: 'visibility',
            key: id,
            locale: 'en',
            value: { visible },
            sortOrder,
            isActive: true,
          }),
        }).then((r) => readJson<LandingContentRow>(r));
        rowId = created.id;
      }
      await publishRow(rowId!);
      onChanged(
        visible
          ? `"${label}" is visible on the landing.`
          : `"${label}" is hidden from the landing.`,
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function publishDraft(id: string) {
    const row = byKey.get(id);
    if (!row) return;
    setBusyKey(id);
    try {
      await publishRow(row.id);
      onChanged(`"${SECTION_VISIBILITY_LABELS[id] ?? id}" published.`);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading && rows.length === 0) return <Skeleton />;

  return (
    <section className="card">
      <p className="muted-note">
        Visibility is the same in English and Bangla — one switch per
        section, taking effect immediately. Hiding a section removes it
        from the landing entirely; hiding Pricing also removes the
        #pricing link from the navigation and footer. The hero, header,
        footer and contact dock are always shown.
      </p>
      <ul className="visibility-list">
        {SECTION_VISIBILITY_IDS.map((id) => {
          const row = byKey.get(id);
          const value = row?.value as { visible?: unknown } | undefined;
          const visible = value?.visible !== false;
          const isDraft = row?.status === 'draft';
          return (
            <li key={id} className="visibility-row">
              <label>
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={busyKey !== null}
                  onChange={(event) =>
                    void setVisible(id, event.target.checked)
                  }
                />
                {SECTION_VISIBILITY_LABELS[id] ?? id}
                <small>({id})</small>
              </label>
              {isDraft ? (
                <span className="badge badge--accent">Draft</span>
              ) : null}
              {isDraft ? (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busyKey !== null}
                  onClick={() => void publishDraft(id)}
                >
                  Publish
                </button>
              ) : null}
              {busyKey === id ? (
                <span className="muted-note">Saving…</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const LEGAL_DOCS: { section: LandingSection; title: string }[] = [
  { section: 'legal.privacy', title: 'Privacy Policy' },
  { section: 'legal.terms', title: 'Terms of Service' },
];

/**
 * Legal documents (CMS Batch 2, item 22): both legal.* sections in ONE
 * tab, each with its own block editors (reusing LandingRowCard, so
 * draft/publish/history/conflict all work as everywhere else). Blocks
 * render in Order; "Last updated" on the public page comes from the
 * latest row update across the document's blocks.
 */
function LegalTab({
  api,
  onChanged,
  onError,
}: {
  api: ApiFn;
  onChanged: (message?: string) => void;
  onError: (message: string) => void;
}) {
  const [rowsBySection, setRowsBySection] = useState<
    Record<string, LandingContentRow[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [pendingKeys, setPendingKeys] = useState<Record<string, string[]>>(
    {},
  );

  const load = () => {
    setLoading(true);
    Promise.all(
      LEGAL_DOCS.map((doc) =>
        api(
          `/landing-content${landingContentQueryString({ section: doc.section, limit: 100 })}`,
        )
          .then((r) => readJson<Page<LandingContentRow>>(r))
          .then((result) => [doc.section, result.data] as const),
      ),
    )
      .then((entries) => setRowsBySection(Object.fromEntries(entries)))
      .catch((err) => onError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  if (loading && Object.keys(rowsBySection).length === 0) return <Skeleton />;

  return (
    <>
      <p className="muted-note">
        The blocks on the public /privacy and /terms pages, in block
        order. Each block is a heading + body; the body format is
        paragraphs separated by blank lines, &ldquo;- &rdquo; lines for
        lists, and **bold** for emphasis. Until a document has published
        blocks, the public page shows its built-in copy.
      </p>
      {LEGAL_DOCS.map((doc) => {
        const rows = rowsBySection[doc.section] ?? [];
        const grouped = groupLandingRows(rows);
        const existing = new Set(grouped.map((g) => g.key));
        const pending = (pendingKeys[doc.section] ?? [])
          .filter((key) => !existing.has(key))
          .map((key) => ({
            key,
            sortOrder: grouped.length,
            en: undefined,
            bn: undefined,
          }));
        const groups = [...grouped, ...pending];
        return (
          <div key={doc.section}>
            <h2>{doc.title}</h2>
            <AddRowForm
              section={doc.section}
              existingKeys={groups.map((g) => g.key)}
              pendingKeys={pendingKeys[doc.section] ?? []}
              onAdd={(key) =>
                setPendingKeys((current) => ({
                  ...current,
                  [doc.section]: [...(current[doc.section] ?? []), key],
                }))
              }
              onError={onError}
            />
            {groups.length === 0 ? (
              <p className="muted-note">
                No blocks yet — the public page shows its built-in copy.
              </p>
            ) : null}
            {groups.map((group) => (
              <LandingRowCard
                key={group.key}
                api={api}
                section={doc.section}
                group={group}
                pending={
                  (pendingKeys[doc.section] ?? []).includes(group.key) &&
                  !group.en &&
                  !group.bn
                }
                onChanged={(message) => {
                  setPendingKeys((current) => ({
                    ...current,
                    [doc.section]: (current[doc.section] ?? []).filter(
                      (k) => k !== group.key,
                    ),
                  }));
                  load();
                  onChanged(message);
                }}
                onError={onError}
                onRemovePending={(key) =>
                  setPendingKeys((current) => ({
                    ...current,
                    [doc.section]: (current[doc.section] ?? []).filter(
                      (k) => k !== key,
                    ),
                  }))
                }
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

export function LandingPage() {
  const { api, session } = useAuth();
  // 'legal' is a pseudo-tab covering BOTH legal.* sections (one tab,
  // two documents — see LegalTab); every other value is a real section.
  const [section, setSection] = useState<LandingSection | 'legal'>('hero');
  const [rows, setRows] = useState<LandingContentRow[]>([]);
  const [health, setHealth] = useState<LandingContentHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [purging, setPurging] = useState(false);

  // Cache purge is a SUPERADMIN-only API; hide the button for everyone
  // else instead of showing an action that would 403.
  const canPurge = session?.user.role === 'SUPERADMIN';

  const load = () => {
    // The Legal tab loads its own rows (two sections); a generic load
    // here would fetch an unfiltered page of rows.
    if (section === 'legal') return;
    setLoading(true);
    api(
      `/landing-content${landingContentQueryString({ section, limit: 100 })}`,
    )
      .then((response) => readJson<Page<LandingContentRow>>(response))
      .then((result) => setRows(result.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  const loadHealth = () => {
    api('/landing-content/health')
      .then((response) => readJson<LandingContentHealth>(response))
      .then((result) => setHealth(result))
      .catch(() => {
        // Health is advisory — a failed fetch must not block editing.
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, section]);

  useEffect(() => {
    loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function purgeCache() {
    setPurging(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api('/landing-cache/purge', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const result = await readJson<{ revalidated?: string[] }>(response);
      const tags = result.revalidated ?? [];
      setNotice(
        tags.length > 0
          ? `Landing cache purged (${tags.join(', ')}) — edits are live now.`
          : 'Landing cache purged — edits are live now.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPurging(false);
    }
  }

  const missingBySection = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of health?.sections ?? []) {
      map.set(entry.section, entry.missingEn + entry.missingBn);
    }
    return map;
  }, [health]);

  const draftBySection = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of health?.sections ?? []) {
      map.set(entry.section, entry.draft);
    }
    return map;
  }, [health]);

  const groups = useMemo(() => {
    const grouped = groupLandingRows(rows);
    const existing = new Set(grouped.map((g) => g.key));
    const pending = pendingKeys
      .filter((key) => !existing.has(key))
      .map((key) => ({ key, sortOrder: grouped.length, en: undefined, bn: undefined }));
    return [...grouped, ...pending];
  }, [rows, pendingKeys]);

  const switchSection = (next: LandingSection | 'legal') => {
    setSection(next);
    setPendingKeys([]);
    setError(null);
    setNotice(null);
  };

  const onChanged = (message = 'Landing content saved.') => {
    setNotice(message);
    loadHealth();
    load();
  };

  return (
    <>
      <PageHeader
        eyebrow="Website"
        title="Landing"
        description="The copy on the public SaaS landing page, in English and Bangla. Design and layout stay in code — this edits words only."
      />
      <p className="muted-note">
        Sections with no published rows fall back to the built-in content,
        so the landing never breaks. Unpublishing a row hides the managed
        copy and restores the built-in text for that item.
      </p>
      {health ? (
        <div className="notice" role="status">
          <strong>Content health:</strong> {health.totals.total} rows ·{' '}
          {health.totals.published} published
          {health.totals.draft > 0 ? (
            <>
              {' '}· {health.totals.draft} draft
              {health.totals.draft === 1 ? '' : 's'} with unpublished changes
            </>
          ) : null}{' '}
          ·{' '}
          {health.totals.missingEn + health.totals.missingBn === 0
            ? 'every item is translated in both languages.'
            : `${health.totals.missingEn} missing English, ${health.totals.missingBn} missing Bangla.`}
        </div>
      ) : null}
      {canPurge ? (
        <div className="toolbar">
          <button
            type="button"
            className="button"
            disabled={purging}
            onClick={() => void purgeCache()}
          >
            {purging ? 'Purging…' : 'Purge landing cache'}
          </button>
          <span className="muted-note">
            The landing caches content for 5 minutes — purge to make edits
            live immediately.
          </span>
        </div>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}

      <ScrollableTabs label="Landing content sections">
        {LANDING_SECTIONS.map((value) => {
          // The two legal sections share ONE "Legal" tab (LegalTab
          // renders both documents); its badges sum both sections.
          if (value === 'legal.terms') return null;
          const isLegalTab = value === 'legal.privacy';
          const tabValue: LandingSection | 'legal' = isLegalTab
            ? 'legal'
            : value;
          const label = isLegalTab
            ? 'Legal'
            : LANDING_SECTION_LABELS[value];
          const missing = isLegalTab
            ? (missingBySection.get('legal.privacy') ?? 0) +
              (missingBySection.get('legal.terms') ?? 0)
            : (missingBySection.get(value) ?? 0);
          const drafts = isLegalTab
            ? (draftBySection.get('legal.privacy') ?? 0) +
              (draftBySection.get('legal.terms') ?? 0)
            : (draftBySection.get(value) ?? 0);
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={section === tabValue}
              className="tab"
              data-active={section === tabValue}
              onClick={() => switchSection(tabValue)}
            >
              {label}
              {drafts > 0 ? (
                <span className="badge badge--accent">
                  {drafts} draft{drafts === 1 ? '' : 's'}
                </span>
              ) : null}
              {missing > 0 ? (
                <span className="badge badge--muted">{missing} untranslated</span>
              ) : null}
            </button>
          );
        })}
      </ScrollableTabs>

      {section === 'legal' ? (
        <LegalTab
          api={api}
          onChanged={onChanged}
          onError={setError}
        />
      ) : section === 'visibility' ? (
        <VisibilityTab
          api={api}
          rows={rows}
          loading={loading}
          onChanged={onChanged}
          onError={setError}
        />
      ) : (
        <>
          {/* The add-form card renders inside AddRowForm: when a section has
          nothing left to add it returns null, so no empty card shows. */}
          <AddRowForm
            section={section}
            existingKeys={groups.map((g) => g.key)}
            pendingKeys={pendingKeys}
            onAdd={(key) => setPendingKeys((current) => [...current, key])}
            onError={setError}
          />

          {loading && rows.length === 0 ? <Skeleton /> : null}
          {!loading && groups.length === 0 ? (
            <p className="muted-note">
              Nothing managed in this section yet — the landing shows its
              built-in content. Add the first item above.
            </p>
          ) : null}
          {groups.map((group) => (
            <LandingRowCard
              key={group.key}
              api={api}
              section={section}
              group={group}
              pending={
                pendingKeys.includes(group.key) && !group.en && !group.bn
              }
              onChanged={(message) => {
                setPendingKeys((current) =>
                  current.filter((key) => key !== group.key),
                );
                onChanged(message);
              }}
              onError={setError}
              onRemovePending={(key) =>
                setPendingKeys((current) =>
                  current.filter((pending) => pending !== key),
                )
              }
            />
          ))}
        </>
      )}
    </>
  );
}
