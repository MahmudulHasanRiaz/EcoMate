import { EMPTY_MEDIA_FIELDS } from '../common/media/media.constants';
import {
  CLIENT_REVIEW_FORMATS,
  deriveEffectiveReviewFormat,
} from './client-reviews.constants';

/**
 * One-time testimonial migration — pure mapping
 * (landing-cms-media-design.md §5.2).
 *
 * Pairs LandingContent testimonial rows by `key` across locales and
 * maps each pair onto a ClientReview create payload. Pure + unit-tested
 * here; the runnable script
 * (prisma/seed/migrate-testimonials-to-reviews.ts) only does I/O:
 * read rows, resolve slugs, upsert by sourceKey, print the report.
 *
 * The script NEVER modifies a LandingContent row, and never overwrites
 * an operator-edited review (sourceKey upsert = skip when present).
 */

/** A LandingContent row as the script reads it (section='testimonials'). */
export interface TestimonialRow {
  key: string;
  locale: string;
  value: unknown;
  sortOrder: number;
  isActive: boolean;
  status: string;
}

export interface TestimonialPair {
  key: string;
  en?: TestimonialRow;
  bn?: TestimonialRow;
}

export interface MappedReview {
  data: {
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
    metrics: Array<{ stat: string; label: string }>;
    format: string;
    videoProvider: string;
    videoDuration: string;
    caseStudyId: string | null;
    sortOrder: number;
    isFeatured: boolean;
    status: string;
    sourceKey: string;
    thumbnailType: string;
    thumbnailUrl: string | null;
    thumbnailVideoUrl: string | null;
    thumbnailAutoplay: boolean;
    videos: Array<{ url: string; title?: string }>;
    galleryImages: Array<{ url: string }>;
  };
  warnings: string[];
}

export type MapTestimonialResult =
  | { mapped: MappedReview; skipReason?: undefined }
  | { mapped?: undefined; skipReason: string; warnings: string[] };

/** Group testimonial rows by key (en/bn pair per key). */
export function groupTestimonialRows(
  rows: TestimonialRow[],
): TestimonialPair[] {
  const byKey = new Map<string, TestimonialPair>();
  for (const row of rows) {
    let pair = byKey.get(row.key);
    if (!pair) {
      pair = { key: row.key };
      byKey.set(row.key, pair);
    }
    if (row.locale === 'en') pair.en = row;
    else if (row.locale === 'bn') pair.bn = row;
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function valueOf(row: TestimonialRow | undefined): Record<string, unknown> {
  if (!row || typeof row.value !== 'object' || row.value === null) return {};
  return row.value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Primary (en, else bn) wins; the other locale fills gaps. */
function pick(
  en: Record<string, unknown>,
  bn: Record<string, unknown>,
  field: string,
): string {
  return asString(en[field]) || asString(bn[field]);
}

function parseRating(value: unknown): number | null {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isInteger(num) || num < 1 || num > 5) return null;
  return num;
}

function parseMetrics(
  value: unknown,
  key: string,
  warnings: string[],
): Array<{ stat: string; label: string }> {
  if (!Array.isArray(value)) return [];
  const lines: Array<{ stat: string; label: string }> = [];
  for (const entry of value) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { stat?: unknown }).stat === 'string' &&
      typeof (entry as { label?: unknown }).label === 'string' &&
      ((entry as { stat: string }).stat.trim().length > 0) &&
      ((entry as { label: string }).label.trim().length > 0)
    ) {
      lines.push({
        stat: (entry as { stat: string }).stat.trim(),
        label: (entry as { label: string }).label.trim(),
      });
    } else {
      warnings.push(
        `[${key}] dropped a malformed metric line (needs non-empty stat + label)`,
      );
    }
  }
  if (lines.length > 6) {
    warnings.push(
      `[${key}] metrics truncated from ${lines.length} to 6 (the max)`,
    );
    return lines.slice(0, 6);
  }
  return lines;
}

/**
 * Map one en/bn pair onto a ClientReview payload (mapping table §5.2).
 * `caseStudyIdBySlug` resolves the old `caseStudySlug` string to a
 * typed FK; an unresolvable slug warns and maps to NULL (never fatal).
 *
 * Orphan rule: a key in only one locale migrates with a warning. For
 * a bn-only orphan the Bangla quote ALSO fills quoteEn — quoteEn is
 * required and the landing's fallback is EN-first, so an empty
 * quoteEn would render a quoteless review in the default locale.
 * (The design note's "missing locale's quote empty" holds for the
 * common en-only orphan; bn-only is the documented exception.)
 */
export function mapTestimonialPairToReview(
  pair: TestimonialPair,
  caseStudyIdBySlug: ReadonlyMap<string, string>,
): MapTestimonialResult {
  const warnings: string[] = [];
  const { key } = pair;
  if (!pair.en && !pair.bn) {
    return { skipReason: 'no rows (impossible by construction)', warnings };
  }
  if (!pair.en || !pair.bn) {
    warnings.push(
      `[${key}] orphan: present in only one locale (${pair.en ? 'en' : 'bn'}) — migrated with the missing locale empty`,
    );
  }
  // The en row governs status/sortOrder; a bn-only orphan's bn row does.
  const primary = pair.en ?? pair.bn!;
  const enValue = valueOf(pair.en);
  const bnValue = valueOf(pair.bn);

  const quoteEn = asString(enValue.quote) || asString(bnValue.quote);
  const quoteBn = asString(bnValue.quote);
  if (!quoteEn) {
    return {
      skipReason: 'no quote in either locale (a review without a quote is not a review)',
      warnings,
    };
  }

  const formatRaw = pick(enValue, bnValue, 'format');
  const videoUrl = pick(enValue, bnValue, 'videoUrl');
  const imageUrl = pick(enValue, bnValue, 'imageUrl');
  const videoTitle = pick(enValue, bnValue, 'videoTitle');
  const videoDuration = pick(enValue, bnValue, 'videoDuration');

  const videos =
    videoUrl !== ''
      ? [
          videoTitle !== ''
            ? { url: videoUrl, title: videoTitle }
            : { url: videoUrl },
        ]
      : [];
  const mediaForFormat = {
    ...EMPTY_MEDIA_FIELDS,
    thumbnailUrl: imageUrl !== '' ? imageUrl : null,
    videos: videos as Array<{ url: string; title?: string; duration?: string }>,
  };
  let format = formatRaw;
  if (!(CLIENT_REVIEW_FORMATS as readonly string[]).includes(formatRaw)) {
    format = deriveEffectiveReviewFormat('text', mediaForFormat);
    warnings.push(
      `[${key}] unknown format "${formatRaw}" — derived "${format}" from the media present`,
    );
  }

  // A video review's video IS its thumbnail (poster = imageUrl).
  const isVideoReview =
    (format === 'video_short' || format === 'video_standard') &&
    videoUrl !== '';
  const thumbnailType = isVideoReview ? 'video' : 'image';
  const thumbnailVideoUrl = isVideoReview ? videoUrl : null;
  const thumbnailUrl = imageUrl !== '' ? imageUrl : null;
  if (isVideoReview && thumbnailUrl === null) {
    warnings.push(
      `[${key}] video review with no poster image (imageUrl empty) — the slider shows no poster until one is added`,
    );
  }

  const ratingRaw =
    enValue.rating !== undefined ? enValue.rating : bnValue.rating;
  let rating: number | null = null;
  if (ratingRaw !== undefined && ratingRaw !== null && ratingRaw !== '') {
    rating = parseRating(ratingRaw);
    if (rating === null) {
      warnings.push(
        `[${key}] rating ${JSON.stringify(ratingRaw)} out of range (1–5) — stored as not given`,
      );
    }
  }

  const metricsValue =
    enValue.metrics !== undefined ? enValue.metrics : bnValue.metrics;
  const metrics = parseMetrics(metricsValue, key, warnings);

  const caseStudySlug = pick(enValue, bnValue, 'caseStudySlug');
  let caseStudyId: string | null = null;
  if (caseStudySlug !== '') {
    caseStudyId = caseStudyIdBySlug.get(caseStudySlug) ?? null;
    if (!caseStudyId) {
      warnings.push(
        `[${key}] caseStudySlug "${caseStudySlug}" does not resolve to a case study — link dropped`,
      );
    }
  }

  const challenge = pick(enValue, bnValue, 'challenge');
  const solution = pick(enValue, bnValue, 'solution');
  if (challenge !== '' || solution !== '') {
    warnings.push(
      `[${key}] challenge/solution dropped (they belong to case studies, not reviews; the source rows are kept)`,
    );
  }

  const websiteUrl = pick(enValue, bnValue, 'website');
  const logoUrl = pick(enValue, bnValue, 'logoUrl');

  return {
    mapped: {
      data: {
        reviewerName: pick(enValue, bnValue, 'founderName'),
        role: pick(enValue, bnValue, 'role'),
        companyName: pick(enValue, bnValue, 'businessName'),
        category: pick(enValue, bnValue, 'category'),
        location: pick(enValue, bnValue, 'location'),
        quoteEn,
        quoteBn,
        websiteUrl: websiteUrl !== '' ? websiteUrl : null,
        logoUrl: logoUrl !== '' ? logoUrl : null,
        rating,
        metrics,
        format,
        videoProvider: 'youtube',
        videoDuration,
        caseStudyId,
        sortOrder: primary.sortOrder,
        isFeatured: false,
        status:
          primary.status === 'published' && primary.isActive
            ? 'published'
            : 'draft',
        sourceKey: `testimonials:${key}`,
        thumbnailType,
        thumbnailUrl,
        thumbnailVideoUrl,
        thumbnailAutoplay: false,
        videos,
        galleryImages: [],
      },
      warnings,
    },
  };
}
