import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
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
  LANDING_SCALAR_SECTIONS,
  LANDING_SECTIONS,
  LANDING_SECTION_LABELS,
  type LandingFieldDef,
  type LandingFormState,
  type LandingLocale,
  type LandingRowGroup,
  type LandingSection,
} from '../lib/landing-content';
import type { LandingContentRow, Page } from '../types';
import {
  ConfirmDialog,
  ErrorNote,
  Loading,
  PageHeader,
  ScrollableTabs,
} from '../components/ui';

type ApiFn = (path: string, init?: RequestInit) => Promise<Response>;

/** One editable locale column inside a row card. */
function LocaleEditor({
  groupKey,
  locale,
  row,
  defs,
  scalar,
  sortOrder,
  busy,
  onSave,
  onDelete,
}: {
  groupKey: string;
  locale: LandingLocale;
  row?: LandingContentRow;
  defs: LandingFieldDef[];
  scalar: boolean;
  sortOrder: number;
  busy: boolean;
  onSave: (locale: LandingLocale, form: LandingFormState, isActive: boolean) => void;
  onDelete: (locale: LandingLocale) => void;
}) {
  const [form, setForm] = useState<LandingFormState>(() =>
    landingValueToForm(row?.value, defs, scalar),
  );
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  // Re-sync when the underlying row changes (after a save + reload).
  useEffect(() => {
    setForm(landingValueToForm(row?.value, defs, scalar));
    setIsActive(row?.isActive ?? true);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.updatedAt]);

  const setField = (name: string, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));

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
          <span className="badge"> Not saved yet</span>
        )}
      </h4>
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
          Published (visible on the landing)
        </label>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={save}
        >
          {busy ? 'Saving…' : row ? 'Save' : 'Create'}
        </button>
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
      <p className="muted-note">Order: {sortOrder}</p>
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
  onChanged: () => void;
  onError: (message: string) => void;
  onRemovePending: (key: string) => void;
}) {
  const scalar = LANDING_SCALAR_SECTIONS.has(section);
  const defs = landingFieldDefs(section, group.key);
  const [sortOrder, setSortOrder] = useState(String(group.sortOrder));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<LandingLocale | null>(null);

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
            value: parsed.value,
            sortOrder: order,
            isActive,
          }),
        }).then((r) => readJson(r));
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
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
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
            sortOrder={orderValid ? order : group.sortOrder}
            busy={busy}
            onSave={(loc, form, isActive) =>
              void saveLocale(loc, form, isActive)
            }
            onDelete={(loc) => setDeleting(loc)}
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

  if (section === 'hero' || section === 'contact') {
    if (scalarOptions.length === 0) return null;
    return (
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
          <button type="submit" className="button button--primary">
            Add field
          </button>
        </div>
      </form>
    );
  }

  if (section === 'capabilities') {
    if (capabilityOptions.length === 0) return null;
    return (
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
          <button type="submit" className="button button--primary">
            Add section
          </button>
        </div>
      </form>
    );
  }

  const placeholder =
    section === 'faq'
      ? 'faq-5'
      : section === 'testimonials'
        ? 'story-business-name'
        : 'partner-brand-name';
  return (
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
        <button type="submit" className="button button--primary">
          Add item
        </button>
      </div>
    </form>
  );
}

export function LandingPage() {
  const { api } = useAuth();
  const [section, setSection] = useState<LandingSection>('hero');
  const [rows, setRows] = useState<LandingContentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);

  const load = () => {
    setLoading(true);
    api(
      `/landing-content${landingContentQueryString({ section, limit: 100 })}`,
    )
      .then((response) => readJson<Page<LandingContentRow>>(response))
      .then((result) => setRows(result.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, section]);

  const groups = useMemo(() => {
    const grouped = groupLandingRows(rows);
    const existing = new Set(grouped.map((g) => g.key));
    const pending = pendingKeys
      .filter((key) => !existing.has(key))
      .map((key) => ({ key, sortOrder: grouped.length, en: undefined, bn: undefined }));
    return [...grouped, ...pending];
  }, [rows, pendingKeys]);

  const switchSection = (next: LandingSection) => {
    setSection(next);
    setPendingKeys([]);
    setError(null);
    setNotice(null);
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
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}

      <ScrollableTabs label="Landing content sections">
        {LANDING_SECTIONS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            className="tab"
            data-active={section === value}
            onClick={() => switchSection(value)}
          >
            {LANDING_SECTION_LABELS[value]}
          </button>
        ))}
      </ScrollableTabs>

      <section className="card">
        <AddRowForm
          section={section}
          existingKeys={groups.map((g) => g.key)}
          pendingKeys={pendingKeys}
          onAdd={(key) => setPendingKeys((current) => [...current, key])}
          onError={setError}
        />
      </section>

      {loading && rows.length === 0 ? <Loading /> : null}
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
          onChanged={() => {
            setPendingKeys((current) =>
              current.filter((key) => key !== group.key),
            );
            setNotice('Landing content saved.');
            load();
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
  );
}
