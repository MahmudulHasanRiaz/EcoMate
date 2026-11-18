import type { LandingContentRow } from '../types';

/**
 * The 20 landing sections, in console tab order (mirrors
 * LANDING_SECTIONS in the platform API's landing-content.constants.ts).
 * Scalar sections hold one string per row; object sections hold one
 * flat object per locale (fixed key 'main'); list sections hold one
 * object row per item.
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

export const LANDING_SECTION_LABELS: Record<LandingSection, string> = {
  hero: 'Hero',
  capabilities: 'Capabilities',
  faq: 'FAQ',
  testimonials: 'Testimonials',
  partners: 'Partners',
  contact: 'Contact',
  seo: 'SEO',
  leadForm: 'Lead form',
  proof: 'Proof',
  faqMeta: 'FAQ heading',
  pricingCopy: 'Pricing copy',
  gettingStarted: 'Getting started',
  walkthrough: 'Walkthrough',
  videoSection: 'Video',
  heroTabs: 'Hero tabs',
  dock: 'Dock',
  header: 'Header',
  nav: 'Navigation',
  footer: 'Footer',
  footerLinks: 'Footer links',
};

export const LANDING_LOCALES = ['en', 'bn'] as const;

export type LandingLocale = (typeof LANDING_LOCALES)[number];

export const LANDING_LOCALE_LABELS: Record<LandingLocale, string> = {
  en: 'English',
  bn: 'Bangla',
};

/** Sections whose rows are one scalar field each (value = string). */
export const LANDING_SCALAR_SECTIONS: ReadonlySet<string> = new Set([
  'hero',
  'contact',
  'seo',
]);

/**
 * Sections whose rows are one flat object per locale (value = object,
 * fixed key LANDING_OBJECT_KEY). The landing merge overrides the
 * built-in section field-by-field.
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

/** The single row key for object sections (same as the API). */
export const LANDING_OBJECT_KEY = 'main';

/** Sections whose rows are list items (value = object, one row per item). */
export const LANDING_LIST_SECTIONS: ReadonlySet<string> = new Set([
  'faq',
  'testimonials',
  'partners',
  'nav',
  'footerLinks',
]);

/** The 10 capability section ids the landing renders (in page order). */
export const CAPABILITY_KEYS = [
  'fragmented',
  'packing',
  'revenue',
  'logistics',
  'adDefense',
  'stores',
  'omnichannel',
  'finance',
  'team',
  'infra',
] as const;

export const CAPABILITY_LABELS: Record<string, string> = {
  fragmented: 'Fragmented tools',
  packing: 'Packing terminal',
  revenue: 'Revenue ledger',
  logistics: 'Logistics',
  adDefense: 'Ad defense',
  stores: 'Stores',
  omnichannel: 'Omnichannel',
  finance: 'Profit clarity',
  team: 'Team ops',
  infra: 'Infra tracking',
};

export type LandingFieldKind = 'text' | 'textarea' | 'lines' | 'metrics';

export interface LandingFieldDef {
  name: string;
  label: string;
  kind: LandingFieldKind;
  /** Hint shown under the input (e.g. the lines format). */
  hint?: string;
}

function text(name: string, label: string): LandingFieldDef {
  return { name, label, kind: 'text' };
}

function area(name: string, label: string): LandingFieldDef {
  return { name, label, kind: 'textarea' };
}

function lines(name: string, label: string): LandingFieldDef {
  return {
    name,
    label,
    kind: 'lines',
    hint: 'One item per line.',
  };
}

/**
 * Editable fields per section. The field names are the landing's REAL
 * field names — the landing merge shallow-overrides built-in fields by
 * name, so these must stay in sync with apps/landing/lib/landingTypes.ts.
 * Capabilities vary per section id (heterogeneous list fields); the
 * sections without a list keep heading + subheading only (their lists
 * are demo data that stays in code).
 */
const HERO_FIELDS: LandingFieldDef[] = [
  text('badge', 'Badge'),
  text('headlinePart1', 'Headline — part 1'),
  text('headlineHighlight', 'Headline — highlighted part'),
  text('headlinePart2', 'Headline — part 2'),
  area('subtitle', 'Subtitle'),
  text('primaryCta', 'Primary button'),
  text('secondaryCta', 'Secondary button'),
];

const CONTACT_FIELDS: LandingFieldDef[] = [
  text('phone', 'Phone (display)'),
  text('email', 'Email'),
  area('address', 'Address'),
  text('whatsapp', 'WhatsApp number'),
  text('messengerUrl', 'Messenger URL'),
  text('callNumber', 'Call number (tel: link)'),
];

const CAPABILITY_FIELDS: Record<string, LandingFieldDef[]> = {
  fragmented: [
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    lines('beforeItems', 'Before items'),
    lines('afterItems', 'After items'),
  ],
  packing: [
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    lines('features', 'Features'),
  ],
  revenue: [text('heading', 'Heading'), area('subheading', 'Subheading')],
  logistics: [text('heading', 'Heading'), area('subheading', 'Subheading')],
  adDefense: [text('heading', 'Heading'), area('subheading', 'Subheading')],
  stores: [
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    lines('whyItems', 'Why items'),
  ],
  omnichannel: [
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
  ],
  finance: [
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    lines('paymentsRows', 'Payment rows'),
  ],
  team: [
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    lines('features', 'Features'),
  ],
  infra: [
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    lines('features', 'Features'),
  ],
};

const FAQ_FIELDS: LandingFieldDef[] = [
  text('question', 'Question'),
  area('answer', 'Answer'),
];

const TESTIMONIAL_FIELDS: LandingFieldDef[] = [
  text('businessName', 'Business name'),
  text('founderName', 'Founder name'),
  text('role', 'Role'),
  text('location', 'Location'),
  text('website', 'Website'),
  area('quote', 'Quote'),
  text('videoDuration', 'Video duration'),
  text('videoTitle', 'Video title'),
  {
    name: 'metrics',
    label: 'Metrics',
    kind: 'metrics',
    hint: 'One per line: "stat | label" (e.g. "3x | Faster packing").',
  },
];

const PARTNER_FIELDS: LandingFieldDef[] = [text('name', 'Brand name')];

const SEO_FIELDS: LandingFieldDef[] = [
  text('title', 'Page title'),
  area('description', 'Meta description'),
];

/**
 * Object-section fields (Batch 1, items 6–7). The field names are the
 * landing merge's REAL field names — the merge in
 * apps/landing/lib/landing-content.ts reads them by name, so these
 * must stay in sync with it AND with the seed rows in
 * apps/platform-api/prisma/seed/landing-content.json. Flat camelCase
 * names map onto nested landing fields (chrome*, label*, stepN*).
 */
const OBJECT_FIELDS: Record<string, LandingFieldDef[]> = {
  leadForm: [
    text('eyebrow', 'Eyebrow'),
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    text('nameLabel', 'Name label'),
    text('namePlaceholder', 'Name placeholder'),
    text('phoneLabel', 'Phone label'),
    text('phonePlaceholder', 'Phone placeholder'),
    text('volumeLabel', 'Volume label'),
    lines('volumeOptions', 'Volume options'),
    text('noteLabel', 'Note label'),
    text('notePlaceholder', 'Note placeholder'),
    text('submitCta', 'Submit button'),
    text('submittingText', 'Submitting text'),
    text('successHeading', 'Success heading'),
    area('successMessage', 'Success message'),
    area('privacyNote', 'Privacy note'),
    area('consentLabel', 'Consent checkbox text'),
    text('volumeFallback', 'Volume fallback'),
  ],
  proof: [
    text('eyebrow', 'Eyebrow'),
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    text('chromeFeaturedBadge', 'Featured badge'),
    text('chromeWatchInterview', 'Watch interview label'),
    text('chromeWatchCaseStudy', 'Watch case study label'),
  ],
  faqMeta: [
    text('eyebrow', 'Eyebrow'),
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
  ],
  pricingCopy: [
    text('eyebrow', 'Eyebrow'),
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    text('labelPerMonth', 'Per-month label'),
    text('labelTrialNote', 'Trial note label'),
    text('labelCtaLabel', 'CTA label'),
  ],
  gettingStarted: [
    text('eyebrow', 'Eyebrow'),
    text('heading', 'Heading'),
    area('subheading', 'Subheading'),
    text('ctaLabel', 'CTA label'),
    text('step1Title', 'Step 1 title'),
    area('step1Detail', 'Step 1 detail'),
    text('step2Title', 'Step 2 title'),
    area('step2Detail', 'Step 2 detail'),
    text('step3Title', 'Step 3 title'),
    area('step3Detail', 'Step 3 detail'),
  ],
  walkthrough: [
    lines('bullets', 'Bullets'),
    area('trustNote', 'Trust note'),
  ],
  videoSection: [text('youtubeUrl', 'YouTube URL')],
  heroTabs: [
    text('tabLabelAdmin', 'Tab label — Admin'),
    text('tabLabelOperations', 'Tab label — Operations'),
    text('tabLabelPacking', 'Tab label — Packing'),
    text('tabLabelHr', 'Tab label — HR'),
    text('trustedTitle', 'Trusted-by title'),
    area('platformNote', 'Platform note'),
    area('sampleNote', 'Sample data note'),
  ],
  dock: [
    text('helpLabel', 'Help label'),
    text('demoLabel', 'Demo label'),
    text('demoUrl', 'Demo URL'),
    text('callLabel', 'Call label'),
    text('whatsappLabel', 'WhatsApp label'),
    text('messengerLabel', 'Messenger label'),
    text('fabLabel', 'Floating button label'),
  ],
  header: [
    text('ctaStartTrial', 'Start trial button'),
    text('signInLabel', 'Sign in link'),
  ],
  footer: [
    area('tagline', 'Tagline'),
    text('linksTitle', 'Links column title'),
    text('contactTitle', 'Contact column title'),
    text('copyright', 'Copyright line'),
    text('privacyLabel', 'Privacy link label'),
    text('termsLabel', 'Terms link label'),
  ],
};

const NAV_FIELDS: LandingFieldDef[] = [
  text('label', 'Label'),
  text('href', 'Link (anchor, path, or https URL)'),
];

/**
 * Field definitions for one row. Scalar sections (hero/contact/seo)
 * return the single field for that row's key; object sections return
 * the section's full field list (their key is always 'main');
 * capabilities resolve by section id; unknown capability ids fall back
 * to heading + subheading so a new id still gets a usable editor.
 */
export function landingFieldDefs(
  section: string,
  key: string,
): LandingFieldDef[] {
  if (section === 'hero') {
    return HERO_FIELDS.filter((field) => field.name === key);
  }
  if (section === 'contact') {
    return CONTACT_FIELDS.filter((field) => field.name === key);
  }
  if (section === 'seo') {
    return SEO_FIELDS.filter((field) => field.name === key);
  }
  if (section === 'capabilities') {
    return (
      CAPABILITY_FIELDS[key] ?? [
        text('heading', 'Heading'),
        area('subheading', 'Subheading'),
      ]
    );
  }
  if (LANDING_OBJECT_SECTIONS.has(section)) {
    return OBJECT_FIELDS[section] ?? [];
  }
  if (section === 'faq') return FAQ_FIELDS;
  if (section === 'testimonials') return TESTIMONIAL_FIELDS;
  if (section === 'partners') return PARTNER_FIELDS;
  if (section === 'nav' || section === 'footerLinks') return NAV_FIELDS;
  return [];
}

/** All field keys a scalar section can have (for the "add field" picker). */
export function landingScalarFieldNames(section: string): string[] {
  if (section === 'hero') return HERO_FIELDS.map((field) => field.name);
  if (section === 'contact') return CONTACT_FIELDS.map((field) => field.name);
  if (section === 'seo') return SEO_FIELDS.map((field) => field.name);
  return [];
}

export function landingScalarFieldLabel(
  section: string,
  key: string,
): string {
  const def = landingFieldDefs(section, key)[0];
  return def?.label ?? key;
}

/** Same rule as the API (landing-content.constants.ts). */
export const LANDING_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

export function isValidLandingKey(key: string): boolean {
  return key.length > 0 && key.length <= 80 && LANDING_KEY_PATTERN.test(key);
}

/** Build the landing-content list query string from the filter state. */
export function landingContentQueryString(filters: {
  section?: string;
  locale?: string;
  page?: number;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export interface LandingRowGroup {
  key: string;
  sortOrder: number;
  en?: LandingContentRow;
  bn?: LandingContentRow;
}

/**
 * Group rows by key (both locales side by side), ordered by sortOrder
 * then key — the same order the public endpoint serves list items in.
 */
export function groupLandingRows(rows: LandingContentRow[]): LandingRowGroup[] {
  const byKey = new Map<string, LandingRowGroup>();
  for (const row of rows) {
    let group = byKey.get(row.key);
    if (!group) {
      group = { key: row.key, sortOrder: row.sortOrder };
      byKey.set(row.key, group);
    }
    group.sortOrder = Math.min(group.sortOrder, row.sortOrder);
    if (row.locale === 'en') group.en = row;
    else if (row.locale === 'bn') group.bn = row;
  }
  return [...byKey.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
  );
}

/* ------------------------- form value mapping ------------------------- */

export type LandingFormState = Record<string, string>;

function valueAsString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function valueAsLines(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.filter((item) => typeof item === 'string').join('\n');
}

export function metricsToLines(
  value: unknown,
): { text: string; skipped: number } {
  if (!Array.isArray(value)) return { text: '', skipped: 0 };
  const lines: string[] = [];
  let skipped = 0;
  for (const item of value) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { stat?: unknown }).stat === 'string' &&
      typeof (item as { label?: unknown }).label === 'string'
    ) {
      lines.push(
        `${(item as { stat: string }).stat} | ${(item as { label: string }).label}`,
      );
    } else {
      skipped += 1;
    }
  }
  return { text: lines.join('\n'), skipped };
}

/**
 * Parse the metrics textarea ("stat | label" per line). Returns an error
 * naming the first bad line instead of silently dropping it.
 */
export function parseMetricsLines(
  textValue: string,
): { metrics: { stat: string; label: string }[] } | { error: string } {
  const metrics: { stat: string; label: string }[] = [];
  const lines = textValue.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const [stat, ...rest] = line.split('|');
    const label = rest.join('|').trim();
    if (!stat?.trim() || !label) {
      return {
        error: `Metrics line ${index + 1} needs "stat | label" (e.g. "3x | Faster packing").`,
      };
    }
    metrics.push({ stat: stat.trim(), label });
  }
  return { metrics };
}

/** Convert a stored row value into the editor's per-field string state. */
export function landingValueToForm(
  value: unknown,
  defs: LandingFieldDef[],
  scalar: boolean,
): LandingFormState {
  if (scalar) return { __value: valueAsString(value) };
  const object =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const form: LandingFormState = {};
  for (const def of defs) {
    if (def.kind === 'lines') form[def.name] = valueAsLines(object[def.name]);
    else if (def.kind === 'metrics')
      form[def.name] = metricsToLines(object[def.name]).text;
    else form[def.name] = valueAsString(object[def.name]);
  }
  return form;
}

/**
 * Convert editor state back to a storable value. Scalar sections return
 * the string itself (empty → error: the API rejects empty values).
 * Object sections return the field object; empty list fields become [].
 */
export function landingFormToValue(
  form: LandingFormState,
  defs: LandingFieldDef[],
  scalar: boolean,
): { value: unknown } | { error: string } {
  if (scalar) {
    const textValue = (form.__value ?? '').trim();
    if (!textValue) return { error: 'This field cannot be empty.' };
    return { value: textValue };
  }
  const value: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = form[def.name] ?? '';
    if (def.kind === 'lines') {
      value[def.name] = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } else if (def.kind === 'metrics') {
      const parsed = parseMetricsLines(raw);
      if ('error' in parsed) return parsed;
      value[def.name] = parsed.metrics;
    } else {
      value[def.name] = raw.trim();
    }
  }
  return { value };
}
