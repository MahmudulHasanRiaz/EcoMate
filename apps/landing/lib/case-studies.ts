/**
 * Public case studies for the landing (Landing CMS item 19).
 *
 * The console manages case studies in platform-api; the landing reads
 * them from GET /public/case-studies (+ /:slug) server-side, with the
 * same fail-soft pattern as the landing-content and plans fetches: an
 * unreachable or misbehaving API yields an empty list / null, never a
 * thrown error — the pages render their empty state instead of failing.
 *
 * Only published studies are ever served (the API enforces it); the
 * landing additionally validates every row's shape before rendering,
 * so a malformed row is dropped rather than breaking the page.
 */

export interface PublicCaseStudyMetric {
  stat: string;
  label: string;
}

export interface PublicCaseStudy {
  id: string;
  title: string;
  slug: string;
  client: string;
  businessType: string;
  problem: string;
  solution: string;
  outcome: string;
  metrics: PublicCaseStudyMetric[];
  featuredImageUrl: string | null;
  videoUrl: string | null;
  websiteUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The slug pattern the API enforces (see
 * platform-api/src/case-studies/case-studies.constants.ts). The
 * landing uses it to guard outbound links (Trust cards) — a managed
 * testimonial's caseStudySlug only becomes a link when it matches.
 */
export const CASE_STUDY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isCaseStudySlug(value: unknown): value is string {
  return (
    typeof value === 'string' && CASE_STUDY_SLUG_PATTERN.test(value)
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

function isMetricLine(value: unknown): value is PublicCaseStudyMetric {
  return (
    isRecord(value) &&
    isNonEmptyString(value.stat) &&
    isNonEmptyString(value.label)
  );
}

/** Strict row validation — a malformed row is dropped, never rendered. */
export function isPublicCaseStudy(value: unknown): value is PublicCaseStudy {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isCaseStudySlug(value.slug) &&
    isNonEmptyString(value.client) &&
    isNonEmptyString(value.businessType) &&
    isNonEmptyString(value.problem) &&
    isNonEmptyString(value.solution) &&
    isNonEmptyString(value.outcome) &&
    Array.isArray(value.metrics) &&
    value.metrics.every(isMetricLine) &&
    isNullableString(value.featuredImageUrl) &&
    isNullableString(value.videoUrl) &&
    isNullableString(value.websiteUrl) &&
    isNullableString(value.seoTitle) &&
    isNullableString(value.seoDescription) &&
    typeof value.isPublished === 'boolean' &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
}

/** Server-side fetch of the published case-study list. Never throws. */
export async function fetchPublicCaseStudies(): Promise<PublicCaseStudy[]> {
  try {
    const response = await fetch(
      `${platformApiBase()}/public/case-studies`,
      {
        // Studies change rarely; a 5-minute cache keeps the landing
        // fast and keeps a downed API from taking the page down.
        // Tagged so the cache purge revalidates it immediately.
        next: { revalidate: 300, tags: ['case-studies'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return [];
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];
    return data.filter(isPublicCaseStudy);
  } catch {
    return [];
  }
}

/** Server-side fetch of one published case study. Never throws. */
export async function fetchPublicCaseStudy(
  slug: string,
): Promise<PublicCaseStudy | null> {
  if (!isCaseStudySlug(slug)) return null;
  try {
    const response = await fetch(
      `${platformApiBase()}/public/case-studies/${slug}`,
      {
        next: { revalidate: 300, tags: ['case-studies'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isPublicCaseStudy(data) ? data : null;
  } catch {
    return null;
  }
}
