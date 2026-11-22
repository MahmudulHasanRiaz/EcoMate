import { useState } from 'react';
import {
  MEDIA_MAX_GALLERY_IMAGES,
  MEDIA_MAX_VIDEOS,
  addGalleryEntry,
  isDirectVideoFile,
  moveGalleryEntry,
  removeGalleryEntry,
  resolveThumbnail,
  updateGalleryEntry,
  videoEmbedUrl,
  type ContentMediaValue,
} from '../lib/content-media';
import { resolveAbsoluteMediaUrl, type MediaAsset } from '../lib/media';
import { MediaPicker } from './media-picker';

/**
 * The ONLY media editor (landing-cms-media-design.md §7.1) — used by
 * the blog post editor, the case-study form, and the client-review
 * form. Controlled: `value` is the six shared media fields, `onChange`
 * receives the next value. The media library picker is single-pick,
 * one at a time (the established pattern — no multi-pick extension).
 *
 * Sections: Thumbnail (Image/Video toggle + pick from library + set
 * from gallery) → Image gallery (n/20) → Video gallery (n/10) →
 * Preview (what the landing will show). The API enforces the URL
 * rules on save; this component enforces caps + shape locally.
 */

type PickerTarget =
  | 'thumbnail-image'
  | 'thumbnail-video'
  | 'gallery-image'
  | 'gallery-video';

export interface LegacyMediaValues {
  featuredImageUrl?: string | null;
  videoUrl?: string | null;
  galleryUrls?: string[];
}

export function ContentMediaFields({
  value,
  onChange,
  disabled = false,
  folder = 'content',
  legacy,
}: {
  value: ContentMediaValue;
  onChange: (next: ContentMediaValue) => void;
  disabled?: boolean;
  folder?: string;
  legacy?: LegacyMediaValues;
}) {
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [galleryNote, setGalleryNote] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  function patch(next: Partial<ContentMediaValue>) {
    onChange({ ...value, ...next });
  }

  function onPickAsset(asset: MediaAsset) {
    // ABSOLUTE URL: the landing renders these from another origin,
    // where a relative /api path would not resolve (same rule as the
    // blog editor + branding logo/favicon).
    const url = resolveAbsoluteMediaUrl(asset.contentUrl);
    if (pickerFor === 'thumbnail-image') {
      patch({ thumbnailUrl: url });
    } else if (pickerFor === 'thumbnail-video') {
      patch({ thumbnailVideoUrl: url });
    } else if (pickerFor === 'gallery-image') {
      const next = addGalleryEntry(
        value.galleryImages,
        { url },
        MEDIA_MAX_GALLERY_IMAGES,
      );
      if (next === null) {
        setGalleryNote(
          `The image gallery holds at most ${MEDIA_MAX_GALLERY_IMAGES} images.`,
        );
      } else {
        patch({ galleryImages: next });
      }
    } else if (pickerFor === 'gallery-video') {
      const next = addGalleryEntry(
        value.videos,
        { url },
        MEDIA_MAX_VIDEOS,
      );
      if (next === null) {
        setGalleryNote(
          `The video gallery holds at most ${MEDIA_MAX_VIDEOS} videos.`,
        );
      } else {
        patch({ videos: next });
      }
    }
    setPickerFor(null);
  }

  function addImageByUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    const next = addGalleryEntry(
      value.galleryImages,
      { url },
      MEDIA_MAX_GALLERY_IMAGES,
    );
    if (next === null) {
      setGalleryNote(
        `The image gallery holds at most ${MEDIA_MAX_GALLERY_IMAGES} images.`,
      );
      return;
    }
    setGalleryNote(null);
    setImageUrlInput('');
    patch({ galleryImages: next });
  }

  function addVideoByUrl() {
    const url = videoUrlInput.trim();
    if (!url) return;
    const next = addGalleryEntry(value.videos, { url }, MEDIA_MAX_VIDEOS);
    if (next === null) {
      setGalleryNote(
        `The video gallery holds at most ${MEDIA_MAX_VIDEOS} videos.`,
      );
      return;
    }
    setGalleryNote(null);
    setVideoUrlInput('');
    patch({ videos: next });
  }

  const thumbnail = resolveThumbnail(value);
  const pickerKinds: Array<'image' | 'video'> =
    pickerFor === 'thumbnail-video' || pickerFor === 'gallery-video'
      ? ['video']
      : ['image'];
  const pickerTitle =
    pickerFor === 'thumbnail-image'
      ? 'Choose a thumbnail image'
      : pickerFor === 'thumbnail-video'
        ? 'Choose a thumbnail video'
        : pickerFor === 'gallery-image'
          ? 'Add a gallery image'
          : 'Add a gallery video';

  const previewVideoUrl =
    value.thumbnailType === 'video' ? value.thumbnailVideoUrl : '';
  const previewEmbed = previewVideoUrl
    ? videoEmbedUrl(previewVideoUrl)
    : null;
  const previewIsFile =
    previewVideoUrl !== '' && isDirectVideoFile(previewVideoUrl);

  return (
    <div className="media-fields">
      <h3 className="blog-editor-section">Thumbnail</h3>
      <div
        className="segmented"
        role="group"
        aria-label="Thumbnail type"
      >
        <button
          type="button"
          className={
            value.thumbnailType === 'image'
              ? 'button button--accent-outline button--sm'
              : 'button button--sm'
          }
          aria-pressed={value.thumbnailType === 'image'}
          disabled={disabled}
          onClick={() => patch({ thumbnailType: 'image' })}
        >
          Image
        </button>
        <button
          type="button"
          className={
            value.thumbnailType === 'video'
              ? 'button button--accent-outline button--sm'
              : 'button button--sm'
          }
          aria-pressed={value.thumbnailType === 'video'}
          disabled={disabled}
          onClick={() => patch({ thumbnailType: 'video' })}
        >
          Video
        </button>
      </div>
      <p className="muted-note">
        {value.thumbnailType === 'video'
          ? 'A video thumbnail needs a video URL and a poster image (shown before play). Switching back to Image keeps the video in the gallery below.'
          : 'The card image for the archive, the detail hero, and the OG image. Empty is fine for a text-only item.'}
      </p>

      <div className="inline-form">
        <label>
          {value.thumbnailType === 'video'
            ? 'Poster image URL (shown before play)'
            : 'Thumbnail image URL'}
          <input
            type="text"
            value={value.thumbnailUrl}
            onChange={(event) => patch({ thumbnailUrl: event.target.value })}
            disabled={disabled}
            maxLength={2048}
            placeholder="https://… or pick from the library"
          />
        </label>
        {value.thumbnailType === 'video' ? (
          <label>
            Thumbnail video URL
            <input
              type="text"
              value={value.thumbnailVideoUrl}
              onChange={(event) =>
                patch({ thumbnailVideoUrl: event.target.value })
              }
              disabled={disabled}
              maxLength={2048}
              placeholder="YouTube / Vimeo link, or pick an uploaded video"
            />
          </label>
        ) : null}
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button"
          disabled={disabled}
          onClick={() => setPickerFor('thumbnail-image')}
        >
          Pick thumbnail from library
        </button>
        {value.thumbnailType === 'video' ? (
          <button
            type="button"
            className="button"
            disabled={disabled}
            onClick={() => setPickerFor('thumbnail-video')}
          >
            Pick video from library
          </button>
        ) : null}
        {value.thumbnailUrl ? (
          <button
            type="button"
            className="button button--ghost"
            disabled={disabled}
            onClick={() => patch({ thumbnailUrl: '' })}
          >
            Remove thumbnail
          </button>
        ) : null}
      </div>
      {value.galleryImages.length > 0 ? (
        <label className="field">
          Set thumbnail from gallery
          <select
            value=""
            disabled={disabled}
            onChange={(event) => {
              if (event.target.value) {
                patch({ thumbnailUrl: event.target.value });
              }
            }}
          >
            <option value="">Choose a gallery image…</option>
            {value.galleryImages.map((image, index) => (
              <option key={`${image.url}-${index}`} value={image.url}>
                {image.alt || image.caption || `Image ${index + 1}`} —{' '}
                {image.url.length > 60
                  ? `…${image.url.slice(-57)}`
                  : image.url}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {value.thumbnailType === 'video' ? (
        <div className="domain-flags">
          <label>
            <input
              type="checkbox"
              checked={value.thumbnailAutoplay}
              onChange={(event) =>
                patch({ thumbnailAutoplay: event.target.checked })
              }
              disabled={disabled}
            />
            Play muted preview when visible
          </label>
        </div>
      ) : null}

      <h3 className="blog-editor-section">
        Image gallery ({value.galleryImages.length} /{' '}
        {MEDIA_MAX_GALLERY_IMAGES})
      </h3>
      <p className="muted-note">
        Shown beside the thumbnail on the detail page — the thumbnail is
        not a member of this gallery.
      </p>
      {value.galleryImages.length > 0 ? (
        <div className="media-gallery-list">
          {value.galleryImages.map((image, index) => (
            <div className="media-gallery-item" key={`${image.url}-${index}`}>
              {image.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="media-gallery-thumb"
                  src={image.url}
                  alt={image.alt || ''}
                />
              ) : null}
              <div className="media-gallery-fields">
                <span className="media-gallery-url" title={image.url}>
                  {image.url}
                </span>
                <input
                  type="text"
                  value={image.alt ?? ''}
                  onChange={(event) =>
                    patch({
                      galleryImages: updateGalleryEntry(
                        value.galleryImages,
                        index,
                        { alt: event.target.value },
                      ),
                    })
                  }
                  disabled={disabled}
                  maxLength={200}
                  placeholder="Alt text (accessibility + SEO)"
                  aria-label={`Alt text for image ${index + 1}`}
                />
                <input
                  type="text"
                  value={image.caption ?? ''}
                  onChange={(event) =>
                    patch({
                      galleryImages: updateGalleryEntry(
                        value.galleryImages,
                        index,
                        { caption: event.target.value },
                      ),
                    })
                  }
                  disabled={disabled}
                  maxLength={500}
                  placeholder="Caption (shown in the lightbox)"
                  aria-label={`Caption for image ${index + 1}`}
                />
              </div>
              <div className="media-gallery-actions">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={disabled || index === 0}
                  onClick={() =>
                    patch({
                      galleryImages: moveGalleryEntry(
                        value.galleryImages,
                        index,
                        -1,
                      ),
                    })
                  }
                  aria-label={`Move image ${index + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={
                    disabled || index === value.galleryImages.length - 1
                  }
                  onClick={() =>
                    patch({
                      galleryImages: moveGalleryEntry(
                        value.galleryImages,
                        index,
                        1,
                      ),
                    })
                  }
                  aria-label={`Move image ${index + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={disabled}
                  onClick={() =>
                    patch({
                      galleryImages: removeGalleryEntry(
                        value.galleryImages,
                        index,
                      ),
                    })
                  }
                  aria-label={`Remove image ${index + 1}`}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="inline-form">
        <label>
          Add image by URL
          <input
            type="text"
            value={imageUrlInput}
            onChange={(event) => setImageUrlInput(event.target.value)}
            disabled={disabled}
            maxLength={2048}
            placeholder="https://…"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addImageByUrl();
              }
            }}
          />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button"
          disabled={disabled || value.galleryImages.length >= MEDIA_MAX_GALLERY_IMAGES}
          onClick={() => setPickerFor('gallery-image')}
        >
          Add from library
        </button>
        <button
          type="button"
          className="button"
          disabled={disabled || !imageUrlInput.trim()}
          onClick={addImageByUrl}
        >
          Add by URL
        </button>
      </div>

      <h3 className="blog-editor-section">
        Video gallery ({value.videos.length} / {MEDIA_MAX_VIDEOS})
      </h3>
      <p className="muted-note">
        YouTube / Vimeo links embed on the detail page; uploaded .mp4 /
        .webm files play inline.
      </p>
      {value.videos.length > 0 ? (
        <div className="media-gallery-list">
          {value.videos.map((video, index) => (
            <div className="media-gallery-item" key={`${video.url}-${index}`}>
              <div className="media-gallery-fields">
                <span className="media-gallery-url" title={video.url}>
                  {video.url}
                </span>
                <input
                  type="text"
                  value={video.title ?? ''}
                  onChange={(event) =>
                    patch({
                      videos: updateGalleryEntry(value.videos, index, {
                        title: event.target.value,
                      }),
                    })
                  }
                  disabled={disabled}
                  maxLength={200}
                  placeholder="Title"
                  aria-label={`Title for video ${index + 1}`}
                />
                <input
                  type="text"
                  value={video.duration ?? ''}
                  onChange={(event) =>
                    patch({
                      videos: updateGalleryEntry(value.videos, index, {
                        duration: event.target.value,
                      }),
                    })
                  }
                  disabled={disabled}
                  maxLength={40}
                  placeholder="Duration (M:SS, e.g. 2:41)"
                  aria-label={`Duration for video ${index + 1}`}
                />
              </div>
              <div className="media-gallery-actions">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={disabled || index === 0}
                  onClick={() =>
                    patch({
                      videos: moveGalleryEntry(value.videos, index, -1),
                    })
                  }
                  aria-label={`Move video ${index + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={disabled || index === value.videos.length - 1}
                  onClick={() =>
                    patch({
                      videos: moveGalleryEntry(value.videos, index, 1),
                    })
                  }
                  aria-label={`Move video ${index + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={disabled}
                  onClick={() =>
                    patch({
                      videos: removeGalleryEntry(value.videos, index),
                    })
                  }
                  aria-label={`Remove video ${index + 1}`}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="inline-form">
        <label>
          Add video by URL
          <input
            type="text"
            value={videoUrlInput}
            onChange={(event) => setVideoUrlInput(event.target.value)}
            disabled={disabled}
            maxLength={2048}
            placeholder="YouTube / Vimeo link, or an .mp4 / .webm URL"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addVideoByUrl();
              }
            }}
          />
        </label>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button"
          disabled={disabled || value.videos.length >= MEDIA_MAX_VIDEOS}
          onClick={() => setPickerFor('gallery-video')}
        >
          Add from library
        </button>
        <button
          type="button"
          className="button"
          disabled={disabled || !videoUrlInput.trim()}
          onClick={addVideoByUrl}
        >
          Add by URL
        </button>
      </div>
      {galleryNote ? <p className="muted-note">{galleryNote}</p> : null}

      <h3 className="blog-editor-section">Preview</h3>
      {thumbnail || previewVideoUrl ? (
        <div className="media-preview">
          {previewPlaying && previewEmbed ? (
            <iframe
              className="media-preview-frame"
              src={previewEmbed}
              title="Thumbnail video preview"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : previewPlaying && previewIsFile ? (
            <video
              className="media-preview-frame"
              src={previewVideoUrl}
              controls
              autoPlay
            />
          ) : (
            <>
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="media-preview-image"
                  src={thumbnail}
                  alt="Thumbnail preview"
                />
              ) : (
                <p className="muted-note">
                  No poster image — a video thumbnail without a poster
                  shows a black box on slow connections.
                </p>
              )}
              {previewVideoUrl ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => setPreviewPlaying(true)}
                >
                  Play thumbnail video
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <p className="muted-note">
          No thumbnail yet — the landing shows no image for this item.
        </p>
      )}

      {legacy &&
      (legacy.featuredImageUrl || legacy.videoUrl || (legacy.galleryUrls ?? []).length > 0) ? (
        <details className="media-legacy">
          <summary>Legacy values (read-only, from before the media model)</summary>
          <dl>
            {legacy.featuredImageUrl ? (
              <>
                <dt>Featured image</dt>
                <dd>{legacy.featuredImageUrl}</dd>
              </>
            ) : null}
            {legacy.videoUrl ? (
              <>
                <dt>Video</dt>
                <dd>{legacy.videoUrl}</dd>
              </>
            ) : null}
            {(legacy.galleryUrls ?? []).length > 0 ? (
              <>
                <dt>Gallery URLs</dt>
                <dd>{(legacy.galleryUrls ?? []).join(', ')}</dd>
              </>
            ) : null}
          </dl>
          <p className="muted-note">
            These columns are kept during the transition and updated
            automatically on every save.
          </p>
        </details>
      ) : null}

      <MediaPicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onSelect={onPickAsset}
        kinds={pickerKinds}
        title={pickerTitle}
        folder={folder}
      />
    </div>
  );
}
