/**
 * Managed landing content (Landing CMS).
 *
 * The platform console edits landing copy; the landing fetches it from
 * GET /public/landing-content (server-side, 5-minute revalidate) and
 * merges it over the built-in fallback in data/landingContent.ts. The
 * fetch never throws: API down, empty DB, or malformed rows all fall
 * back to the built-in content — the landing never breaks.
 *
 * Merge rule (redesign plan §13):
 * - hero / contact: per-field override (non-empty strings only).
 * - capabilities: shallow per-field override per section (non-empty
 *   string or string-array, type-checked against the built-in field).
 * - faq / testimonials / partners: full-list replace when the managed
 *   list is non-empty.
 * - a section absent from the managed payload keeps the built-in copy.
 */
import type {
  CaseStudy,
  LandingContent,
  Locale,
} from '@/lib/landingTypes';

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

export interface ManagedLocaleContent {
  hero?: Record<string, unknown>;
  capabilities?: Record<string, Record<string, unknown>>;
  faq?: ManagedFaqItem[];
  testimonials?: ManagedTestimonial[];
  partners?: ManagedPartner[];
  contact?: Record<string, unknown>;
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
        next: { revalidate: 300 },
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

function isPartner(value: unknown): value is ManagedPartner {
  if (!isRecord(value)) return false;
  return typeof value.key === 'string' && isNonEmptyString(value.name);
}

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
    const hero = { ...fallback.hero };
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
      const base = fallback[dataKey] as unknown as Record<string, unknown>;
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

  // FAQ: full-list replace when the managed list is non-empty.
  if (Array.isArray(managed.faq) && managed.faq.length > 0) {
    const items = managed.faq
      .filter(isFaqItem)
      .map(({ question, answer }) => ({ question, answer }));
    if (items.length > 0) merged.faq = { ...fallback.faq, items };
  }

  // Testimonials: full-list replace, mapped onto the case-study shape.
  // Managed stories carry no challenge/solution/category — Trust only
  // renders the fields below.
  if (
    Array.isArray(managed.testimonials) &&
    managed.testimonials.length > 0
  ) {
    const studies: CaseStudy[] = managed.testimonials
      .filter(isManagedTestimonial)
      .map((t) => ({
        id: t.key,
        businessName: t.businessName,
        category: '',
        location: t.location,
        founderName: t.founderName,
        role: t.role,
        website: t.website,
        quote: t.quote,
        metrics: Array.isArray(t.metrics) ? t.metrics : [],
        challenge: '',
        solution: '',
        videoDuration: t.videoDuration,
        videoTitle: t.videoTitle,
      }));
    if (studies.length > 0) {
      merged.proof = { ...fallback.proof, caseStudies: studies };
    }
  }

  // Partners: full-list replace of the hero trust-strip brands.
  if (Array.isArray(managed.partners) && managed.partners.length > 0) {
    const brands = managed.partners
      .filter(isPartner)
      .map((p) => p.name)
      .filter((name) => name.trim().length > 0);
    if (brands.length > 0) {
      merged.heroTabs = { ...fallback.heroTabs, brands };
    }
  }

  // Contact: per-field override into the footer + dock. The dock's
  // call number follows the phone unless a separate callNumber is set.
  if (isRecord(managed.contact)) {
    const contact = managed.contact;
    const footer = { ...fallback.footer };
    const dock = { ...fallback.dock };
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

  return merged;
}
