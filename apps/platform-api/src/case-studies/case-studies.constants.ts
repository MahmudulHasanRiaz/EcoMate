/**
 * Case-study constants (Landing CMS item 19).
 *
 * Slugs are URL segments: lowercase letters, digits, and single
 * hyphens, never leading/trailing a hyphen. The same pattern is
 * enforced in the console (platform-admin/src/lib/case-studies.ts)
 * and in the landing Trust link guard (lib/landing-content.ts) —
 * keep the three in sync.
 */
export const CASE_STUDY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Max metric lines per study (same cap as testimonial metrics). */
export const CASE_STUDY_MAX_METRICS = 6;

export const CASE_STUDY_MAX_TITLE_LENGTH = 200;
export const CASE_STUDY_MAX_SLUG_LENGTH = 100;
export const CASE_STUDY_MAX_URL_LENGTH = 2048;
export const CASE_STUDY_MAX_SEO_TITLE_LENGTH = 200;
export const CASE_STUDY_MAX_SEO_DESCRIPTION_LENGTH = 400;
