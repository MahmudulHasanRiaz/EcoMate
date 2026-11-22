/**
 * Public client reviews for the landing (Landing CMS — shared media
 * model). The console manages reviews in platform-api; the landing
 * reads them from GET /public/client-reviews server-side, with the
 * same fail-soft pattern as the case-studies fetch: an unreachable or
 * misbehaving API yields an empty list, never a thrown error — the
 * video section hides and the text section falls back to its built-in
 * stories.
 *
 * Only published reviews are ever served (the API enforces it); the
 * landing additionally validates every row's shape before rendering,
 * so a malformed row is dropped rather than breaking the page. The
 * landing branches on the API's `effectiveFormat` (§3.1 — the API
 * derives it at read time from the current media, so it is never
 * stale); the local derivation in content-media.ts runs only as a
 * fallback for rows served by an older API that did not send the
 * field.
 */

import {
  effectiveFormat,
  resolveMedia,
  type ContentMedia,
  type ReviewFormat,
} from './content-media';

export interface PublicClientReviewMetric {
  stat: string;
  label: string;
}

export interface PublicClientReview extends ContentMedia {
  id: string;
  reviewerName: string;
  role: string;
  companyName: string;
  category: string;
  location: string;
  quoteEn: string;
  quoteBn: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  rating: number | null;
  metrics: PublicClientReviewMetric[];
  format: ReviewFormat;
  effectiveFormat: ReviewFormat;
  videoProvider: string;
  videoDuration: string;
  caseStudyId: string | null;
  sortOrder: number;
  isFeatured: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const CLIENT_REVIEW_FORMATS: readonly ReviewFormat[] = [
  'text',
  'image',
  'video_short',
  'video_standard',
] as const;

function isReviewFormat(value: unknown): value is ReviewFormat {
  return (
    typeof value === 'string' &&
    (CLIENT_REVIEW_FORMATS as readonly string[]).includes(value)
  );
}

function platformApiBase(): string {
  const configured = (
    process.env.PLATFORM_API_URL || 'http://localhost:4100/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isMetricLine(value: unknown): value is PublicClientReviewMetric {
  return (
    isRecord(value) &&
    isNonEmptyString(value.stat) &&
    isNonEmptyString(value.label)
  );
}

/**
 * A gallery entry is an object with a string url, or a plain string
 * (defensive, §2.2). Anything else makes the row malformed.
 */
function isMediaGallery(value: unknown): boolean {
  if (value === undefined) return true; // optional (deploy-order safety)
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      typeof entry === 'string' ||
      (isRecord(entry) && isNonEmptyString(entry.url)),
  );
}

/**
 * Strict row validation — a malformed row is dropped, never rendered.
 * The six media fields are OPTIONAL in the validator (deploy-order
 * safety, §4.5): a row served by an older API still validates and
 * renders from its legacy columns via resolveMedia.
 */
export function isPublicClientReview(
  value: unknown,
): value is PublicClientReview {
  if (!isRecord(value)) return false;
  const ratingOk =
    value.rating === null ||
    (typeof value.rating === 'number' &&
      Number.isInteger(value.rating) &&
      value.rating >= 1 &&
      value.rating <= 5);
  const mediaOk =
    (value.thumbnailType === undefined ||
      value.thumbnailType === 'image' ||
      value.thumbnailType === 'video') &&
    (value.thumbnailUrl === undefined ||
      isNullableString(value.thumbnailUrl)) &&
    (value.thumbnailVideoUrl === undefined ||
      isNullableString(value.thumbnailVideoUrl)) &&
    (value.thumbnailAutoplay === undefined ||
      typeof value.thumbnailAutoplay === 'boolean') &&
    isMediaGallery(value.videos) &&
    isMediaGallery(value.galleryImages);
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.reviewerName) &&
    isString(value.role) &&
    isNonEmptyString(value.companyName) &&
    isString(value.category) &&
    isString(value.location) &&
    isNonEmptyString(value.quoteEn) &&
    isString(value.quoteBn) &&
    isNullableString(value.websiteUrl) &&
    isNullableString(value.logoUrl) &&
    ratingOk &&
    Array.isArray(value.metrics) &&
    value.metrics.every(isMetricLine) &&
    isReviewFormat(value.format) &&
    isString(value.videoProvider) &&
    isString(value.videoDuration) &&
    isNullableString(value.caseStudyId) &&
    typeof value.sortOrder === 'number' &&
    typeof value.isFeatured === 'boolean' &&
    isString(value.status) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    mediaOk
  );
}

/**
 * Normalize a validated row: resolve the media (legacy fallback) and
 * take the effective format. The API's `effectiveFormat` wins when
 * present (§3.1: "The landing MUST branch on effectiveFormat") — it
 * is derived at read time from the current media, so it is never
 * stale. The local derivation runs only as a fallback for rows
 * served by an older API that did not send the field (or sent an
 * invalid one).
 */
export function normalizePublicClientReview(
  row: PublicClientReview,
): PublicClientReview {
  const media = resolveMedia(row);
  const effective = isReviewFormat(row.effectiveFormat)
    ? row.effectiveFormat
    : effectiveFormat(row.format, media);
  return {
    ...row,
    ...media,
    effectiveFormat: effective,
  };
}

/** The quote for a locale (Bangla falls back to English). */
export function reviewQuote(
  review: PublicClientReview,
  locale: 'en' | 'bn',
): string {
  if (locale === 'bn' && review.quoteBn.trim()) return review.quoteBn;
  return review.quoteEn;
}

/** Server-side fetch of the published client-review list. Never throws. */
export async function fetchPublicClientReviews(): Promise<
  PublicClientReview[]
> {
  try {
    const response = await fetch(
      `${platformApiBase()}/public/client-reviews`,
      {
        // Reviews change rarely; a 5-minute cache keeps the landing
        // fast and keeps a downed API from taking the page down.
        // Tagged so the cache purge revalidates it immediately.
        next: { revalidate: 300, tags: ['client-reviews'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return [];
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(isPublicClientReview)
      .map(normalizePublicClientReview);
  } catch {
    return [];
  }
}
