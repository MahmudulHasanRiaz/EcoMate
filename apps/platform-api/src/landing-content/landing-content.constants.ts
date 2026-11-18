/**
 * Landing content model constants (plan §13). The sections and locales
 * are validated at the API layer — intentionally NOT Prisma enums, so a
 * future section needs no migration.
 *
 * Public shapes (GET /public/landing-content groups by locale, then
 * section — see LandingContentService.publicGrouped):
 * - scalar: `{ field: value }` (one row per field, value is a string)
 * - object: a single `{ ...fields }` object (one row per locale, key
 *   'main' by convention; value is a JSON object)
 * - capabilities: `{ sectionId: partialSectionObject }` (one row per
 *   capability section id)
 * - list: `[{ key, ...value }]` (one row per item, sortOrder then key)
 *
 * The console (apps/platform-admin/src/lib/landing-content.ts) keeps a
 * MIRROR of these lists — change both together, plus the seed rows in
 * prisma/seed/landing-content.json and the merge in
 * apps/landing/lib/landing-content.ts.
 */
export const LANDING_SECTIONS = [
  'hero',
  'capabilities',
  'faq',
  'testimonials',
  'partners',
  'contact',
  'seo',
  'leadForm',
  'proof',
  'faqMeta',
  'pricingCopy',
  'gettingStarted',
  'walkthrough',
  'videoSection',
  'heroTabs',
  'dock',
  'header',
  'nav',
  'footer',
  'footerLinks',
] as const;

export type LandingSection = (typeof LANDING_SECTIONS)[number];

export const LANDING_LOCALES = ['en', 'bn'] as const;

export type LandingLocale = (typeof LANDING_LOCALES)[number];

/**
 * Row keys: start with a letter or number, then letters, numbers or
 * hyphens. Uppercase is allowed deliberately: hero/contact/seo keys ARE
 * the landing's field names (headlinePart1, primaryCta, messengerUrl)
 * and the landing merge matches them verbatim — slugifying them would
 * break the merge. List-item keys (faq-1, story-*, partner-*) are
 * lowercase slugs by convention. Single-object sections use the fixed
 * key 'main' (see LANDING_OBJECT_KEY).
 */
export const LANDING_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

/** The single row key for object sections (one object row per locale). */
export const LANDING_OBJECT_KEY = 'main';

/** Sections whose public shape is a list of `{ key, ...value }` items. */
export const LANDING_LIST_SECTIONS: ReadonlySet<string> = new Set([
  'faq',
  'testimonials',
  'partners',
  'nav',
  'footerLinks',
]);

/** Sections whose public shape is a `{ field: value }` scalar map. */
export const LANDING_SCALAR_SECTIONS: ReadonlySet<string> = new Set([
  'hero',
  'contact',
  'seo',
]);

/**
 * Sections whose public shape is a single `{ ...fields }` object (one
 * row per locale, key 'main'). Used for the single-block sections added
 * in Landing CMS Batch 1 — a scalar section cannot hold a section's
 * string-list fields (volumeOptions, bullets) or its grouped fields
 * (proof chrome, pricing labels), so these sections keep one flat
 * object row instead of one row per field.
 */
export const LANDING_OBJECT_SECTIONS: ReadonlySet<string> = new Set([
  'leadForm',
  'proof',
  'faqMeta',
  'pricingCopy',
  'gettingStarted',
  'walkthrough',
  'videoSection',
  'heroTabs',
  'dock',
  'header',
  'footer',
]);
