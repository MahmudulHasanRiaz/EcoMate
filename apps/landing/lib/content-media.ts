/**
 * Shared content-media helpers for the landing (the read side of the
 * shared media model, landing-cms-media-design.md §2, §7.2).
 *
 * The landing mirror of the API's src/common/media module — kept in
 * sync by test, not by import (the apps do not share code). Every
 * helper here is lenient: public payloads come from a different
 * deploy, so a malformed field degrades to its default and a row
 * whose new media fields are missing entirely still renders from its
 * legacy columns (deploy-order safety, §4.5).
 *
 * Gallery entries are objects ({url, alt?, caption?} / {url, title?,
 * duration?}); readers also accept plain strings defensively.
 */

export type MediaThumbnailType = 'image' | 'video';

export interface MediaImage {
  url: string;
  alt?: string;
  caption?: string;
}

export interface MediaVideo {
  url: string;
  title?: string;
  duration?: string;
}

/** The six shared media fields, as the landing holds them. */
export interface ContentMedia {
  thumbnailType: MediaThumbnailType;
  thumbnailUrl: string | null;
  thumbnailVideoUrl: string | null;
  thumbnailAutoplay: boolean;
  videos: MediaVideo[];
  galleryImages: MediaImage[];
}

export const EMPTY_MEDIA: ContentMedia = {
  thumbnailType: 'image',
  thumbnailUrl: null,
  thumbnailVideoUrl: null,
  thumbnailAutoplay: false,
  videos: [],
  galleryImages: [],
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Plain-string tolerance (§2.2): a string entry reads as `{ url }`. */
export function normalizeMediaImage(entry: unknown): MediaImage | null {
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
  const image: MediaImage = { url };
  const alt = asString(record.alt);
  if (alt) image.alt = alt;
  const caption = asString(record.caption);
  if (caption) image.caption = caption;
  return image;
}

export function normalizeMediaVideo(entry: unknown): MediaVideo | null {
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
  const video: MediaVideo = { url };
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
 * Normalize any media-shaped value (API row, hand-written JSON) into
 * a clean ContentMedia. Never throws; a malformed field degrades to
 * its default. Unknown keys are stripped.
 */
export function normalizeMedia(value: unknown): ContentMedia {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const thumbnailUrl = asString(record.thumbnailUrl);
  const thumbnailVideoUrl = asString(record.thumbnailVideoUrl);
  return {
    thumbnailType: record.thumbnailType === 'video' ? 'video' : 'image',
    thumbnailUrl: thumbnailUrl || null,
    thumbnailVideoUrl: thumbnailVideoUrl || null,
    thumbnailAutoplay: record.thumbnailAutoplay === true,
    videos: normalizeGallery(record.videos, normalizeMediaVideo),
    galleryImages: normalizeGallery(
      record.galleryImages,
      normalizeMediaImage,
    ),
  };
}

/** A row carrying media + legacy media columns (blog / case study / review). */
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
 * Resolve the media for a row, new-first with legacy fallback (§4.3):
 * the new fields win; when a new gallery is empty the legacy column
 * fills it, so a row served by an older API (or not yet backfilled)
 * still renders its media. Never throws.
 */
export function resolveMedia(row: MediaRowLike): ContentMedia {
  const media = normalizeMedia(row);
  if (!media.thumbnailUrl) {
    const legacy = asString(row.featuredImageUrl);
    if (legacy) media.thumbnailUrl = legacy;
  }
  if (media.videos.length === 0) {
    const legacy = asString(row.videoUrl);
    if (legacy) media.videos = [{ url: legacy }];
  }
  if (media.galleryImages.length === 0 && Array.isArray(row.galleryUrls)) {
    media.galleryImages = normalizeGallery(
      row.galleryUrls,
      normalizeMediaImage,
    );
  }
  return media;
}

/**
 * The image the landing shows for a row: the thumbnail image, or —
 * when the thumbnail is a video without a poster — null (callers
 * render a play affordance over the video instead of a broken image).
 * The thumbnail is independent of the galleries (§2): a gallery
 * image is never promoted to the thumbnail.
 */
export function resolveThumbnail(media: ContentMedia): string | null {
  return media.thumbnailUrl;
}

/** Any video at all: a video thumbnail, or a non-empty video gallery. */
export function hasVideo(media: ContentMedia): boolean {
  return (
    (media.thumbnailType === 'video' &&
      media.thumbnailVideoUrl !== null) ||
    media.videos.length > 0
  );
}

export type ReviewFormat = 'text' | 'image' | 'video_short' | 'video_standard';

/**
 * The §3.1 effective-format rule, re-derived on read — the fallback
 * for rows whose API payload did not include `effectiveFormat`
 * (older API; see lib/client-reviews.ts). The API's own value wins
 * whenever present; this derivation only covers rows without one.
 *
 *   hasVideo = videos.length > 0 OR (thumbnailType = 'video' AND
 *              thumbnailVideoUrl present)
 *   hasImage = thumbnailUrl present OR galleryImages.length > 0
 *   stored video format + hasVideo → the stored format
 *   else hasVideo → 'video_standard' (media says video, format stale)
 *   else hasImage → 'image'
 *   else → 'text'
 *
 * The stored format survives only when the media supports it — so a
 * stale stored format (edited media, no re-save) never breaks the
 * landing split.
 */
export function effectiveFormat(
  storedFormat: string,
  media: ContentMedia,
): ReviewFormat {
  const videoPresent = hasVideo(media);
  const imagePresent =
    media.thumbnailUrl !== null || media.galleryImages.length > 0;
  if (
    videoPresent &&
    (storedFormat === 'video_short' || storedFormat === 'video_standard')
  ) {
    return storedFormat;
  }
  if (videoPresent) return 'video_standard';
  if (imagePresent) return 'image';
  return 'text';
}

/**
 * YouTube / Vimeo watch, shorts, or embed URL → privacy-enhanced
 * embed URL. Anything else (direct file, media-library URL, garbage)
 * → null: callers render those as a <video> element or a plain link.
 * (The landing's older youtubeEmbedUrl helpers in lib/contact.ts and
 * lib/blog.ts are YouTube-only and deliberately unchanged.)
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
 * serves (platform-api media.service.ts `mediaViewOf`; the console
 * picker stores the absolute form via `resolveAbsoluteMediaUrl`).
 * Mirrors the API's `isMediaLibraryUrl`
 * (platform-api src/common/media/media.constants.ts): the path
 * pattern is the check — the asset's kind is not verified here, the
 * console picker only offers videos for video fields and the API
 * accepts these URLs as playable on write (§2.3 rule 5).
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
 * plays in a <video> element.
 */
export function isDirectVideoFile(videoUrl: string): boolean {
  if (isMediaLibraryUrl(videoUrl)) return true;
  const path = videoUrl.split(/[?#]/)[0].toLowerCase();
  return path.endsWith('.mp4') || path.endsWith('.webm');
}
