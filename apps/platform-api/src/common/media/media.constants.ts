/**
 * Shared media model constants (landing-cms-media-design.md §2, §6.1).
 *
 * The single home for the media rules shared by blog, case-studies and
 * client-reviews — the three modules must not drift. Pure helpers live
 * here too: the URL predicates the validators and the normalizer share.
 *
 * Two enforcement layers, by design (§2.3: "the service is the
 * enforcer, DTOs the shape"):
 * - DTO decorators (media.validators.ts) check SHAPE only — string,
 *   length, array caps, entry shape, duration pattern.
 * - normalizeMediaFields (media.dto.ts) enforces URL POLICY — the
 *   https-or-relative rule and the playable-video rule — because only
 *   the service knows the previous row, and an unchanged legacy URL is
 *   grandfathered (an http:// URL the backfill stored keeps working;
 *   only NEW http:// entries are rejected).
 */

/** Max image-gallery entries (same as the old BLOG_MAX_GALLERY_URLS). */
export const MEDIA_MAX_GALLERY_IMAGES = 20;

/** Max video-gallery entries. */
export const MEDIA_MAX_VIDEOS = 10;

/** Max URL length (same as every existing URL field in the CMS). */
export const MEDIA_MAX_URL_LENGTH = 2048;

/** Thumbnail kinds — API-validated Strings, NOT a Prisma enum. */
export const MEDIA_THUMBNAIL_TYPES = ['image', 'video'] as const;

export type MediaThumbnailType = (typeof MEDIA_THUMBNAIL_TYPES)[number];

/** Gallery entry field caps (§2.2). */
export const MEDIA_MAX_ALT_LENGTH = 200;
export const MEDIA_MAX_CAPTION_LENGTH = 500;
export const MEDIA_MAX_VIDEO_TITLE_LENGTH = 200;
export const MEDIA_MAX_DURATION_LENGTH = 40;

/** Display duration, "M:SS" (minutes may be up to 3 digits). */
export const MEDIA_DURATION_PATTERN = /^\d{1,3}:\d{2}$/;

/** Hosts whose URLs embed as a video player (YouTube + Vimeo). */
export const MEDIA_VIDEO_HOSTS = [
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'vimeo.com',
  'player.vimeo.com',
] as const;

/** Direct video-file extensions (uploads via the media library). */
export const MEDIA_VIDEO_EXTENSIONS = ['.mp4', '.webm'] as const;

/** One image-gallery entry — objects, never plain strings, on write. */
export interface MediaImage {
  url: string;
  alt?: string;
  caption?: string;
}

/** One video-gallery entry. `duration` is "M:SS", display only. */
export interface MediaVideo {
  url: string;
  title?: string;
  duration?: string;
}

/** The six shared media fields, normalized (write + read shape). */
export interface ContentMediaFields {
  thumbnailType: string;
  thumbnailUrl: string | null;
  thumbnailVideoUrl: string | null;
  thumbnailAutoplay: boolean;
  videos: MediaVideo[];
  galleryImages: MediaImage[];
}

/** Defaults for a row with no media at all. */
export const EMPTY_MEDIA_FIELDS: ContentMediaFields = {
  thumbnailType: 'image',
  thumbnailUrl: null,
  thumbnailVideoUrl: null,
  thumbnailAutoplay: false,
  videos: [],
  galleryImages: [],
};

/**
 * The media-URL rule (§2.2): absolute `https://…` OR a relative path
 * (`/api/public/media/:id`, `/media/…`). `http://` is rejected for new
 * entries; protocol-relative `//host/…` is rejected (ambiguous host);
 * `data:` / `javascript:` / bare words are rejected.
 */
export function isMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url || url.length > MEDIA_MAX_URL_LENGTH) return false;
  if (/\s/.test(url)) return false;
  if (url.startsWith('https://')) return url.length > 'https://'.length;
  if (url.startsWith('/') && !url.startsWith('//')) return url.length > 1;
  return false;
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** YouTube / Vimeo watch, shorts, or embed URL. */
export function isYouTubeOrVimeoUrl(value: string): boolean {
  const host = hostnameOf(value);
  if (!host) return false;
  return (MEDIA_VIDEO_HOSTS as readonly string[]).includes(host);
}

/** Direct video file — `.mp4` / `.webm` path (query/fragment ignored). */
export function isDirectVideoFileUrl(value: string): boolean {
  const path = value.split(/[?#]/)[0].toLowerCase();
  return (MEDIA_VIDEO_EXTENSIONS as readonly string[]).some((ext) =>
    path.endsWith(ext),
  );
}

/**
 * A media-library URL (`/public/media/:id`, relative or absolute).
 * The asset's kind is not checked here — the console picker only
 * offers videos for video fields, so the path pattern is the check.
 */
export function isMediaLibraryUrl(value: string): boolean {
  try {
    const url = new URL(value, 'https://placeholder.local');
    return url.pathname.includes('/public/media/');
  } catch {
    return false;
  }
}

/**
 * A playable video reference (§2.3 rule 5): YouTube/Vimeo, a direct
 * video file, or a media-library URL. Anything else is a 400 on write.
 */
export function isPlayableVideoUrl(value: string): boolean {
  return (
    isYouTubeOrVimeoUrl(value) ||
    isDirectVideoFileUrl(value) ||
    isMediaLibraryUrl(value)
  );
}

/**
 * Lenient shape coercion for ONE gallery entry (used by both the
 * strict write normalizer and the lenient read resolver — one
 * implementation, so the two can never disagree about shape).
 * A plain string reads as `{ url }` (Portfolio-V3 compatibility +
 * tolerance for hand-written rows, §2.2). Unknown keys are stripped
 * (explicit mapping, never spread — no mass assignment). Returns null
 * for anything that is not a string or an object with a non-empty
 * string `url` — the caller decides whether null is a drop (reads)
 * or a 400 (writes).
 */
export function coerceGalleryEntry(
  entry: unknown,
  kind: 'image' | 'video',
): MediaImage | MediaVideo | null {
  if (typeof entry === 'string') {
    const url = entry.trim();
    return url ? { url } : null;
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.url !== 'string' || !record.url.trim()) return null;
  const url = record.url.trim();
  if (kind === 'image') {
    const image: MediaImage = { url };
    if (typeof record.alt === 'string' && record.alt.trim()) {
      image.alt = record.alt.trim();
    }
    if (typeof record.caption === 'string' && record.caption.trim()) {
      image.caption = record.caption.trim();
    }
    return image;
  }
  const video: MediaVideo = { url };
  if (typeof record.title === 'string' && record.title.trim()) {
    video.title = record.title.trim();
  }
  if (typeof record.duration === 'string' && record.duration.trim()) {
    video.duration = record.duration.trim();
  }
  return video;
}
