import {
  coerceGalleryEntry,
  type ContentMediaFields,
  type MediaImage,
  type MediaVideo,
} from './media.constants';
import {
  normalizeMediaFields,
  type MediaFieldsInput,
} from './media.dto';

/**
 * Service-layer media helpers (landing-cms-media-design.md §4.3, §6.1):
 * dual-write derivation, legacy-fallback reads, and the legacy/new
 * write precedence shared by the blog + case-studies services. ONE
 * implementation — the services call these, they never re-implement
 * the rules.
 */

// ── dual-write (§4.3) ────────────────────────────────────────────────

/**
 * Derive the deprecated legacy columns from the new media fields, on
 * every write: the thumbnail wins for featuredImageUrl; the first
 * video-gallery entry wins for videoUrl (thumbnail video is the
 * fallback); the image gallery flattens to plain URL strings.
 */
export function deriveLegacyMedia(media: ContentMediaFields): {
  featuredImageUrl: string | null;
  videoUrl: string | null;
  galleryUrls: string[];
} {
  return {
    featuredImageUrl: media.thumbnailUrl ?? null,
    videoUrl: media.videos[0]?.url ?? media.thumbnailVideoUrl ?? null,
    galleryUrls: media.galleryImages.map((entry) => entry.url),
  };
}

// ── reads: new-first, legacy fallback (§4.3, §6.3 rule 6) ────────────

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Lenient gallery read: never throws, never 500s. A non-array is `[]`;
 * plain strings become `{ url }`; entries without a usable url are
 * dropped. NO scheme/kind policy here — a backfilled http:// URL must
 * keep resolving (reads are permissive, writes are strict).
 */
export function normalizeGalleryLenient(
  value: unknown,
  kind: 'image' | 'video',
): Array<MediaImage | MediaVideo> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Array<MediaImage | MediaVideo> = [];
  for (const rawEntry of value) {
    const entry = coerceGalleryEntry(rawEntry, kind);
    if (!entry || seen.has(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
  }
  return out;
}

/** A Prisma row (or wire row) carrying media + legacy media columns. */
export interface MediaRow {
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
 * Resolve a row's media with legacy fallback: new fields win; when a
 * new gallery is empty the legacy column fills it (this is what makes
 * the code safe to deploy before/after the backfill in any order,
 * §4.5). A corrupt row degrades to "no media", never to a failed page.
 * The legacy columns themselves are returned untouched by the caller
 * (wire payloads carry BOTH until the cleanup migration).
 */
export function resolveMediaWithLegacyFallback(
  row: MediaRow,
): ContentMediaFields {
  const videos = normalizeGalleryLenient(row.videos, 'video') as MediaVideo[];
  const galleryImages = normalizeGalleryLenient(
    row.galleryImages,
    'image',
  ) as MediaImage[];
  const legacyVideoUrl = asNullableString(row.videoUrl);
  const legacyGalleryUrls = Array.isArray(row.galleryUrls)
    ? row.galleryUrls
        .filter((url): url is string => typeof url === 'string')
        .map((url) => url.trim())
        .filter(Boolean)
    : [];
  return {
    thumbnailType: row.thumbnailType === 'video' ? 'video' : 'image',
    thumbnailUrl:
      asNullableString(row.thumbnailUrl) ??
      asNullableString(row.featuredImageUrl),
    thumbnailVideoUrl: asNullableString(row.thumbnailVideoUrl),
    thumbnailAutoplay: row.thumbnailAutoplay === true,
    videos:
      videos.length > 0
        ? videos
        : legacyVideoUrl
          ? [{ url: legacyVideoUrl }]
          : [],
    galleryImages:
      galleryImages.length > 0
        ? galleryImages
        : legacyGalleryUrls.map((url) => ({ url })),
  };
}

// ── writes: new-vs-legacy precedence ──────────────────────────────────

/** A create/update DTO's media + legacy media fields (blog/case-study). */
export interface MediaWriteInput extends MediaFieldsInput {
  featuredImageUrl?: string | null;
  videoUrl?: string | null;
  galleryUrls?: unknown;
}

/**
 * Whether a partial-update DTO carries ANY media field (new or
 * legacy). Updates only touch the media columns when this is true —
 * an unrelated title edit must not rewrite (and re-normalize) the
 * stored media JSON.
 */
export function hasMediaInput(input: MediaWriteInput): boolean {
  return (
    input.thumbnailType !== undefined ||
    input.thumbnailUrl !== undefined ||
    input.thumbnailVideoUrl !== undefined ||
    input.thumbnailAutoplay !== undefined ||
    input.videos !== undefined ||
    input.galleryImages !== undefined ||
    input.featuredImageUrl !== undefined ||
    input.videoUrl !== undefined ||
    input.galleryUrls !== undefined
  );
}

/**
 * Resolve a write's media fields from a DTO that may carry new media
 * fields, legacy fields, or both (blog + case-studies services):
 *
 * - New fields present → new wins; the legacy columns are derived from
 *   them by the caller (deriveLegacyMedia). Legacy fields in the same
 *   DTO are ignored (they are outputs now, not inputs).
 * - Only legacy fields present (an old client) → derive the new media
 *   from them, so the two models never drift apart on a legacy write.
 * - Neither → keep the previous row (update) or the defaults (create).
 */
export function resolveMediaWrite(
  input: MediaWriteInput,
  previous?: ContentMediaFields | null,
): ContentMediaFields {
  const hasNew =
    input.thumbnailType !== undefined ||
    input.thumbnailUrl !== undefined ||
    input.thumbnailVideoUrl !== undefined ||
    input.thumbnailAutoplay !== undefined ||
    input.videos !== undefined ||
    input.galleryImages !== undefined;
  if (hasNew) {
    return normalizeMediaFields(input, previous);
  }
  const hasLegacy =
    input.featuredImageUrl !== undefined ||
    input.videoUrl !== undefined ||
    input.galleryUrls !== undefined;
  if (!hasLegacy) {
    return normalizeMediaFields({}, previous);
  }
  const derived: MediaFieldsInput = {};
  if (input.featuredImageUrl !== undefined) {
    derived.thumbnailUrl = asNullableString(input.featuredImageUrl);
  }
  if (input.videoUrl !== undefined) {
    const url = asNullableString(input.videoUrl);
    derived.videos = url ? [{ url }] : [];
  }
  if (input.galleryUrls !== undefined) {
    derived.galleryImages = Array.isArray(input.galleryUrls)
      ? input.galleryUrls
          .filter((url): url is string => typeof url === 'string')
          .map((url) => ({ url: url.trim() }))
          .filter((entry) => entry.url)
      : [];
  }
  return normalizeMediaFields(derived, previous);
}

/** The previous row's six media fields, leniently resolved (for updates). */
export function previousMediaOf(row: MediaRow): ContentMediaFields {
  return resolveMediaWithLegacyFallback(row);
}
