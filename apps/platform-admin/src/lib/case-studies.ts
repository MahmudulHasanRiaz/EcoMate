import { readJson } from './api';

/**
 * Case-study client helpers (console /case-studies).
 *
 * Slug rule (kept in sync with the API — see
 * platform-api/src/case-studies/case-studies.constants.ts):
 * lowercase letters, digits, single hyphens. Metrics are edited as
 * `stat | label` lines (the same shape as testimonial metrics).
 */

export const CASE_STUDY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Max metric lines per study (same cap as testimonial metrics). */
export const CASE_STUDY_MAX_METRICS = 6;

export interface CaseStudyMetricLine {
  stat: string;
  label: string;
}

export interface CaseStudy {
  id: string;
  title: string;
  slug: string;
  client: string;
  businessType: string;
  problem: string;
  solution: string;
  outcome: string;
  metrics: CaseStudyMetricLine[];
  featuredImageUrl: string | null;
  videoUrl: string | null;
  websiteUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaseStudyListResponse {
  data: CaseStudy[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CaseStudyInput {
  title: string;
  slug: string;
  client: string;
  businessType: string;
  problem: string;
  solution: string;
  outcome: string;
  metrics: CaseStudyMetricLine[];
  featuredImageUrl?: string;
  videoUrl?: string;
  websiteUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  isPublished: boolean;
}

export function isValidCaseStudySlug(slug: string): boolean {
  return CASE_STUDY_SLUG_PATTERN.test(slug);
}

/** "Dhaka Fashion House!" → "dhaka-fashion-house" (for the slug hint). */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parse the metrics textarea: one `stat | label` line per metric.
 * Blank lines are skipped; a line without a `|` is rejected (the
 * caller surfaces the error in-app).
 */
export function parseMetricLines(
  text: string,
): { lines: CaseStudyMetricLine[]; error: string | null } {
  const lines: CaseStudyMetricLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const pipe = line.indexOf('|');
    if (pipe < 0) {
      return {
        lines: [],
        error: `Metric line "${line}" needs a "stat | label" format.`,
      };
    }
    const stat = line.slice(0, pipe).trim();
    const label = line.slice(pipe + 1).trim();
    if (!stat || !label) {
      return {
        lines: [],
        error: `Metric line "${line}" needs both a stat and a label.`,
      };
    }
    lines.push({ stat, label });
  }
  if (lines.length > CASE_STUDY_MAX_METRICS) {
    return {
      lines: [],
      error: `At most ${CASE_STUDY_MAX_METRICS} metric lines are allowed.`,
    };
  }
  return { lines, error: null };
}

export function formatMetricLines(lines: CaseStudyMetricLine[]): string {
  return lines.map((line) => `${line.stat} | ${line.label}`).join('\n');
}

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function fetchCaseStudyList(
  api: ApiFetch,
  params: { page?: number; limit?: number; q?: string },
): Promise<CaseStudyListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.q) search.set('q', params.q);
  const query = search.toString();
  return api(`/case-studies${query ? `?${query}` : ''}`).then((r) =>
    readJson<CaseStudyListResponse>(r),
  );
}

export function fetchCaseStudy(api: ApiFetch, id: string): Promise<CaseStudy> {
  return api(`/case-studies/${id}`).then((r) => readJson<CaseStudy>(r));
}

export function createCaseStudy(
  api: ApiFetch,
  input: CaseStudyInput,
): Promise<CaseStudy> {
  return api('/case-studies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => readJson<CaseStudy>(r));
}

export function updateCaseStudy(
  api: ApiFetch,
  id: string,
  input: Partial<CaseStudyInput>,
): Promise<CaseStudy> {
  return api(`/case-studies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => readJson<CaseStudy>(r));
}

export function deleteCaseStudy(
  api: ApiFetch,
  id: string,
): Promise<{ deleted: boolean }> {
  return api(`/case-studies/${id}`, { method: 'DELETE' }).then((r) =>
    readJson<{ deleted: boolean }>(r),
  );
}
