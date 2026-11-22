import { useRef, useState } from 'react';
import { errorMessage } from '../lib/api';
import {
  flattenCategories,
  slugify,
  type BlogCategory,
  type BlogPost,
  type BlogPostInput,
  type BlogTag,
} from '../lib/blog';
import {
  emptyMediaValue,
  mediaValueFromRow,
  type ContentMediaValue,
} from '../lib/content-media';
import { resolveAbsoluteMediaUrl, type MediaAsset } from '../lib/media';
import { ContentMediaFields } from './media-fields';
import { ErrorNote } from './ui';
import { MediaPicker } from './media-picker';
import { RichTextEditor } from './rich-text-editor';

/**
 * Blog post editor (console /blog → New post / Edit).
 *
 * Full-page form (not a modal — the form is too large): bilingual
 * titles/excerpts, two Tiptap editors (EN + BN content), category,
 * tags, the shared ContentMediaFields media editor, status/scheduling,
 * read time, SEO. Only the six new media fields are sent on save —
 * the API derives the legacy featuredImageUrl/videoUrl/galleryUrls
 * from them.
 *
 * Conventions: blank slug = auto from the English title (create) or
 * unchanged (edit); blank read time = auto from the English content;
 * a scheduled post needs a publish date (enforced here and by the
 * API); publishing without a date stamps now (API-side).
 */

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function BlogPostEditor({
  post,
  categories,
  tags,
  busy,
  onSave,
  onCancel,
}: {
  post: BlogPost | null;
  categories: BlogCategory[];
  tags: BlogTag[];
  busy: boolean;
  onSave: (input: BlogPostInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [titleEn, setTitleEn] = useState(post?.titleEn ?? '');
  const [titleBn, setTitleBn] = useState(post?.titleBn ?? '');
  const [slug, setSlug] = useState(post?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(false);
  const [excerptEn, setExcerptEn] = useState(post?.excerptEn ?? '');
  const [excerptBn, setExcerptBn] = useState(post?.excerptBn ?? '');
  const [contentEn, setContentEn] = useState(post?.contentEn ?? '');
  const [contentBn, setContentBn] = useState(post?.contentBn ?? '');
  const [author, setAuthor] = useState(post?.author ?? '');
  const [categoryId, setCategoryId] = useState(post?.categoryId ?? '');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    post?.tags.map((tag) => tag.id) ?? [],
  );
  const [media, setMedia] = useState<ContentMediaValue>(
    post ? mediaValueFromRow(post) : emptyMediaValue(),
  );
  const [readTime, setReadTime] = useState(
    post?.readTime ? String(post.readTime) : '',
  );
  const [status, setStatus] = useState(post?.status ?? 'draft');
  const [publishedAt, setPublishedAt] = useState(
    toLocalInput(post?.publishedAt ?? null),
  );
  const [seoTitleEn, setSeoTitleEn] = useState(post?.seoTitleEn ?? '');
  const [seoTitleBn, setSeoTitleBn] = useState(post?.seoTitleBn ?? '');
  const [seoDescEn, setSeoDescEn] = useState(post?.seoDescEn ?? '');
  const [seoDescBn, setSeoDescBn] = useState(post?.seoDescBn ?? '');
  const [canonicalUrl, setCanonicalUrl] = useState(
    post?.canonicalUrl ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  // Only the Tiptap editors use this page's picker now — the media
  // section has its own picker inside ContentMediaFields.
  const [pickerFor, setPickerFor] = useState<'editor' | null>(null);
  // The Tiptap insert callback for the editor that requested an image.
  const editorInsertRef = useRef<((url: string) => void) | null>(null);

  const isNew = post === null;
  const flatCategories = flattenCategories(categories);

  const onTitleEnChange = (value: string) => {
    setTitleEn(value);
    // Auto-suggest the slug from the title until the operator edits
    // it by hand (create only — edits keep the stored slug).
    if (isNew && !slugTouched) setSlug(slugify(value));
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId],
    );
  };

  const onPickAsset = (asset: MediaAsset) => {
    // ABSOLUTE URL: the landing renders these images from another
    // origin, where a relative /api path would not resolve (same rule
    // as branding logo/favicon).
    const url = resolveAbsoluteMediaUrl(asset.contentUrl);
    if (pickerFor === 'editor') {
      editorInsertRef.current?.(url);
      editorInsertRef.current = null;
    }
    setPickerFor(null);
  };

  const handleSave = async () => {
    setError(null);
    if (!titleEn.trim() || !titleBn.trim()) {
      setError('Both the English and Bangla titles are required.');
      return;
    }
    if (!contentEn.trim()) {
      setError('The English content is required.');
      return;
    }
    if (status === 'scheduled' && !publishedAt.trim()) {
      setError('A scheduled post needs a publish date and time.');
      return;
    }
    const input: BlogPostInput = {
      titleEn: titleEn.trim(),
      titleBn: titleBn.trim(),
      excerptEn: excerptEn.trim(),
      excerptBn: excerptBn.trim(),
      contentEn,
      contentBn,
      author: author.trim(),
      categoryId: categoryId || null,
      thumbnailType: media.thumbnailType,
      thumbnailUrl: media.thumbnailUrl.trim() || null,
      thumbnailVideoUrl: media.thumbnailVideoUrl.trim() || null,
      thumbnailAutoplay: media.thumbnailAutoplay,
      videos: media.videos,
      galleryImages: media.galleryImages,
      readTime: readTime.trim() ? Number(readTime) : null,
      status,
      publishedAt: fromLocalInput(publishedAt),
      seoTitleEn: seoTitleEn.trim() || null,
      seoTitleBn: seoTitleBn.trim() || null,
      seoDescEn: seoDescEn.trim() || null,
      seoDescBn: seoDescBn.trim() || null,
      canonicalUrl: canonicalUrl.trim() || null,
      tagIds: selectedTagIds,
    };
    // Blank slug: create → the API auto-generates from the title;
    // edit → omit so the stored slug is unchanged.
    if (slug.trim()) input.slug = slug.trim();
    try {
      await onSave(input);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="blog-editor">
      {error && <ErrorNote message={error} />}

      <div className="inline-form">
        <label>
          Title (English) *
          <input
            type="text"
            value={titleEn}
            onChange={(event) => onTitleEnChange(event.target.value)}
            maxLength={200}
            autoFocus={isNew}
          />
        </label>
        <label>
          Title (Bangla) *
          <input
            type="text"
            value={titleBn}
            onChange={(event) => setTitleBn(event.target.value)}
            maxLength={200}
          />
        </label>
        <label>
          Slug
          <input
            type="text"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugTouched(true);
            }}
            maxLength={120}
            placeholder="auto-from-title"
          />
        </label>
        <label>
          Author
          <input
            type="text"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            maxLength={120}
            placeholder="EcoMate"
          />
        </label>
      </div>
      <p className="muted-note">
        Blank slug: a new post gets one from the English title; editing
        keeps the stored slug. Slugs must be unique among live posts —
        deleting a post frees its slug.
      </p>

      <div className="inline-form">
        <label>
          Excerpt (English)
          <textarea
            value={excerptEn}
            onChange={(event) => setExcerptEn(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="One or two lines for the archive card."
          />
        </label>
        <label>
          Excerpt (Bangla)
          <textarea
            value={excerptBn}
            onChange={(event) => setExcerptBn(event.target.value)}
            maxLength={500}
            rows={3}
          />
        </label>
      </div>

      <h3 className="blog-editor-section">Content (English) *</h3>
      <RichTextEditor
        key={`en-${post?.id ?? 'new'}`}
        value={contentEn}
        onChange={setContentEn}
        placeholder="Write the English article…"
        ariaLabel="English content"
        onImageRequest={(insert) => {
          editorInsertRef.current = insert;
          setPickerFor('editor');
        }}
      />

      <h3 className="blog-editor-section">Content (Bangla)</h3>
      <RichTextEditor
        key={`bn-${post?.id ?? 'new'}`}
        value={contentBn}
        onChange={setContentBn}
        placeholder="বাংলা লেখাটি লিখুন…"
        ariaLabel="Bangla content"
        onImageRequest={(insert) => {
          editorInsertRef.current = insert;
          setPickerFor('editor');
        }}
      />
      <p className="muted-note">
        Empty Bangla content falls back to the English article on the
        public site.
      </p>

      <h3 className="blog-editor-section">Category &amp; tags</h3>
      <div className="inline-form">
        <label>
          Category
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">No category</option>
            {flatCategories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {tags.length > 0 ? (
        <div className="blog-tag-picks">
          {tags.map((tag) => (
            <label key={tag.id} className="blog-tag-pick">
              <input
                type="checkbox"
                checked={selectedTagIds.includes(tag.id)}
                onChange={() => toggleTag(tag.id)}
              />
              {tag.nameEn}
            </label>
          ))}
        </div>
      ) : (
        <p className="muted-note">
          No tags yet — create them from the Tags tab.
        </p>
      )}

      <h3 className="blog-editor-section">Media</h3>
      <ContentMediaFields
        value={media}
        onChange={setMedia}
        folder="blog"
        legacy={{
          featuredImageUrl: post?.featuredImageUrl ?? null,
          videoUrl: post?.videoUrl ?? null,
          galleryUrls: post?.galleryUrls ?? [],
        }}
      />

      <h3 className="blog-editor-section">Publishing</h3>
      <div className="inline-form">
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          Publish date &amp; time
          <input
            type="datetime-local"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
          />
        </label>
        <label>
          Read time (minutes)
          <input
            type="number"
            min={1}
            value={readTime}
            onChange={(event) => setReadTime(event.target.value)}
            placeholder="Auto from content"
          />
        </label>
      </div>
      <p className="muted-note">
        Scheduled posts go live automatically when their publish time
        arrives. Publishing without a date stamps now. Blank read time
        is computed from the English content (~200 words/minute).
      </p>

      <h3 className="blog-editor-section">SEO</h3>
      <div className="inline-form">
        <label>
          SEO title (English)
          <input
            type="text"
            value={seoTitleEn}
            onChange={(event) => setSeoTitleEn(event.target.value)}
            maxLength={200}
            placeholder="Defaults to the post title"
          />
        </label>
        <label>
          SEO title (Bangla)
          <input
            type="text"
            value={seoTitleBn}
            onChange={(event) => setSeoTitleBn(event.target.value)}
            maxLength={200}
          />
        </label>
        <label>
          SEO description (English)
          <textarea
            value={seoDescEn}
            onChange={(event) => setSeoDescEn(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Defaults to the excerpt"
          />
        </label>
        <label>
          SEO description (Bangla)
          <textarea
            value={seoDescBn}
            onChange={(event) => setSeoDescBn(event.target.value)}
            maxLength={500}
            rows={2}
          />
        </label>
        <label>
          Canonical URL
          <input
            type="text"
            value={canonicalUrl}
            onChange={(event) => setCanonicalUrl(event.target.value)}
            maxLength={2048}
            placeholder="https://… (blank = the /blog/:slug URL)"
          />
        </label>
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="button button--accent"
          onClick={handleSave}
          disabled={busy}
        >
          {busy ? 'Saving…' : isNew ? 'Create post' : 'Save changes'}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <MediaPicker
        open={pickerFor !== null}
        onClose={() => {
          setPickerFor(null);
          editorInsertRef.current = null;
        }}
        onSelect={onPickAsset}
        kinds={['image']}
        title="Insert an image"
        folder="blog"
      />
    </div>
  );
}
