import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Images, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../auth';
import { MediaPicker } from '../components/media-picker';
import {
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Modal,
  Pager,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { errorMessage } from '../lib/api';
import {
  createCaseStudy,
  deleteCaseStudy,
  fetchCaseStudyList,
  formatMetricLines,
  isValidCaseStudySlug,
  parseMetricLines,
  slugifyTitle,
  updateCaseStudy,
  type CaseStudy,
  type CaseStudyInput,
} from '../lib/case-studies';
import { formatDateTime } from '../lib/format';
import { resolveAbsoluteMediaUrl } from '../lib/media';

/**
 * Case studies (Landing CMS item 19): the dedicated console page for
 * the public /case-studies pages. List + create/edit form (with the
 * media picker for the featured image) + publish toggle. Writes are
 * SUPERADMIN/BILLING only (the API enforces it too); other roles get
 * a read-only list. No browser-native dialogs — in-app confirm +
 * toasts only.
 */

interface FormState {
  title: string;
  slug: string;
  client: string;
  businessType: string;
  problem: string;
  solution: string;
  outcome: string;
  metricsText: string;
  featuredImageUrl: string;
  videoUrl: string;
  websiteUrl: string;
  seoTitle: string;
  seoDescription: string;
  isPublished: boolean;
}

function emptyForm(): FormState {
  return {
    title: '',
    slug: '',
    client: '',
    businessType: '',
    problem: '',
    solution: '',
    outcome: '',
    metricsText: '',
    featuredImageUrl: '',
    videoUrl: '',
    websiteUrl: '',
    seoTitle: '',
    seoDescription: '',
    isPublished: false,
  };
}

function formFromStudy(study: CaseStudy): FormState {
  return {
    title: study.title,
    slug: study.slug,
    client: study.client,
    businessType: study.businessType,
    problem: study.problem,
    solution: study.solution,
    outcome: study.outcome,
    metricsText: formatMetricLines(study.metrics),
    featuredImageUrl: study.featuredImageUrl ?? '',
    videoUrl: study.videoUrl ?? '',
    websiteUrl: study.websiteUrl ?? '',
    seoTitle: study.seoTitle ?? '',
    seoDescription: study.seoDescription ?? '',
    isPublished: study.isPublished,
  };
}

export function CaseStudiesPage() {
  const { api, session } = useAuth();
  const { pushToast } = useToast();
  const role = session?.user.role ?? '';
  const canManage = role === 'SUPERADMIN' || role === 'BILLING';

  const [items, setItems] = useState<CaseStudy[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const [editing, setEditing] = useState<CaseStudy | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [deleting, setDeleting] = useState<CaseStudy | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCaseStudyList(api, {
        page,
        limit,
        q: search || undefined,
      });
      setItems(res.data);
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, page, limit, search]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm(emptyForm());
    setFormError(null);
    setEditing('new');
  }

  function openEdit(study: CaseStudy) {
    setForm(formFromStudy(study));
    setFormError(null);
    setEditing(study);
  }

  function closeEditor() {
    setEditing(null);
    setPickerOpen(false);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const title = form.title.trim();
    const slug = form.slug.trim();
    const client = form.client.trim();
    const businessType = form.businessType.trim();
    const problem = form.problem.trim();
    const solution = form.solution.trim();
    const outcome = form.outcome.trim();
    if (!title || !slug || !client || !businessType || !problem || !solution || !outcome) {
      setFormError(
        'Title, slug, client, business type, problem, solution and outcome are all required.',
      );
      return;
    }
    if (!isValidCaseStudySlug(slug)) {
      setFormError(
        'Slug must be lowercase letters, digits and hyphens (e.g. dhaka-fashion-house).',
      );
      return;
    }
    const { lines, error: metricsError } = parseMetricLines(form.metricsText);
    if (metricsError) {
      setFormError(metricsError);
      return;
    }
    const input: CaseStudyInput = {
      title,
      slug,
      client,
      businessType,
      problem,
      solution,
      outcome,
      metrics: lines,
      featuredImageUrl: form.featuredImageUrl.trim() || undefined,
      videoUrl: form.videoUrl.trim() || undefined,
      websiteUrl: form.websiteUrl.trim() || undefined,
      seoTitle: form.seoTitle.trim() || undefined,
      seoDescription: form.seoDescription.trim() || undefined,
      isPublished: form.isPublished,
    };
    setFormError(null);
    setSaving(true);
    try {
      if (editing === 'new') {
        await createCaseStudy(api, input);
        pushToast('Case study created.');
      } else if (editing) {
        await updateCaseStudy(api, editing.id, input);
        pushToast('Case study saved.');
      }
      closeEditor();
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish(study: CaseStudy) {
    setBusyId(study.id);
    try {
      await updateCaseStudy(api, study.id, {
        isPublished: !study.isPublished,
      });
      pushToast(
        study.isPublished
          ? 'Case study unpublished.'
          : 'Case study published.',
      );
      await load();
    } catch (err) {
      pushToast(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await deleteCaseStudy(api, deleting.id);
      pushToast('Case study deleted.');
      setDeleting(null);
      await load();
    } catch (err) {
      pushToast(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Website"
        title="Case studies"
        description="Customer stories for the public /case-studies pages. Only published studies appear on the landing and in the sitemap."
        actions={
          canManage ? (
            <button
              type="button"
              className="button button--primary"
              onClick={openCreate}
            >
              <Plus size={16} aria-hidden="true" /> New case study
            </button>
          ) : undefined
        }
      />

      <div className="toolbar">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search title, slug or client…"
          aria-label="Search case studies"
        />
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <Skeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No case studies yet"
        >
          {canManage
            ? 'Create the first customer story — it appears on the landing once published.'
            : 'No case studies have been created yet.'}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((study) => (
                  <tr key={study.id}>
                    <td>
                      <strong>{study.title}</strong>
                      <div className="muted-note">/{study.slug}</div>
                    </td>
                    <td>{study.client}</td>
                    <td>{study.businessType}</td>
                    <td>
                      <span
                        className={
                          study.isPublished
                            ? 'badge badge--accent'
                            : 'badge badge--neutral'
                        }
                      >
                        {study.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td>{formatDateTime(study.updatedAt)}</td>
                    <td className="row-actions">
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            disabled={busyId === study.id}
                            onClick={() => void togglePublish(study)}
                          >
                            {study.isPublished ? 'Unpublish' : 'Publish'}
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            aria-label={`Edit ${study.title}`}
                            onClick={() => openEdit(study)}
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            aria-label={`Delete ${study.title}`}
                            onClick={() => setDeleting(study)}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => openEdit(study)}
                        >
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            totalPages={totalPages}
            total={total}
            limit={limit}
            onPage={setPage}
            onLimit={(next) => {
              setLimit(next);
              setPage(1);
            }}
          />
        </>
      )}

      <Modal
        open={editing !== null}
        title={
          editing === 'new'
            ? 'New case study'
            : editing
              ? `Edit “${editing.title}”`
              : 'Case study'
        }
        wide
        onClose={closeEditor}
      >
        {editing !== null && (
          <div>
            <label className="field">
              Title
              <input
                value={form.title}
                onChange={(event) => setField('title', event.target.value)}
                disabled={saving || !canManage}
                maxLength={200}
                placeholder="Dhaka Fashion House"
                autoFocus
              />
            </label>
            <label className="field">
              Slug
              <input
                value={form.slug}
                onChange={(event) => setField('slug', event.target.value)}
                disabled={saving || !canManage}
                maxLength={100}
                placeholder="dhaka-fashion-house"
              />
              <small className="muted-note">
                The public URL is /case-studies/{form.slug || '…'}.
                {canManage && form.title.trim() ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="table-link"
                      onClick={() =>
                        setField('slug', slugifyTitle(form.title))
                      }
                    >
                      Use title
                    </button>
                  </>
                ) : null}
              </small>
            </label>
            <label className="field">
              Client
              <input
                value={form.client}
                onChange={(event) => setField('client', event.target.value)}
                disabled={saving || !canManage}
                maxLength={200}
                placeholder="Dhaka Fashion House Ltd."
              />
            </label>
            <label className="field">
              Business type
              <input
                value={form.businessType}
                onChange={(event) =>
                  setField('businessType', event.target.value)
                }
                disabled={saving || !canManage}
                maxLength={200}
                placeholder="Fashion retail"
              />
            </label>
            <label className="field">
              Problem
              <textarea
                value={form.problem}
                onChange={(event) => setField('problem', event.target.value)}
                disabled={saving || !canManage}
                rows={4}
                placeholder="What was broken before EcoMate?"
              />
            </label>
            <label className="field">
              Solution
              <textarea
                value={form.solution}
                onChange={(event) => setField('solution', event.target.value)}
                disabled={saving || !canManage}
                rows={4}
                placeholder="What changed when they moved to EcoMate?"
              />
            </label>
            <label className="field">
              Outcome
              <textarea
                value={form.outcome}
                onChange={(event) => setField('outcome', event.target.value)}
                disabled={saving || !canManage}
                rows={4}
                placeholder="The result — in the client's own terms."
              />
            </label>
            <label className="field">
              Metrics (one per line)
              <textarea
                value={form.metricsText}
                onChange={(event) =>
                  setField('metricsText', event.target.value)
                }
                disabled={saving || !canManage}
                rows={3}
                placeholder={'3x | Faster packing\n৳2.1M | Monthly GMV'}
              />
              <small className="muted-note">
                Format: stat | label — at most 6 lines.
              </small>
            </label>
            <label className="field">
              Featured image URL
              <input
                value={form.featuredImageUrl}
                onChange={(event) =>
                  setField('featuredImageUrl', event.target.value)
                }
                disabled={saving || !canManage}
                maxLength={2048}
                placeholder="https://…"
              />
              {canManage ? (
                <small className="muted-note">
                  <button
                    type="button"
                    className="table-link"
                    onClick={() => setPickerOpen(true)}
                  >
                    <Images size={14} aria-hidden="true" /> Choose from media
                  </button>
                </small>
              ) : null}
            </label>
            <label className="field">
              Video URL
              <input
                value={form.videoUrl}
                onChange={(event) => setField('videoUrl', event.target.value)}
                disabled={saving || !canManage}
                maxLength={2048}
                placeholder="https://www.youtube.com/watch?v=…"
              />
              <small className="muted-note">
                YouTube links embed on the detail page; other links render
                as a plain link.
              </small>
            </label>
            <label className="field">
              Website URL
              <input
                value={form.websiteUrl}
                onChange={(event) =>
                  setField('websiteUrl', event.target.value)
                }
                disabled={saving || !canManage}
                maxLength={2048}
                placeholder="https://example.com"
              />
            </label>
            <label className="field">
              SEO title
              <input
                value={form.seoTitle}
                onChange={(event) => setField('seoTitle', event.target.value)}
                disabled={saving || !canManage}
                maxLength={200}
                placeholder="Defaults to “{title} — EcoMate case study”"
              />
            </label>
            <label className="field">
              SEO description
              <textarea
                value={form.seoDescription}
                onChange={(event) =>
                  setField('seoDescription', event.target.value)
                }
                disabled={saving || !canManage}
                rows={2}
                maxLength={400}
                placeholder="Defaults to the outcome text."
              />
            </label>
            <div className="domain-flags">
              <label>
                <input
                  type="checkbox"
                  checked={form.isPublished}
                  onChange={(event) =>
                    setField('isPublished', event.target.checked)
                  }
                  disabled={saving || !canManage}
                />
                Published (visible on the landing)
              </label>
            </div>
            {formError ? <ErrorNote message={formError} /> : null}
            <div className="form-actions">
              <button
                type="button"
                className="button"
                onClick={closeEditor}
                disabled={saving}
              >
                {canManage ? 'Cancel' : 'Close'}
              </button>
              {canManage ? (
                <button
                  type="button"
                  className="button button--accent"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving
                    ? 'Saving…'
                    : editing === 'new'
                      ? 'Create'
                      : 'Save'}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </Modal>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(asset) => {
          setField('featuredImageUrl', resolveAbsoluteMediaUrl(asset.contentUrl));
          setPickerOpen(false);
        }}
        kinds={['image']}
        title="Choose a featured image"
        folder="case-studies"
      />

      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete “${deleting.title}”?`}
          body="The case study disappears from the landing and the sitemap immediately. This cannot be undone."
          confirmLabel="Delete"
          danger
          busy={busyId === deleting.id}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
