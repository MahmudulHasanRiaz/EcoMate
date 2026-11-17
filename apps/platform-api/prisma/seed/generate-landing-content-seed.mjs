#!/usr/bin/env node
/**
 * Generate prisma/seed/landing-content.json from the ported landing data
 * file (apps/landing/data/landingContent.ts) — the seed/default for the
 * console-managed landing content (plan §13).
 *
 * Run from apps/platform-api:
 *   node ../../node_modules/tsx/dist/cli.mjs prisma/seed/generate-landing-content-seed.mjs
 * (tsx resolves the .ts data import; plain `node` cannot import
 * TypeScript. The repo root already has tsx — no new dependency.)
 *
 * The managed subset (everything else stays in code):
 * - hero: 7 scalar fields, one row per field (value = string)
 * - capabilities: 10 sections, one row per section (value = PARTIAL
 *   section object using the section's REAL field names — the landing
 *   shallow-merges it over the built-in section, non-empty values only)
 * - faq: one row per item (key faq-1..n)
 * - testimonials: one row per case study (key story-<id>)
 * - partners: one row per trusted brand (key partner-<slug>)
 * - contact: 6 scalar fields, one row per field (value = string)
 * Both locales. Re-running overwrites the JSON (the JSON is the seed
 * INPUT; the DB seed itself is create-if-not-exists and never clobbers
 * admin edits).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landingContent } from '../../../landing/data/landingContent.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, 'landing-content.json');

const LOCALES = ['en', 'bn'];

const HERO_FIELDS = [
  'badge',
  'headlinePart1',
  'headlineHighlight',
  'headlinePart2',
  'subtitle',
  'primaryCta',
  'secondaryCta',
];

/**
 * Managed key -> built-in data key -> editable fields (contract
 * correction, 2026-11-17: the 10 sections have heterogeneous list
 * fields, so each section seeds exactly its real fields; list fields
 * stay in code where they are demo data — revenue couriers/policies,
 * logistics stream rows, adDefense modes, omnichannel rows).
 */
const CAPABILITY_SECTIONS = [
  {
    key: 'fragmented',
    dataKey: 'fragmented',
    fields: ['heading', 'subheading', 'beforeItems', 'afterItems'],
  },
  {
    key: 'packing',
    dataKey: 'packingTerminal',
    fields: ['heading', 'subheading', 'features'],
  },
  {
    key: 'revenue',
    dataKey: 'revenueLedger',
    fields: ['heading', 'subheading'],
  },
  {
    key: 'logistics',
    dataKey: 'logistics',
    fields: ['heading', 'subheading'],
  },
  {
    key: 'adDefense',
    dataKey: 'adDefense',
    fields: ['heading', 'subheading'],
  },
  {
    key: 'stores',
    dataKey: 'storefront',
    fields: ['heading', 'subheading', 'whyItems'],
  },
  {
    key: 'omnichannel',
    dataKey: 'omnichannel',
    fields: ['heading', 'subheading'],
  },
  {
    key: 'finance',
    dataKey: 'profitClarity',
    fields: ['heading', 'subheading', 'paymentsRows'],
  },
  {
    key: 'team',
    dataKey: 'teamOps',
    fields: ['heading', 'subheading', 'features'],
  },
  {
    key: 'infra',
    dataKey: 'infraTrack',
    fields: ['heading', 'subheading', 'features'],
  },
];

const CONTACT_FIELDS = [
  { key: 'phone', source: 'footer' },
  { key: 'email', source: 'footer' },
  { key: 'address', source: 'footer' },
  { key: 'whatsapp', source: 'dock' },
  { key: 'messengerUrl', source: 'dock' },
  // tel: target for the dock call action; the landing falls back to
  // contact.phone when this row is absent.
  { key: 'callNumber', source: 'dock' },
];

// Same rule as the API (landing-content.constants.ts): hero/contact keys
// are the landing's camelCase field names, so uppercase is allowed.
const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pick(source, fields) {
  const out = {};
  for (const field of fields) {
    if (source[field] === undefined) {
      throw new Error(`missing field "${field}" on ${JSON.stringify(source).slice(0, 80)}`);
    }
    out[field] = source[field];
  }
  return out;
}

function generate() {
  const rows = [];
  for (const locale of LOCALES) {
    const content = landingContent[locale];
    if (!content) throw new Error(`landingContent has no "${locale}" locale`);

    // hero scalars
    HERO_FIELDS.forEach((field, index) => {
      rows.push({
        section: 'hero',
        key: field,
        locale,
        value: content.hero[field],
        sortOrder: index,
        isActive: true,
      });
    });

    // capabilities (partial section objects, real field names)
    CAPABILITY_SECTIONS.forEach((section, index) => {
      rows.push({
        section: 'capabilities',
        key: section.key,
        locale,
        value: pick(content[section.dataKey], section.fields),
        sortOrder: index,
        isActive: true,
      });
    });

    // faq items
    content.faq.items.forEach((item, index) => {
      rows.push({
        section: 'faq',
        key: `faq-${index + 1}`,
        locale,
        value: { question: item.question, answer: item.answer },
        sortOrder: index,
        isActive: true,
      });
    });

    // testimonials from proof.caseStudies
    content.proof.caseStudies.forEach((study, index) => {
      const value = {
        businessName: study.businessName,
        founderName: study.founderName,
        role: study.role,
        location: study.location,
        website: study.website,
        quote: study.quote,
        metrics: study.metrics ?? [],
      };
      if (study.videoDuration !== undefined) {
        value.videoDuration = study.videoDuration;
      }
      if (study.videoTitle !== undefined) {
        value.videoTitle = study.videoTitle;
      }
      rows.push({
        section: 'testimonials',
        key: `story-${study.id}`,
        locale,
        value,
        sortOrder: index,
        isActive: true,
      });
    });

    // partners from heroTabs.brands
    content.heroTabs.brands.forEach((brand, index) => {
      rows.push({
        section: 'partners',
        key: `partner-${slugify(brand)}`,
        locale,
        value: { name: brand },
        sortOrder: index,
        isActive: true,
      });
    });

    // contact scalars (footer + dock)
    CONTACT_FIELDS.forEach((field, index) => {
      rows.push({
        section: 'contact',
        key: field.key,
        locale,
        value: content[field.source][field.key],
        sortOrder: index,
        isActive: true,
      });
    });
  }

  // Validate every row the same way the API does, so a bad seed can never
  // be generated silently.
  const seen = new Set();
  for (const row of rows) {
    if (!KEY_PATTERN.test(row.key) || row.key.length > 80) {
      throw new Error(`invalid seed key: ${JSON.stringify(row)}`);
    }
    const id = `${row.section}|${row.key}|${row.locale}`;
    if (seen.has(id)) throw new Error(`duplicate seed row: ${id}`);
    seen.add(id);
    if (
      typeof row.value !== 'string' &&
      (typeof row.value !== 'object' ||
        row.value === null ||
        Array.isArray(row.value))
    ) {
      throw new Error(`invalid seed value (must be string or object): ${id}`);
    }
  }

  rows.sort((a, b) =>
    a.locale === b.locale
      ? a.section === b.section
        ? a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
        : a.section.localeCompare(b.section)
      : a.locale.localeCompare(b.locale),
  );
  return rows;
}

const rows = generate();
writeFileSync(OUT_PATH, `${JSON.stringify(rows, null, 2)}\n`);
const bySection = rows.reduce((acc, row) => {
  acc[row.section] = (acc[row.section] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `[landing-seed] wrote ${rows.length} rows to ${OUT_PATH} ` +
    `(${Object.entries(bySection)
      .map(([section, count]) => `${section} ${count}`)
      .join(', ')})`,
);
