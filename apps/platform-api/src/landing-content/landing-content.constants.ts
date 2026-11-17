/**
 * Landing content model constants (plan §13). The sections and locales
 * are validated at the API layer — intentionally NOT Prisma enums, so a
 * future section needs no migration.
 */
export const LANDING_SECTIONS = [
  'hero',
  'capabilities',
  'faq',
  'testimonials',
  'partners',
  'contact',
] as const;

export type LandingSection = (typeof LANDING_SECTIONS)[number];

export const LANDING_LOCALES = ['en', 'bn'] as const;

export type LandingLocale = (typeof LANDING_LOCALES)[number];

/**
 * Row keys: start with a letter or number, then letters, numbers or
 * hyphens. Uppercase is allowed deliberately: hero/contact keys ARE the
 * landing's field names (headlinePart1, primaryCta, messengerUrl) and
 * the landing merge matches them verbatim — slugifying them would break
 * the merge. List-item keys (faq-1, story-*, partner-*) are lowercase
 * slugs by convention.
 */
export const LANDING_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

/** Sections whose public shape is a list of `{ key, ...value }` items. */
export const LANDING_LIST_SECTIONS: ReadonlySet<string> = new Set([
  'faq',
  'testimonials',
  'partners',
]);

/** Sections whose public shape is a `{ field: value }` scalar map. */
export const LANDING_SCALAR_SECTIONS: ReadonlySet<string> = new Set([
  'hero',
  'contact',
]);
