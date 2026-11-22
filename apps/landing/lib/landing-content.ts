/**
 * Managed landing content (Landing CMS).
 *
 * The platform console edits landing copy; the landing fetches it from
 * GET /public/landing-content (server-side, 5-minute revalidate) and
 * merges it over the built-in fallback in data/landingContent.ts. The
 * fetch never throws: API down, empty DB, or malformed rows all fall
 * back to the built-in content — the landing never breaks.
 *
 * Merge rule (redesign plan §13, extended in Landing CMS Batch 1):
 * - hero / contact / seo: per-field override (non-empty strings only).
 * - object sections (leadForm, proof, faqMeta, pricingCopy,
 *   gettingStarted, walkthrough, videoSection, heroTabs, dock, header,
 *   footer): per-field override of the flat managed object — string
 *   fields override when non-empty, string-list fields (volumeOptions,
 *   bullets) override when a non-empty string array.
 * - capabilities: shallow per-field override per section (non-empty
 *   string or string-array, type-checked against the built-in field).
 * - faq / testimonials / partners / nav / footerLinks: full-list
 *   replace when the managed list is non-empty.
 * - visibility: `{ sectionId: { visible } }` map → `content.visibility`
 *   (a missing id is visible; only boolean values are trusted).
 * - a section absent from the managed payload keeps the built-in copy.
 *
 * Legal documents (item 22) are NOT part of this merge: the /privacy
 * and /terms pages fetch their own blocks via fetchManagedLegal.
 *
 * Every merge step spreads the CURRENT merged state (never the raw
 * fallback), so a copy merge and a list merge on the same top-level
 * key (faq copy + faq items, proof copy + testimonials, heroTabs copy
 * + partners, footer copy + contact) compose instead of clobbering.
 */
import type {
  CaseStudy,
  LandingContent,
  Locale,
  NavItem,
} from '@/lib/landingTypes';
import { isCaseStudySlug } from './case-studies';

export interface ManagedTestimonial {
  key: string;
  businessName: string;
  founderName: string;
  role: string;
  location: string;
  website: string;
  quote: string;
  videoDuration: string;
  videoTitle: string;
  metrics: { stat: string; label: string }[];
  /**
   * Optional slug of a published case study (/case-studies/<slug>)
   * this testimonial links to from its text-review card. Follow-up:
   * the console has no field for it yet (the testimonial field defs
   * in platform-admin belong to the item-14 group) — until then it
   * can only be set via the landing-content API directly.
   */
  caseStudySlug?: string;
  /**
   * CMS Batch 2, item 14 — all optional. category/challenge/solution
   * used to be forced to '' in the merge; they now pass through when
   * the row carries them. rating is 1–5 (a number or numeric string);
   * format is one of text/image/video_short/video_standard.
   */
  category?: string;
  challenge?: string;
  solution?: string;
  format?: string;
  videoUrl?: string;
  imageUrl?: string;
  logoUrl?: string;
  rating?: number | string;
}

export interface ManagedFaqItem {
  key: string;
  question: string;
  answer: string;
}

export interface ManagedPartner {
  key: string;
  name: string;
}

export interface ManagedNavItem {
  key: string;
  label: string;
  href: string;
}

/**
 * Managed section visibility (CMS Batch 2, item 11): one
 * `{ visible: boolean }` row per page-section id, 'en' locale only
 * (visibility is locale-independent — the provider injects the 'en'
 * map into every locale's merge). A missing id means visible.
 */
export type ManagedVisibility = Record<string, { visible?: unknown }>;

export interface ManagedLocaleContent {
  hero?: Record<string, unknown>;
  capabilities?: Record<string, Record<string, unknown>>;
  faq?: ManagedFaqItem[];
  testimonials?: ManagedTestimonial[];
  partners?: ManagedPartner[];
  contact?: Record<string, unknown>;
  seo?: Record<string, unknown>;
  leadForm?: Record<string, unknown>;
  proof?: Record<string, unknown>;
  faqMeta?: Record<string, unknown>;
  pricingCopy?: Record<string, unknown>;
  gettingStarted?: Record<string, unknown>;
  walkthrough?: Record<string, unknown>;
  videoSection?: Record<string, unknown>;
  heroTabs?: Record<string, unknown>;
  dock?: Record<string, unknown>;
  header?: Record<string, unknown>;
  nav?: ManagedNavItem[];
  footer?: Record<string, unknown>;
  footerLinks?: ManagedNavItem[];
  visibility?: ManagedVisibility;
}

export type ManagedLandingContent = Partial<
  Record<Locale, ManagedLocaleContent>
>;

function platformApiBase(): string {
  const configured = (
    process.env.PLATFORM_API_URL || 'http://localhost:4100/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManagedLandingContent(
  value: unknown,
): value is ManagedLandingContent {
  if (!isRecord(value)) return false;
  for (const locale of ['en', 'bn'] as const) {
    if (locale in value && !isRecord(value[locale])) return false;
  }
  return true;
}

/** Server-side fetch of the managed content payload. Never throws. */
export async function fetchManagedLandingContent(): Promise<ManagedLandingContent | null> {
  try {
    const response = await fetch(
      `${platformApiBase()}/public/landing-content`,
      {
        // Managed copy changes rarely; a 5-minute cache keeps the landing
        // fast and keeps a downed API from taking the page down with it.
        // Tagged so the cache purge revalidates it immediately.
        next: { revalidate: 300, tags: ['landing-content'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isManagedLandingContent(data) ? data : null;
  } catch {
    return null;
  }
}

/** One managed legal block (CMS Batch 2, item 22). */
export interface ManagedLegalBlock {
  key: string;
  heading: string;
  body: string;
}

/** One managed legal document: blocks in order + latest row update. */
export interface ManagedLegal {
  doc: 'privacy' | 'terms';
  locale: Locale;
  blocks: ManagedLegalBlock[];
  /** ISO timestamp of the latest contributing row update, or null. */
  updatedAt: string | null;
}

function isManagedLegalBlock(value: unknown): value is ManagedLegalBlock {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    isNonEmptyString(value.heading) &&
    isNonEmptyString(value.body)
  );
}

/**
 * Server-side fetch of one managed legal document
 * (GET /public/landing-content/legal/:doc). Never throws: an unreachable
 * API, a malformed payload, or zero usable blocks all return null and
 * the page falls back to its hardcoded copy.
 */
export async function fetchManagedLegal(
  doc: 'privacy' | 'terms',
  locale: Locale = 'en',
): Promise<ManagedLegal | null> {
  try {
    const response = await fetch(
      `${platformApiBase()}/public/landing-content/legal/${doc}?locale=${locale}`,
      {
        next: { revalidate: 300, tags: ['landing-content'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.blocks)) return null;
    const blocks = data.blocks.filter(isManagedLegalBlock);
    if (blocks.length === 0) return null;
    const updatedAt =
      typeof data.updatedAt === 'string' &&
      !Number.isNaN(Date.parse(data.updatedAt))
        ? data.updatedAt
        : null;
    return { doc, locale, blocks, updatedAt };
  } catch {
    return null;
  }
}

/** Managed capability key → built-in data key (see plan §13). */
const CAPABILITY_SECTIONS: Record<string, keyof LandingContent> = {
  fragmented: 'fragmented',
  packing: 'packingTerminal',
  revenue: 'revenueLedger',
  logistics: 'logistics',
  adDefense: 'adDefense',
  stores: 'storefront',
  omnichannel: 'omnichannel',
  finance: 'profitClarity',
  team: 'teamOps',
  infra: 'infraTrack',
};

const HERO_FIELDS = [
  'badge',
  'headlinePart1',
  'headlineHighlight',
  'headlinePart2',
  'subtitle',
  'primaryCta',
  'secondaryCta',
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((el) => typeof el === 'string')
  );
}

function isFaqItem(value: unknown): value is ManagedFaqItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    isNonEmptyString(value.question) &&
    isNonEmptyString(value.answer)
  );
}

function isManagedTestimonial(value: unknown): value is ManagedTestimonial {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    isNonEmptyString(value.businessName) &&
    isNonEmptyString(value.quote)
  );
}

const TESTIMONIAL_FORMATS = [
  'text',
  'image',
  'video_short',
  'video_standard',
] as const;

/** One of the four testimonial formats, or undefined when unset/invalid. */
function parseTestimonialFormat(
  value: unknown,
): (typeof TESTIMONIAL_FORMATS)[number] | undefined {
  return typeof value === 'string' &&
    (TESTIMONIAL_FORMATS as readonly string[]).includes(value)
    ? (value as (typeof TESTIMONIAL_FORMATS)[number])
    : undefined;
}

/**
 * A testimonial media URL: https URLs and same-origin paths pass
 * through; anything else (javascript:, data:, protocol-relative) is
 * dropped — a managed value must never become an XSS vector in an
 * <img> src or iframe.
 */
function optionalUrl(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A testimonial rating: an integer 1–5 (a number or numeric string).
 * Out-of-range, fractional, and non-numeric values are dropped, not
 * clamped — a bad rating renders as no rating.
 */
function parseTestimonialRating(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5
    ? parsed
    : undefined;
}

function isPartner(value: unknown): value is ManagedPartner {
  if (!isRecord(value)) return false;
  return typeof value.key === 'string' && isNonEmptyString(value.name);
}

/**
 * A nav/footer href is safe as a same-page anchor, a same-origin path,
 * or an https URL. Anything else (javascript:, protocol-relative,
 * http:) is dropped — a managed link must never become an XSS vector.
 */
export function isSafeHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('#')) return href.length > 1;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}

function isNavItem(value: unknown): value is ManagedNavItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    isNonEmptyString(value.label) &&
    typeof value.href === 'string' &&
    isSafeHref(value.href)
  );
}

function validNavItems(value: unknown): NavItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isNavItem)
    .map(({ label, href }) => ({ label: label.trim(), href: href.trim() }));
}

/**
 * Override the named string fields of `target` from `source` (non-empty
 * strings only). Returns a new object; `target` is untouched.
 */
function overrideStrings<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
  fields: readonly string[],
): T {
  const next = { ...target };
  for (const field of fields) {
    const value = source[field];
    if (isNonEmptyString(value) && typeof next[field] === 'string') {
      (next as Record<string, unknown>)[field] = value;
    }
  }
  return next;
}

const LEAD_FORM_FIELDS = [
  'eyebrow',
  'heading',
  'subheading',
  'nameLabel',
  'namePlaceholder',
  'phoneLabel',
  'phonePlaceholder',
  'volumeLabel',
  'noteLabel',
  'notePlaceholder',
  'submitCta',
  'submittingText',
  'successHeading',
  'successMessage',
  'privacyNote',
  'consentLabel',
  'volumeFallback',
] as const;

/**
 * Merge one locale's managed content over the built-in fallback.
 * Pure and defensive: unknown fields, wrong types, and empty values are
 * ignored, so a bad payload can never break the page.
 */
export function mergeLandingContent(
  fallback: LandingContent,
  managed: ManagedLocaleContent | undefined,
): LandingContent {
  if (!managed) return fallback;
  const merged: LandingContent = { ...fallback };

  // Hero: per-field override of the scalar fields.
  if (isRecord(managed.hero)) {
    const hero = { ...merged.hero };
    for (const field of HERO_FIELDS) {
      const value = managed.hero[field];
      if (isNonEmptyString(value)) hero[field] = value;
    }
    merged.hero = hero;
  }

  // Capabilities: shallow per-field override. Only string fields and
  // string-list fields are overridable — object lists (couriers, modes,
  // demo rows) are demo data that stays in code.
  if (isRecord(managed.capabilities)) {
    for (const [managedKey, dataKey] of Object.entries(CAPABILITY_SECTIONS)) {
      const value = managed.capabilities[managedKey];
      if (!isRecord(value)) continue;
      const base = merged[dataKey] as unknown as Record<string, unknown>;
      const next: Record<string, unknown> = { ...base };
      for (const [field, fieldValue] of Object.entries(value)) {
        if (!(field in base)) continue;
        if (
          isNonEmptyString(fieldValue) &&
          typeof base[field] === 'string'
        ) {
          next[field] = fieldValue;
        } else if (
          isStringArray(fieldValue) &&
          Array.isArray(base[field]) &&
          base[field].every((el) => typeof el === 'string')
        ) {
          next[field] = fieldValue;
        }
      }
      (merged as unknown as Record<string, unknown>)[dataKey] = next;
    }
  }

  // Lead form: per-field override + volume options (string list).
  if (isRecord(managed.leadForm)) {
    const form = overrideStrings(
      merged.leadForm,
      managed.leadForm,
      LEAD_FORM_FIELDS,
    );
    const options = managed.leadForm.volumeOptions;
    if (isStringArray(options)) form.volumeOptions = options;
    merged.leadForm = form;
  }

  // Proof section copy: eyebrow/heading/subheading + the rendered
  // chrome labels (flat chrome* fields map into proof.chrome).
  if (isRecord(managed.proof)) {
    const proof = overrideStrings(merged.proof, managed.proof, [
      'eyebrow',
      'heading',
      'subheading',
    ]);
    const chrome = { ...proof.chrome };
    const chromeMap: Record<string, keyof typeof chrome> = {
      chromeFeaturedBadge: 'featuredBadge',
      chromeWatchInterview: 'watchInterview',
      chromeWatchCaseStudy: 'watchCaseStudy',
    };
    for (const [field, target] of Object.entries(chromeMap)) {
      if (isNonEmptyString(managed.proof[field])) {
        chrome[target] = managed.proof[field];
      }
    }
    merged.proof = { ...proof, chrome };
  }

  // FAQ section copy (items merge below).
  if (isRecord(managed.faqMeta)) {
    merged.faq = overrideStrings(merged.faq, managed.faqMeta, [
      'eyebrow',
      'heading',
      'subheading',
    ]);
  }

  // Pricing section copy + the rendered price labels.
  if (isRecord(managed.pricingCopy)) {
    const pricing = overrideStrings(merged.pricing, managed.pricingCopy, [
      'eyebrow',
      'heading',
      'subheading',
    ]);
    const labels = { ...pricing.labels };
    const labelMap: Record<string, keyof typeof labels> = {
      labelPerMonth: 'perMonth',
      labelTrialNote: 'trialNote',
      labelCtaLabel: 'ctaLabel',
    };
    for (const [field, target] of Object.entries(labelMap)) {
      if (isNonEmptyString(managed.pricingCopy[field])) {
        labels[target] = managed.pricingCopy[field];
      }
    }
    merged.pricing = { ...pricing, labels };
  }

  // Getting started: copy + the three step title/detail pairs (flat
  // stepNTitle/stepNDetail fields map onto steps[N-1]).
  if (isRecord(managed.gettingStarted)) {
    const getting = overrideStrings(
      merged.gettingStarted,
      managed.gettingStarted,
      ['eyebrow', 'heading', 'subheading', 'ctaLabel'],
    );
    const steps = getting.steps.map((step, index) => {
      const next = { ...step };
      const title = managed.gettingStarted?.[`step${index + 1}Title`];
      const detail = managed.gettingStarted?.[`step${index + 1}Detail`];
      if (isNonEmptyString(title)) next.title = title;
      if (isNonEmptyString(detail)) next.detail = detail;
      return next;
    });
    merged.gettingStarted = { ...getting, steps };
  }

  // Walkthrough bullets + trust note.
  if (isRecord(managed.walkthrough)) {
    const walkthrough = overrideStrings(
      merged.walkthrough,
      managed.walkthrough,
      ['trustNote'],
    );
    const bullets = managed.walkthrough.bullets;
    if (isStringArray(bullets)) walkthrough.bullets = bullets;
    merged.walkthrough = walkthrough;
  }

  // Video section: the YouTube URL (empty = no embed, as built-in).
  if (isRecord(managed.videoSection)) {
    merged.videoSection = overrideStrings(
      merged.videoSection,
      managed.videoSection,
      ['youtubeUrl'],
    );
  }

  // Hero tabs: tab labels (by tab id) + the strip copy. Brands merge
  // below via partners.
  if (isRecord(managed.heroTabs)) {
    const tabs = overrideStrings(merged.heroTabs, managed.heroTabs, [
      'trustedTitle',
      'platformNote',
      'sampleNote',
    ]);
    const labelMap: Record<string, string> = {
      tabLabelAdmin: 'admin',
      tabLabelOperations: 'operations',
      tabLabelPacking: 'packing',
      tabLabelHr: 'hr',
    };
    const tabList = tabs.tabs.map((tab) => {
      const next = { ...tab };
      for (const [field, id] of Object.entries(labelMap)) {
        if (tab.id === id && isNonEmptyString(managed.heroTabs?.[field])) {
          next.label = managed.heroTabs[field] as string;
        }
      }
      return next;
    });
    merged.heroTabs = { ...tabs, tabs: tabList };
  }

  // Dock labels only — call/WhatsApp/Messenger VALUES come from the
  // contact section (merged last) and are never touched here.
  if (isRecord(managed.dock)) {
    merged.dock = overrideStrings(merged.dock, managed.dock, [
      'helpLabel',
      'demoLabel',
      'demoUrl',
      'callLabel',
      'whatsappLabel',
      'messengerLabel',
      'fabLabel',
    ]);
  }

  // Header labels (nav items merge below).
  if (isRecord(managed.header)) {
    merged.header = overrideStrings(merged.header, managed.header, [
      'ctaStartTrial',
      'signInLabel',
    ]);
  }

  // Footer copy (phone/email/address merge below via contact).
  if (isRecord(managed.footer)) {
    merged.footer = overrideStrings(merged.footer, managed.footer, [
      'tagline',
      'linksTitle',
      'contactTitle',
      'copyright',
      'privacyLabel',
      'termsLabel',
    ]);
  }

  // FAQ: full-list replace when the managed list is non-empty.
  if (Array.isArray(managed.faq) && managed.faq.length > 0) {
    const items = managed.faq
      .filter(isFaqItem)
      .map(({ question, answer }) => ({ question, answer }));
    if (items.length > 0) merged.faq = { ...merged.faq, items };
  }

  // Testimonials: full-list replace, mapped onto the case-study shape.
  // CMS Batch 2, item 14: category/challenge/solution pass through
  // when the row carries them (they used to be forced to ''), plus
  // the extended fields (format/videoUrl/imageUrl/logoUrl/rating).
  //
  // The managed list is now legacy input for the text-review
  // FALLBACK only (MkTextReviews renders it when no published
  // ClientReview exists). New reviews come from GET
  // /public/client-reviews (lib/client-reviews.ts), managed in the
  // console at Website → Client Reviews.
  if (
    Array.isArray(managed.testimonials) &&
    managed.testimonials.length > 0
  ) {
    const studies: CaseStudy[] = managed.testimonials
      .filter(isManagedTestimonial)
      .map((t) => ({
        id: t.key,
        businessName: t.businessName,
        category:
          typeof t.category === 'string' ? t.category : '',
        location: t.location,
        founderName: t.founderName,
        role: t.role,
        website: t.website,
        quote: t.quote,
        metrics: Array.isArray(t.metrics) ? t.metrics : [],
        challenge:
          typeof t.challenge === 'string' ? t.challenge : '',
        solution:
          typeof t.solution === 'string' ? t.solution : '',
        videoDuration: t.videoDuration,
        videoTitle: t.videoTitle,
        // Only a well-formed slug becomes a review-card link; anything
        // else is dropped (a managed value must never build a bad URL).
        caseStudySlug: isCaseStudySlug(t.caseStudySlug)
          ? t.caseStudySlug
          : undefined,
        format: parseTestimonialFormat(t.format),
        videoUrl: optionalUrl(t.videoUrl),
        imageUrl: optionalUrl(t.imageUrl),
        logoUrl: optionalUrl(t.logoUrl),
        rating: parseTestimonialRating(t.rating),
      }));
    if (studies.length > 0) {
      merged.proof = { ...merged.proof, caseStudies: studies };
    }
  }

  // Partners: full-list replace of the hero trust-strip brands.
  if (Array.isArray(managed.partners) && managed.partners.length > 0) {
    const brands = managed.partners
      .filter(isPartner)
      .map((p) => p.name)
      .filter((name) => name.trim().length > 0);
    if (brands.length > 0) {
      merged.heroTabs = { ...merged.heroTabs, brands };
    }
  }

  // Nav: full-list replace of the header nav (unsafe hrefs dropped).
  // The R-PRICING-NAV rule lives in Chrome.tsx and still applies on top.
  const nav = validNavItems(managed.nav);
  if (nav.length > 0) {
    merged.header = { ...merged.header, nav };
  }

  // Footer links: full-list replace of the footer capabilities column.
  const footerLinks = validNavItems(managed.footerLinks);
  if (footerLinks.length > 0) {
    merged.footer = { ...merged.footer, capabilities: footerLinks };
  }

  // Contact: per-field override into the footer + dock. The dock's
  // call number follows the phone unless a separate callNumber is set.
  // Spreads the CURRENT merged footer/dock so the footer-copy and
  // dock-label merges above survive.
  if (isRecord(managed.contact)) {
    const contact = managed.contact;
    const footer = { ...merged.footer };
    const dock = { ...merged.dock };
    if (isNonEmptyString(contact.phone)) {
      footer.phone = contact.phone;
      dock.callNumber = contact.phone;
    }
    if (isNonEmptyString(contact.email)) footer.email = contact.email;
    if (isNonEmptyString(contact.address)) footer.address = contact.address;
    if (isNonEmptyString(contact.whatsapp)) dock.whatsapp = contact.whatsapp;
    if (isNonEmptyString(contact.messengerUrl)) {
      dock.messengerUrl = contact.messengerUrl;
    }
    if (isNonEmptyString(contact.callNumber)) {
      dock.callNumber = contact.callNumber;
    }
    merged.footer = footer;
    merged.dock = dock;
  }

  // Section visibility (CMS Batch 2, item 11): only boolean `visible`
  // values are trusted — a malformed row fails OPEN (section stays
  // visible) so a bad payload can never hide a section. A missing id
  // is visible too; the provider injects the 'en' map for every locale.
  if (isRecord(managed.visibility)) {
    const visibility: Record<string, boolean> = {};
    for (const [sectionId, row] of Object.entries(managed.visibility)) {
      if (isRecord(row) && typeof row.visible === 'boolean') {
        visibility[sectionId] = row.visible;
      }
    }
    merged.visibility = visibility;
  }

  return merged;
}
