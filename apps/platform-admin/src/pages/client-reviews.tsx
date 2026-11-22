import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Quote, Trash2 } from 'lucide-react';
import { useAuth } from '../auth';
import { ContentMediaFields } from '../components/media-fields';
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
  fetchCaseStudyList,
  type CaseStudy,
} from '../lib/case-studies';
import {
  CLIENT_REVIEW_FORMAT_LABELS,
  CLIENT_REVIEW_FORMATS,
  clientReviewFormatLabel,
  createClientReview,
  deleteClientReview,
  fetchClientReviewList,
  formatMetricLines,
  parseMetricLines,
  reviewQuote,
  updateClientReview,
  type ClientReview,
  type ClientReviewInput,
} from '../lib/client-reviews';
import {
  effectiveReviewFormat,
  emptyMediaValue,
  mediaValueFromRow,
  type ContentMediaValue,
} from '../lib/content-media';
import { formatDateTime } from '../lib/format';
import { resolveAbsoluteMediaUrl } from '../lib/media';

/**
 * Client reviews (Landing CMS — shared media model): the dedicated
 * console page for the public landing home page's video slider + text
 * grid. List + create/edit form (with the shared ContentMediaFields
 * editor) + publish toggle. Writes are SUPERADMIN/BILLING only (the
 * API enforces it too); other roles get a read-only list. No
 * browser-native dialogs — in-app confirm + toasts only.
 *
 * Format: "Auto (from media)" derives the stored format from the
 * media at save time (video present → video_standard, image only →
 * image, neither → text); the operator may override to video_short
 * for a vertical/short clip. The public read re-derives the effective
 * format anyway, so a stale stored format never breaks the landing.
 */

interface FormState {
  reviewerName: string;
  role: string;
  companyName: string;
  category: string;
  location: string;
  quoteEn: string;
  quoteBn: string;
  websiteUrl: string;
  logoUrl: string;
  rating: string;
  metricsText: string;
  format: string;
  videoProvider: string;
  videoDuration: string;
  caseStudyId: string;
  sortOrder: string;
  isFeatured: boolean;
  status: string;
  media: ContentMediaValue;
}

function emptyForm(): FormState {
  return {
    reviewerName: '',
    role: '',
    companyName: '',
    category: '',
    location: '',
    quoteEn: '',
    quoteBn: '',
    websiteUrl: '',
    logoUrl: '',
    rating: '',
    metricsText: '',
    format: '',
    videoProvider: 'youtube',
    videoDuration: '',
    caseStudyId: '',
    sortOrder: '0',
    isFeatured: false,
    status: 'draft',
    media: emptyMediaValue(),
  };
}

function formFromReview(review: ClientReview): FormState {
  return {
    reviewerName: review.reviewerName,
    role: review.role,
    companyName: review.companyName,
    category: review.category,
    location: review.location,
    quoteEn: review.quoteEn,
    quoteBn: review.quoteBn,
    websiteUrl: review.websiteUrl ?? '',
    logoUrl: review.logoUrl ?? '',
    rating: review.rating === null ? '' : String(review.rating),
    metricsText: formatMetricLines(review.metrics),
    format: review.format,
    videoProvider: review.videoProvider,
    videoDuration: review.videoDuration,
    caseStudyId: review.caseStudyId ?? '',
    sortOrder: String(review.sortOrder),
    isFeatured: review.isFeatured,
    status: review.status,
    media: mediaValueFromRow(review),
  };
}

export function ClientReviewsPage() {
  const { api, session } = useAuth();
  const { pushToast } = useToast();
  const role = session?.user.role ?? '';
  const canManage = role === 'SUPERADMIN' || role === 'BILLING';

  const [items, setItems] = useState<ClientReview[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const [editing, setEditing] = useState<ClientReview | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [studies, setStudies] = useState<CaseStudy[]>([]);

  const [deleting, setDeleting] = useState<ClientReview | null>(null);
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
      const res = await fetchClientReviewList(api, {
        page,
        limit,
        q: search || undefined,
        status: statusFilter || undefined,
      });
      setItems(res.data);
      setTotal(res.meta.total);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, page, limit, search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Case studies for the "link to a case study" select (loaded once,
  // when the editor first opens).
  async function ensureStudies() {
    if (studies.length > 0) return;
    try {
      const res = await fetchCaseStudyList(api, { limit: 100 });
      setStudies(res.data);
    } catch {
      // A failed load leaves the select empty — the link is optional.
    }
  }

  function openCreate() {
    setForm(emptyForm());
    setFormError(null);
    setEditing('new');
    void ensureStudies();
  }

  function openEdit(review: ClientReview) {
    setForm(formFromReview(review));
    setFormError(null);
    setEditing(review);
    void ensureStudies();
  }

  function closeEditor() {
    setEditing(null);
    setLogoPickerOpen(false);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const reviewerName = form.reviewerName.trim();
    const companyName = form.companyName.trim();
    const quoteEn = form.quoteEn.trim();
    if (!reviewerName || !companyName || !quoteEn) {
      setFormError(
        'Reviewer name, company name and the English quote are all required.',
      );
      return;
    }
    if (quoteEn.length > 5000 || form.quoteBn.trim().length > 5000) {
      setFormError('Each quote holds at most 5000 characters.');
      return;
    }
    const rating = form.rating.trim();
    if (rating !== '' && !/^[1-5]$/.test(rating)) {
      setFormError('Rating is 1–5 stars, or blank for not given.');
      return;
    }
    if (
      form.videoDuration.trim() !== '' &&
      !/^\d{1,3}:\d{2}$/.test(form.videoDuration.trim())
    ) {
      setFormError('Video duration must be "M:SS" (e.g. 2:41).');
      return;
    }
    const sortOrder = Number(form.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
      setFormError('Sort order is a whole number from 0 to 10000.');
      return;
    }
    const { lines, error: metricsError } = parseMetricLines(form.metricsText);
    if (metricsError) {
      setFormError(metricsError);
      return;
    }
    const media = form.media;
    const input: ClientReviewInput = {
      reviewerName,
      role: form.role.trim(),
      companyName,
      category: form.category.trim(),
      location: form.location.trim(),
      quoteEn,
      quoteBn: form.quoteBn.trim(),
      websiteUrl: form.websiteUrl.trim() || undefined,
      logoUrl: form.logoUrl.trim() || undefined,
      rating: rating === '' ? null : Number(rating),
      metrics: lines,
      format:
        form.format === ''
          ? effectiveReviewFormat('text', media)
          : form.format,
      videoProvider: form.videoProvider,
      videoDuration: form.videoDuration.trim(),
      caseStudyId: form.caseStudyId || null,
      sortOrder,
      isFeatured: form.isFeatured,
      status: form.status,
      thumbnailType: media.thumbnailType,
      thumbnailUrl: media.thumbnailUrl.trim() || undefined,
      thumbnailVideoUrl: media.thumbnailVideoUrl.trim() || undefined,
      thumbnailAutoplay: media.thumbnailAutoplay,
      videos: media.videos,
      galleryImages: media.galleryImages,
    };
    setFormError(null);
    setSaving(true);
    try {
      if (editing === 'new') {
        await createClientReview(api, input);
        pushToast('Client review created.');
      } else if (editing) {
        await updateClientReview(api, editing.id, input);
        pushToast('Client review saved.');
      }
      closeEditor();
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish(review: ClientReview) {
    setBusyId(review.id);
    try {
      await updateClientReview(api, review.id, {
        status: review.status === 'published' ? 'draft' : 'published',
      });
      pushToast(
        review.status === 'published'
          ? 'Client review unpublished.'
          : 'Client review published.',
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
      await deleteClientReview(api, deleting.id);
      pushToast('Client review deleted.');
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
        title="Client Reviews"
        description="Published reviews power the landing home page: video reviews in the slider, text and image reviews in the grid. Drafts never appear on the landing."
        actions={
          canManage ? (
            <button
              type="button"
              className="button button--primary"
              onClick={openCreate}
            >
              <Plus size={16} aria-hidden="true" /> New review
            </button>
          ) : undefined
        }
      />

      <div className="toolbar">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search reviewer, company or role…"
          aria-label="Search client reviews"
        />
        <select
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <Skeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState icon={Quote} title="No client reviews yet">
          {canManage
            ? 'Create the first review — it appears on the landing once published. Until then the landing shows its built-in sample stories.'
            : 'No client reviews have been created yet.'}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reviewer</th>
                  <th>Company</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((review) => (
                  <tr key={review.id}>
                    <td>
                      <strong>{review.reviewerName}</strong>
                      <div className="muted-note">
                        {review.role || '—'}
                        {review.isFeatured ? ' · Featured' : ''}
                      </div>
                    </td>
                    <td>{review.companyName}</td>
                    <td>{clientReviewFormatLabel(review.effectiveFormat)}</td>
                    <td>
                      <span
                        className={
                          review.status === 'published'
                            ? 'badge badge--accent'
                            : 'badge badge--neutral'
                        }
                      >
                        {review.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td>{formatDateTime(review.updatedAt)}</td>
                    <td className="row-actions">
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            disabled={busyId === review.id}
                            onClick={() => void togglePublish(review)}
                          >
                            {review.status === 'published'
                              ? 'Unpublish'
                              : 'Publish'}
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            aria-label={`Edit review by ${review.reviewerName}`}
                            onClick={() => openEdit(review)}
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            aria-label={`Delete review by ${review.reviewerName}`}
                            onClick={() => setDeleting(review)}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => openEdit(review)}
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
            ? 'New client review'
            : editing
              ? `Edit review by “${editing.reviewerName}”`
              : 'Client review'
        }
        wide
        onClose={closeEditor}
      >
        {editing !== null && (
          <div>
            <div className="inline-form">
              <label>
                Reviewer name *
                <input
                  value={form.reviewerName}
                  onChange={(event) =>
                    setField('reviewerName', event.target.value)
                  }
                  disabled={saving || !canManage}
                  maxLength={200}
                  placeholder="Ayesha Rahman"
                  autoFocus
                />
              </label>
              <label>
                Role / title
                <input
                  value={form.role}
                  onChange={(event) => setField('role', event.target.value)}
                  disabled={saving || !canManage}
                  maxLength={200}
                  placeholder="Founder"
                />
              </label>
              <label>
                Company / store *
                <input
                  value={form.companyName}
                  onChange={(event) =>
                    setField('companyName', event.target.value)
                  }
                  disabled={saving || !canManage}
                  maxLength={200}
                  placeholder="Aranya Apparel"
                />
              </label>
              <label>
                Category
                <input
                  value={form.category}
                  onChange={(event) => setField('category', event.target.value)}
                  disabled={saving || !canManage}
                  maxLength={200}
                  placeholder="Fashion"
                />
              </label>
              <label>
                Location
                <input
                  value={form.location}
                  onChange={(event) => setField('location', event.target.value)}
                  disabled={saving || !canManage}
                  maxLength={200}
                  placeholder="Dhaka"
                />
              </label>
              <label>
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
            </div>
            <label className="field">
              Quote (English) *
              <textarea
                value={form.quoteEn}
                onChange={(event) => setField('quoteEn', event.target.value)}
                disabled={saving || !canManage}
                rows={4}
                maxLength={5000}
                placeholder="What the client said, in their own words."
              />
            </label>
            <label className="field">
              Quote (Bangla)
              <textarea
                value={form.quoteBn}
                onChange={(event) => setField('quoteBn', event.target.value)}
                disabled={saving || !canManage}
                rows={4}
                maxLength={5000}
                placeholder="Empty falls back to the English quote."
              />
            </label>
            <label className="field">
              Company logo URL
              <input
                value={form.logoUrl}
                onChange={(event) => setField('logoUrl', event.target.value)}
                disabled={saving || !canManage}
                maxLength={2048}
                placeholder="https://… (the reviewer photo is the thumbnail below)"
              />
              {canManage ? (
                <small className="muted-note">
                  <button
                    type="button"
                    className="table-link"
                    onClick={() => setLogoPickerOpen(true)}
                  >
                    Choose from media
                  </button>
                </small>
              ) : null}
            </label>
            <div className="inline-form">
              <label>
                Rating (1–5, blank = not given)
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.rating}
                  onChange={(event) => setField('rating', event.target.value)}
                  disabled={saving || !canManage}
                  placeholder="5"
                />
              </label>
              <label>
                Format
                <select
                  value={form.format}
                  onChange={(event) => setField('format', event.target.value)}
                  disabled={saving || !canManage}
                >
                  <option value="">Auto (from media)</option>
                  {CLIENT_REVIEW_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {CLIENT_REVIEW_FORMAT_LABELS[format]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Video provider
                <select
                  value={form.videoProvider}
                  onChange={(event) =>
                    setField('videoProvider', event.target.value)
                  }
                  disabled={saving || !canManage}
                >
                  <option value="youtube">YouTube</option>
                  <option value="upload">Upload</option>
                </select>
              </label>
              <label>
                Video duration (M:SS)
                <input
                  value={form.videoDuration}
                  onChange={(event) =>
                    setField('videoDuration', event.target.value)
                  }
                  disabled={saving || !canManage}
                  maxLength={40}
                  placeholder="2:41"
                />
              </label>
              <label>
                Sort order
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={form.sortOrder}
                  onChange={(event) =>
                    setField('sortOrder', event.target.value)
                  }
                  disabled={saving || !canManage}
                />
              </label>
              <label>
                Status
                <select
                  value={form.status}
                  onChange={(event) => setField('status', event.target.value)}
                  disabled={saving || !canManage}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
            </div>
            <label className="field">
              Link to a case study
              <select
                value={form.caseStudyId}
                onChange={(event) =>
                  setField('caseStudyId', event.target.value)
                }
                disabled={saving || !canManage}
              >
                <option value="">No case study</option>
                {studies.map((study) => (
                  <option key={study.id} value={study.id}>
                    {study.title} (/{study.slug})
                  </option>
                ))}
              </select>
              <small className="muted-note">
                The text-review card links to the full case study.
              </small>
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
            <div className="domain-flags">
              <label>
                <input
                  type="checkbox"
                  checked={form.isFeatured}
                  onChange={(event) =>
                    setField('isFeatured', event.target.checked)
                  }
                  disabled={saving || !canManage}
                />
                Featured (first in the slider / grid)
              </label>
            </div>

            <ContentMediaFields
              value={form.media}
              onChange={(media) => setField('media', media)}
              disabled={saving || !canManage}
              folder="client-reviews"
            />
            <p className="muted-note">
              The thumbnail is the reviewer photo. A video review&apos;s
              thumbnail video plays in the slider; the poster shows
              before play.
            </p>

            {editing !== 'new' && editing ? (
              <p className="muted-note">
                Showing on the landing as:{' '}
                {clientReviewFormatLabel(editing.effectiveFormat)} — “
                {reviewQuote(editing, 'en').slice(0, 80)}
                {reviewQuote(editing, 'en').length > 80 ? '…' : ''}”
              </p>
            ) : null}

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
        open={logoPickerOpen}
        onClose={() => setLogoPickerOpen(false)}
        onSelect={(asset) => {
          setField('logoUrl', resolveAbsoluteMediaUrl(asset.contentUrl));
          setLogoPickerOpen(false);
        }}
        kinds={['image']}
        title="Choose a company logo"
        folder="client-reviews"
      />

      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete the review by “${deleting.reviewerName}”?`}
          body="The review disappears from the landing immediately. This cannot be undone."
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
