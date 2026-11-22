import type { ContentMediaFields } from '../common/media/media.constants';

/**
 * Client-review constants (landing-cms-media-design.md §3).
 *
 * Format + status are Strings validated at the API layer —
 * intentionally NOT Prisma enums (same rule as BlogPost.status): a
 * new value needs no migration.
 */

export const CLIENT_REVIEW_FORMATS = [
  'video_short',
  'video_standard',
  'image',
  'text',
] as const;

export type ClientReviewFormat = (typeof CLIENT_REVIEW_FORMATS)[number];

export const CLIENT_REVIEW_STATUSES = ['draft', 'published'] as const;

export type ClientReviewStatus = (typeof CLIENT_REVIEW_STATUSES)[number];

/** Which player renders the review's videos (EcoMate-Landing default: youtube). */
export const CLIENT_REVIEW_VIDEO_PROVIDERS = ['youtube', 'upload'] as const;

export type ClientReviewVideoProvider =
  (typeof CLIENT_REVIEW_VIDEO_PROVIDERS)[number];

/** Max quote length (same as the EcoMate-Landing reference). */
export const CLIENT_REVIEW_MAX_QUOTE_LENGTH = 5000;

/** Max metric lines per review (same cap as case-study metrics). */
export const CLIENT_REVIEW_MAX_METRICS = 6;

/** Sort-order range (same as the EcoMate-Landing reference). */
export const CLIENT_REVIEW_MAX_SORT_ORDER = 10000;

export const CLIENT_REVIEW_MAX_URL_LENGTH = 2048;

/**
 * The effective display format (§3.1): the stored `format` is the
 * operator's intent, but the PUBLIC read re-derives it from the media
 * actually present — a stored video format with no video degrades to
 * image/text, never to a broken embed. The landing branches ONLY on
 * this value. Mirrored (by test, not by import — the apps do not
 * share code) in platform-admin/src/lib/content-media.ts and
 * landing/lib/content-media.ts.
 */
export function deriveEffectiveReviewFormat(
  format: string,
  media: ContentMediaFields,
): ClientReviewFormat {
  const hasVideo =
    media.videos.length > 0 ||
    (media.thumbnailType === 'video' && media.thumbnailVideoUrl !== null);
  const hasImage =
    media.thumbnailUrl !== null || media.galleryImages.length > 0;
  if (
    (format === 'video_short' || format === 'video_standard') &&
    hasVideo
  ) {
    return format;
  }
  if (hasVideo) return 'video_standard';
  if (hasImage) return 'image';
  return 'text';
}
