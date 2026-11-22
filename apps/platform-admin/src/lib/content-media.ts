/**
 * Shared content-media helpers (landing-cms-media-design.md §2, §7.1).
 *
 * The console mirror of the API's src/common/media module — kept in
 * sync by test, not by import (the apps do not share code). The three
 * content editors (blog, case studies, client reviews) all build their
 * media state from these helpers + the ContentMediaFields component;
 * no editor hand-rolls its own media logic.
 *
 * Pure list helpers (add/remove/move) live here so the gallery
 * behaviour is unit-testable without component-test infra (the console
 * vitest setup is node-only, .test.ts).
 */

export const MEDIA_MAX_GALLERY_IMAGES = 20;
export const MEDIA_MAX_VIDEOS = 10;

export type MediaThumbnailType = 'image' | 'video';

export interface MediaImageEntry {
  url: string;
  alt?: string;
  caption?: string;
}

export interface MediaVideoEntry {
  url: string;
  title?: string;
  duration?: string;
}

/** The six shared media fields, as the editors hold them. */
export interface ContentMediaValue {
  thumbnailType: MediaThumbnailType;
  thumbnailUrl: string;
  thumbnailVideoUrl: string;
  thumbnailAutoplay: boolean;
  videos: MediaVideoEntry[];
  galleryImages: MediaImageEntry[];
}

/** The six shared media fields, as the API returns them (wire shape). */
export interface ContentMediaWire {
  thumbnailType: MediaThumbnailType;
  thumbnailUrl: string | null;
  thumbnailVideoUrl: string | null;
  thumbnailAutoplay: boolean;
  videos: MediaVideoEntry[];
  galleryImages: MediaImageEntry[];
}

/** The six shared media fields, as the console sends them (all optional). */
export interface ContentMediaInput {
  thumbnailType?: MediaThumbnailType;
  thumbnailUrl?: string | null;
  thumbnailVideoUrl?: string | null;
  thumbnailAutoplay?: boolean;
  videos?: MediaVideoEntry[];
  galleryImages?: MediaImageEntry[];
}

export function emptyMediaValue(): ContentMediaValue {
  return {
    thumbnailType: 'image',
    thumbnailUrl: '',
    thumbnailVideoUrl: '',
    thumbnailAutoplay: false,
    videos: [],
    galleryImages: [],
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Plain-string tolerance (§2.2): a string entry reads as `{ url }`. */
export function normalizeMediaImage(entry: unknown): MediaImageEntry | null {
  if (typeof entry === 'string') {
    const url = entry.trim();
    return url ? { url } : null;
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const url = asString(record.url);
  if (!url) return null;
  const image: MediaImageEntry = { url };
  const alt = asString(record.alt);
  if (alt) image.alt = alt;
  const caption = asString(record.caption);
  if (caption) image.caption = caption;
  return image;
}

export function normalizeMediaVideo(entry: unknown): MediaVideoEntry | null {
  if (typeof entry === 'string') {
    const url = entry.trim();
    return url ? { url } : null;
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const url = asString(record.url);
  if (!url) return null;
  const video: MediaVideoEntry = { url };
  const title = asString(record.title);
  if (title) video.title = title;
  const duration = asString(record.duration);
  if (duration) video.duration = duration;
  return video;
}

function normalizeGallery<T extends { url: string }>(
  value: unknown,
  normalize: (entry: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const rawEntry of value) {
    const entry = normalize(rawEntry);
    if (!entry) continue;
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
  }
  return out;
}

/**
 * Normalize any media-shaped value (API row, form state, hand-written
 * JSON) into a clean ContentMediaValue. Never throws; a malformed
 * field degrades to its default. Unknown keys are stripped.
 */
export function normalizeMediaValue(value: unknown): ContentMediaValue {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    thumbnailType: record.thumbnailType === 'video' ? 'video' : 'image',
    thumbnailUrl: asString(record.thumbnailUrl),
    thumbnailVideoUrl: asString(record.thumbnailVideoUrl),
    thumbnailAutoplay: record.thumbnailAutoplay === true,
    videos: normalizeGallery(record.videos, normalizeMediaVideo),
    galleryImages: normalizeGallery(
      record.galleryImages,
      normalizeMediaImage,
    ),
  };
}

/** A row carrying media + legacy media columns (blog / case study). */
export interface MediaRowLike {
  thumbnailType?: unknown;
  thumbnailUrl?: unknown;
  thumbnailVideoUrl?: unknown;
  thumbnailAutoplay?: unknown;
  videos?: unknown;
  galleryImages?: unknown;
  featuredImageUrl?: unknown;
  videoUrl?: unknown;
  galleryUrls?: unknown;
}

/**
 * Build an editor value from an API row, with legacy fallback (§4.3):
 * new fields win; when a new gallery is empty the legacy column fills
 * it (pre-backfill rows still edit correctly).
 */
export function mediaValueFromRow(row: MediaRowLike): ContentMediaValue {
  const value = normalizeMediaValue(row);
  if (!value.thumbnailUrl) {
    value.thumbnailUrl = asString(row.featuredImageUrl);
  }
  if (value.videos.length === 0) {
    const legacyVideo = asString(row.videoUrl);
    if (legacyVideo) value.videos = [{ url: legacyVideo }];
  }
  if (value.galleryImages.length === 0 && Array.isArray(row.galleryUrls)) {
    value.galleryImages = row.galleryUrls
      .filter((url): url is string => typeof url === 'string')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ url }));
  }
  return value;
}

/** What the landing will show as the card image (null = no image). */
export function resolveThumbnail(value: ContentMediaValue): string | null {
  return value.thumbnailUrl ? value.thumbnailUrl : null;
}

export function hasVideo(value: ContentMediaValue): boolean {
  return (
    value.videos.length > 0 ||
    (value.thumbnailType === 'video' && value.thumbnailVideoUrl !== '')
  );
}

export type ReviewFormat =
  | 'video_short'
  | 'video_standard'
  | 'image'
  | 'text';

/**
 * The effective display format (§3.1) — mirror of the API's
 * deriveEffectiveReviewFormat. The console editor defaults a review's
 * format from its media through this function.
 */
export function effectiveReviewFormat(
  format: string,
  media: ContentMediaValue,
): ReviewFormat {
  const hasImage =
    media.thumbnailUrl !== '' || media.galleryImages.length > 0;
  if (
    (format === 'video_short' || format === 'video_standard') &&
    hasVideo(media)
  ) {
    return format;
  }
  if (hasVideo(media)) return 'video_standard';
  if (hasImage) return 'image';
  return 'text';
}

// ── video playback helpers (console preview) ────────────────────────

/**
 * YouTube / Vimeo watch, shorts, or embed URL → embed URL. Anything
 * else (direct file, media-library URL, garbage) → null: the preview
 * renders those as a <video> element or a plain link instead.
 */
export function videoEmbedUrl(videoUrl: string): string | null {
  if (!videoUrl) return null;
  let url: URL;
  try {
    url = new URL(videoUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    let id: string | null = null;
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/')) {
      id = url.pathname.split('/')[2] ?? null;
    } else if (url.pathname.startsWith('/embed/')) {
      id = url.pathname.split('/')[2] ?? null;
    }
    if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1] ?? null;
    if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  if (host === 'youtube-nocookie.com' && url.pathname.startsWith('/embed/')) {
    const id = url.pathname.split('/')[2] ?? null;
    if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    return `https://www.youtube-nocookie.com/embed/${id}`;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (!id || !/^\d+$/.test(id)) return null;
    return `https://player.vimeo.com/video/${id}`;
  }
  return null;
}

/**
 * A media-library URL (`/api/public/media/:id`, relative or
 * absolute) — the extension-less content URL the media library
 * serves (platform-api media.service.ts `mediaViewOf`; the picker
 * stores the absolute form via `resolveAbsoluteMediaUrl`).
 * Mirrors the API's `isMediaLibraryUrl`
 * (platform-api src/common/media/media.constants.ts): the path
 * pattern is the check — the asset's kind is not verified here, the
 * picker only offers videos for video fields and the API accepts
 * these URLs as playable on write (§2.3 rule 5).
 */
export function isMediaLibraryUrl(videoUrl: string): boolean {
  try {
    const url = new URL(videoUrl, 'https://placeholder.local');
    return url.pathname.includes('/public/media/');
  } catch {
    return false;
  }
}

/**
 * A direct video file (.mp4/.webm) — or a media-library video URL —
 * plays in a <video> element (console preview).
 */
export function isDirectVideoFile(videoUrl: string): boolean {
  if (isMediaLibraryUrl(videoUrl)) return true;
  const path = videoUrl.split(/[?#]/)[0].toLowerCase();
  return path.endsWith('.mp4') || path.endsWith('.webm');
}

// ── pure gallery list helpers (used by ContentMediaFields) ───────────

/** Append an entry; returns null when the gallery is at its cap. */
export function addGalleryEntry<T extends { url: string }>(
  entries: T[],
  entry: T,
  cap: number,
): T[] | null {
  if (entries.length >= cap) return null;
  if (entries.some((existing) => existing.url === entry.url)) {
    return entries;
  }
  return [...entries, entry];
}

export function removeGalleryEntry<T>(
  entries: T[],
  index: number,
): T[] {
  return entries.filter((_, i) => i !== index);
}

/** Move an entry one step up (-1) or down (+1); edges stay put. */
export function moveGalleryEntry<T>(
  entries: T[],
  index: number,
  direction: -1 | 1,
): T[] {
  const target = index + direction;
  if (target < 0 || target >= entries.length) return entries;
  const next = [...entries];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function updateGalleryEntry<T>(
  entries: T[],
  index: number,
  patch: Partial<T>,
): T[] {
  return entries.map((entry, i) =>
    i === index ? { ...entry, ...patch } : entry,
  );
}
