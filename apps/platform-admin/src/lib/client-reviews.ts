import { readJson } from './api';
import {
  formatMetricLines,
  parseMetricLines,
  type CaseStudyMetricLine,
} from './case-studies';
import type {
  ContentMediaValue,
  MediaImageEntry,
  MediaVideoEntry,
} from './content-media';

/**
 * Client-review client helpers (console /client-reviews).
 *
 * Reviews are the public landing's video slider + text grid. Format is
 * the operator's intent; the API derives the effective format from the
 * media actually present (see lib/content-media.ts). Metrics are edited
 * as `stat | label` lines (the same shape as case-study metrics).
 */

export const CLIENT_REVIEW_FORMATS = [
  'video_short',
  'video_standard',
  'image',
  'text',
] as const;

export type ClientReviewFormat = (typeof CLIENT_REVIEW_FORMATS)[number];

export const CLIENT_REVIEW_FORMAT_LABELS: Record<ClientReviewFormat, string> = {
  video_short: 'Video (short / vertical)',
  video_standard: 'Video (standard 16:9)',
  image: 'Image',
  text: 'Text',
};

export const CLIENT_REVIEW_STATUSES = ['draft', 'published'] as const;

export type ClientReviewStatus = (typeof CLIENT_REVIEW_STATUSES)[number];

export const CLIENT_REVIEW_VIDEO_PROVIDERS = ['youtube', 'upload'] as const;

export type ClientReviewVideoProvider =
  (typeof CLIENT_REVIEW_VIDEO_PROVIDERS)[number];

export const CLIENT_REVIEW_MAX_QUOTE_LENGTH = 5000;
export const CLIENT_REVIEW_MAX_METRICS = 6;
export const CLIENT_REVIEW_MAX_SORT_ORDER = 10000;

export type ClientReviewMetricLine = CaseStudyMetricLine;

export { formatMetricLines, parseMetricLines };

export interface ClientReview extends ContentMediaValue {
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
  metrics: ClientReviewMetricLine[];
  format: string;
  effectiveFormat: string;
  videoProvider: string;
  videoDuration: string;
  caseStudyId: string | null;
  sortOrder: number;
  isFeatured: boolean;
  status: string;
  sourceKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientReviewListResponse {
  data: ClientReview[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ClientReviewInput {
  reviewerName: string;
  role?: string;
  companyName: string;
  category?: string;
  location?: string;
  quoteEn: string;
  quoteBn?: string;
  websiteUrl?: string;
  logoUrl?: string;
  rating?: number | null;
  metrics: ClientReviewMetricLine[];
  format?: string;
  videoProvider?: string;
  videoDuration?: string;
  caseStudyId?: string | null;
  sortOrder?: number;
  isFeatured?: boolean;
  status?: string;
  thumbnailType?: 'image' | 'video';
  thumbnailUrl?: string;
  thumbnailVideoUrl?: string;
  thumbnailAutoplay?: boolean;
  videos?: MediaVideoEntry[];
  galleryImages?: MediaImageEntry[];
}

export function isClientReviewFormat(value: string): value is ClientReviewFormat {
  return (CLIENT_REVIEW_FORMATS as readonly string[]).includes(value);
}

export function clientReviewFormatLabel(format: string): string {
  return isClientReviewFormat(format)
    ? CLIENT_REVIEW_FORMAT_LABELS[format]
    : format;
}

/** The quote in the operator's locale pick — Bangla falls back to English. */
export function reviewQuote(review: ClientReview, locale: 'en' | 'bn'): string {
  if (locale === 'bn' && review.quoteBn.trim()) return review.quoteBn;
  return review.quoteEn;
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function fetchClientReviewList(
  api: ApiFetch,
  params: { page?: number; limit?: number; q?: string; status?: string },
): Promise<ClientReviewListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  const query = search.toString();
  return api(`/client-reviews${query ? `?${query}` : ''}`).then((r) =>
    readJson<ClientReviewListResponse>(r),
  );
}

export function fetchClientReview(
  api: ApiFetch,
  id: string,
): Promise<ClientReview> {
  return api(`/client-reviews/${id}`).then((r) =>
    readJson<ClientReview>(r),
  );
}

export function createClientReview(
  api: ApiFetch,
  input: ClientReviewInput,
): Promise<ClientReview> {
  return api('/client-reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => readJson<ClientReview>(r));
}

export function updateClientReview(
  api: ApiFetch,
  id: string,
  input: Partial<ClientReviewInput>,
): Promise<ClientReview> {
  return api(`/client-reviews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => readJson<ClientReview>(r));
}

export function deleteClientReview(
  api: ApiFetch,
  id: string,
): Promise<{ deleted: boolean }> {
  return api(`/client-reviews/${id}`, { method: 'DELETE' }).then((r) =>
    readJson<{ deleted: boolean }>(r),
  );
}
