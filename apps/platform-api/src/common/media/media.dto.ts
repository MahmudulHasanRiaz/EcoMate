import { BadRequestException } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  MEDIA_MAX_GALLERY_IMAGES,
  MEDIA_MAX_URL_LENGTH,
  MEDIA_MAX_VIDEOS,
  MEDIA_THUMBNAIL_TYPES,
  coerceGalleryEntry,
  isMediaUrl,
  isPlayableVideoUrl,
  type ContentMediaFields,
  type MediaImage,
  type MediaVideo,
} from './media.constants';
import {
  IsMediaImageArray,
  IsMediaUrl,
  IsMediaVideoArray,
} from './media.validators';

/**
 * Shared media DTO fragment + the write normalizer
 * (landing-cms-media-design.md §2.3, §6.1).
 *
 * The three content DTOs (blog / case-studies / client-reviews) extend
 * `MediaFieldsDto`; the three services normalize through the one pure
 * function `normalizeMediaFields` — unit-tested once here, not three
 * times. DTO decorators check shape; this function enforces policy
 * (URL scheme, playable-video kind, cross-field rules) and throws a
 * BadRequestException with a field-named message.
 */

export class MediaImageDto {
  @IsString()
  @MaxLength(MEDIA_MAX_URL_LENGTH)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

export class MediaVideoDto {
  @IsString()
  @MaxLength(MEDIA_MAX_URL_LENGTH)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  duration?: string;
}

/**
 * The six shared media fields as a reusable DTO fragment. All optional:
 * creates default, updates leave untouched. `thumbnailUrl: null` (and
 * `thumbnailVideoUrl: null`) clear the value; `videos: []` /
 * `galleryImages: []` clear the gallery.
 */
export class MediaFieldsDto {
  @IsOptional()
  @IsIn([...MEDIA_THUMBNAIL_TYPES])
  thumbnailType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MEDIA_MAX_URL_LENGTH)
  @IsMediaUrl()
  thumbnailUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MEDIA_MAX_URL_LENGTH)
  @IsMediaUrl()
  thumbnailVideoUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  thumbnailAutoplay?: boolean;

  @IsOptional()
  @IsArray()
  @IsMediaVideoArray()
  videos?: Array<MediaVideoDto | string>;

  @IsOptional()
  @IsArray()
  @IsMediaImageArray()
  galleryImages?: Array<MediaImageDto | string>;
}

/** Loose write input — what a DTO (or a direct service call) carries. */
export interface MediaFieldsInput {
  thumbnailType?: string | null;
  thumbnailUrl?: string | null;
  thumbnailVideoUrl?: string | null;
  thumbnailAutoplay?: boolean | null;
  videos?: unknown;
  galleryImages?: unknown;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Strict gallery normalization for writes (§2.2 + §2.3): plain strings
 * become `{ url }` objects; unknown keys are stripped; duplicates are
 * dropped (first occurrence wins, order preserved); over-cap is a 400.
 *
 * URL policy with GRANDFATHERING: a URL that fails the https rule (or,
 * for videos, the playable-video rule) is still accepted when the
 * exact URL already sits in the previous row's same gallery — the
 * backfill never rewrote legacy URLs, and an operator must be able to
 * save any other edit to a pre-backfill row without first deleting its
 * http:// video. Only NEW or CHANGED URLs face the strict rule.
 */
function normalizeGalleryStrict(
  value: unknown,
  kind: 'image' | 'video',
  field: 'videos' | 'galleryImages',
  grandfatheredUrls: ReadonlySet<string>,
): Array<MediaImage | MediaVideo> {
  const cap =
    kind === 'video' ? MEDIA_MAX_VIDEOS : MEDIA_MAX_GALLERY_IMAGES;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an array`);
  }
  const seen = new Set<string>();
  const out: Array<MediaImage | MediaVideo> = [];
  for (const rawEntry of value) {
    const entry = coerceGalleryEntry(rawEntry, kind);
    if (!entry) {
      throw new BadRequestException(
        `${field} entries must be URL strings or { url } objects with a non-empty url`,
      );
    }
    if (seen.has(entry.url)) continue; // dedup, first wins
    seen.add(entry.url);
    const grandfathered = grandfatheredUrls.has(entry.url);
    if (!grandfathered && !isMediaUrl(entry.url)) {
      throw new BadRequestException(
        `${field} entry "${entry.url}" must be an https:// URL or a relative /path (http:// is not accepted for new entries)`,
      );
    }
    if (
      kind === 'video' &&
      !grandfathered &&
      !isPlayableVideoUrl(entry.url)
    ) {
      throw new BadRequestException(
        `${field} entry "${entry.url}" must be a YouTube/Vimeo URL, a .mp4/.webm file, or a media-library video URL`,
      );
    }
    out.push(entry);
  }
  if (out.length > cap) {
    throw new BadRequestException(
      `${field} holds at most ${cap} entries (${out.length} given)`,
    );
  }
  return out;
}

/**
 * Normalize + validate the six media fields on write (§2.3 rules 4–6,
 * §6.3 rules 1 + 8). Pure: `input` is the DTO's media fields,
 * `previous` the stored row (updates) or undefined (creates). Omitted
 * fields keep the previous value (or the default on create); explicit
 * null / empty arrays clear.
 *
 * - thumbnailType must be 'image' | 'video'.
 * - type 'video' requires thumbnailVideoUrl AND thumbnailUrl (poster).
 * - type 'image' clears thumbnailVideoUrl + forces autoplay false —
 *   but FIRST the previous video URL is rescued into the `videos`
 *   gallery (prepended if absent), so switching the type never
 *   silently deletes the operator's video (§6.3 rule 8).
 * - VIDEOS-CAP EDGE (builder decision, documented): if the gallery is
 *   already at its cap of 10 when the rescue prepends, the rescued URL
 *   is STILL prepended (cap+1 = 11). Dropping the last entry would
 *   silently delete an operator video; rejecting the save would block
 *   a legitimate type switch. The console shows "11 / 10" and the next
 *   save requires trimming to 10 (a plain 11-entry write is a 400) —
 *   the over-cap state is visible, never silent, and self-healing.
 */
export function normalizeMediaFields(
  input: MediaFieldsInput,
  previous?: ContentMediaFields | null,
): ContentMediaFields {
  const prev: ContentMediaFields = previous ?? {
    thumbnailType: 'image',
    thumbnailUrl: null,
    thumbnailVideoUrl: null,
    thumbnailAutoplay: false,
    videos: [],
    galleryImages: [],
  };

  const thumbnailTypeRaw =
    input.thumbnailType !== undefined && input.thumbnailType !== null
      ? input.thumbnailType.trim()
      : prev.thumbnailType;
  if (
    thumbnailTypeRaw !== 'image' &&
    thumbnailTypeRaw !== 'video'
  ) {
    throw new BadRequestException(
      `thumbnailType must be 'image' or 'video' (got "${thumbnailTypeRaw}")`,
    );
  }
  const thumbnailType = thumbnailTypeRaw;

  const thumbnailUrl =
    input.thumbnailUrl !== undefined
      ? asNullableString(input.thumbnailUrl)
      : prev.thumbnailUrl;
  const thumbnailVideoUrl =
    input.thumbnailVideoUrl !== undefined
      ? asNullableString(input.thumbnailVideoUrl)
      : prev.thumbnailVideoUrl;

  if (thumbnailUrl !== null) {
    // Grandfathered when unchanged: the backfill copied the legacy
    // featured image into thumbnailUrl, so an old http:// thumbnail
    // keeps working until the operator replaces it.
    const grandfathered = thumbnailUrl === prev.thumbnailUrl;
    if (!grandfathered && !isMediaUrl(thumbnailUrl)) {
      throw new BadRequestException(
        'thumbnailUrl must be an https:// URL or a relative /path (http:// is not accepted for new entries)',
      );
    }
  }

  const prevVideoUrls = new Set(prev.videos.map((v) => v.url));
  const prevImageUrls = new Set(prev.galleryImages.map((g) => g.url));
  const videos = normalizeGalleryStrict(
    input.videos !== undefined ? input.videos : prev.videos,
    'video',
    'videos',
    prevVideoUrls,
  ) as MediaVideo[];
  const galleryImages = normalizeGalleryStrict(
    input.galleryImages !== undefined
      ? input.galleryImages
      : prev.galleryImages,
    'image',
    'galleryImages',
    prevImageUrls,
  ) as MediaImage[];

  if (thumbnailType === 'video') {
    if (!thumbnailVideoUrl) {
      throw new BadRequestException(
        'thumbnailVideoUrl is required when thumbnailType is "video"',
      );
    }
    if (!isPlayableVideoUrl(thumbnailVideoUrl)) {
      const grandfathered = thumbnailVideoUrl === prev.thumbnailVideoUrl;
      if (!grandfathered) {
        throw new BadRequestException(
          'thumbnailVideoUrl must be a YouTube/Vimeo URL, a .mp4/.webm file, or a media-library video URL',
        );
      }
    }
    if (!thumbnailUrl) {
      throw new BadRequestException(
        'thumbnailUrl (the poster) is required when thumbnailType is "video"',
      );
    }
    return {
      thumbnailType,
      thumbnailUrl,
      thumbnailVideoUrl,
      thumbnailAutoplay:
        input.thumbnailAutoplay !== undefined &&
        input.thumbnailAutoplay !== null
          ? input.thumbnailAutoplay
          : prev.thumbnailAutoplay,
      videos,
      galleryImages,
    };
  }

  // type 'image': rescue the previous video thumbnail into the gallery
  // BEFORE clearing it (§6.3 rule 8). See the cap+1 note above.
  let rescuedVideos = videos;
  if (
    prev.thumbnailType === 'video' &&
    prev.thumbnailVideoUrl &&
    !videos.some((v) => v.url === prev.thumbnailVideoUrl)
  ) {
    rescuedVideos = [{ url: prev.thumbnailVideoUrl }, ...videos];
  }
  return {
    thumbnailType,
    thumbnailUrl,
    thumbnailVideoUrl: null,
    thumbnailAutoplay: false,
    videos: rescuedVideos,
    galleryImages,
  };
}
