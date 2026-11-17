import { describe, expect, it } from 'vitest';
import type { LandingContentRow } from '../types';
import {
  CAPABILITY_KEYS,
  groupLandingRows,
  isValidLandingKey,
  landingContentQueryString,
  landingFieldDefs,
  landingFormToValue,
  landingScalarFieldNames,
  landingValueToForm,
  metricsToLines,
  parseMetricsLines,
} from './landing-content';

function row(
  overrides: Partial<LandingContentRow>,
): LandingContentRow {
  return {
    id: 'row-1',
    section: 'faq',
    key: 'faq-1',
    locale: 'en',
    value: {},
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-11-17T00:00:00Z',
    updatedAt: '2026-11-17T00:00:00Z',
    ...overrides,
  };
}

describe('landingFieldDefs', () => {
  it('covers all 10 capability sections with their real fields', () => {
    expect(CAPABILITY_KEYS).toHaveLength(10);
    expect(
      landingFieldDefs('capabilities', 'fragmented').map((f) => f.name),
    ).toEqual(['heading', 'subheading', 'beforeItems', 'afterItems']);
    expect(landingFieldDefs('capabilities', 'packing').map((f) => f.name)).toEqual([
      'heading',
      'subheading',
      'features',
    ]);
    // No-list sections keep heading + subheading only (demo data stays in code).
    expect(landingFieldDefs('capabilities', 'revenue').map((f) => f.name)).toEqual([
      'heading',
      'subheading',
    ]);
    expect(landingFieldDefs('capabilities', 'finance').map((f) => f.name)).toEqual([
      'heading',
      'subheading',
      'paymentsRows',
    ]);
    expect(landingFieldDefs('capabilities', 'stores').map((f) => f.name)).toEqual([
      'heading',
      'subheading',
      'whyItems',
    ]);
  });

  it('falls back to heading + subheading for an unknown capability id', () => {
    expect(landingFieldDefs('capabilities', 'mystery').map((f) => f.name)).toEqual([
      'heading',
      'subheading',
    ]);
  });

  it('returns the single field for a scalar row key', () => {
    expect(landingFieldDefs('hero', 'headlinePart1').map((f) => f.name)).toEqual([
      'headlinePart1',
    ]);
    expect(landingFieldDefs('contact', 'callNumber').map((f) => f.name)).toEqual([
      'callNumber',
    ]);
    expect(landingFieldDefs('hero', 'nope')).toEqual([]);
  });

  it('returns the item fields for list sections', () => {
    expect(landingFieldDefs('faq', 'faq-1').map((f) => f.name)).toEqual([
      'question',
      'answer',
    ]);
    expect(
      landingFieldDefs('testimonials', 'story-x').map((f) => f.name),
    ).toContain('metrics');
    expect(landingFieldDefs('partners', 'partner-x').map((f) => f.name)).toEqual([
      'name',
    ]);
  });

  it('lists the scalar field names for the add picker', () => {
    expect(landingScalarFieldNames('hero')).toContain('headlinePart1');
    expect(landingScalarFieldNames('contact')).toContain('callNumber');
    expect(landingScalarFieldNames('faq')).toEqual([]);
  });
});

describe('isValidLandingKey', () => {
  it('accepts slugs and camelCase field names', () => {
    expect(isValidLandingKey('faq-1')).toBe(true);
    expect(isValidLandingKey('story-aranya-apparel')).toBe(true);
    expect(isValidLandingKey('headlinePart1')).toBe(true);
    expect(isValidLandingKey('callNumber')).toBe(true);
  });

  it('rejects bad keys', () => {
    expect(isValidLandingKey('')).toBe(false);
    expect(isValidLandingKey('faq 1')).toBe(false);
    expect(isValidLandingKey('-faq')).toBe(false);
    expect(isValidLandingKey('faq_1')).toBe(false);
    expect(isValidLandingKey('a'.repeat(81))).toBe(false);
  });
});

describe('landingContentQueryString', () => {
  it('builds the list query', () => {
    expect(landingContentQueryString({ section: 'faq' })).toBe(
      '?section=faq',
    );
    expect(
      landingContentQueryString({ section: 'faq', locale: 'bn', limit: 100 }),
    ).toBe('?section=faq&locale=bn&limit=100');
  });
});

describe('groupLandingRows', () => {
  it('groups both locales by key, ordered by sortOrder then key', () => {
    const groups = groupLandingRows([
      row({ key: 'faq-2', locale: 'en', sortOrder: 1 }),
      row({ key: 'faq-1', locale: 'bn', sortOrder: 0 }),
      row({ key: 'faq-1', locale: 'en', sortOrder: 0 }),
      row({ key: 'faq-3', locale: 'en', sortOrder: 0 }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['faq-1', 'faq-3', 'faq-2']);
    expect(groups[0].en?.locale).toBe('en');
    expect(groups[0].bn?.locale).toBe('bn');
    expect(groups[1].bn).toBeUndefined();
  });
});

describe('landingValueToForm / landingFormToValue', () => {
  it('round-trips an object value with text, lines and metrics', () => {
    const defs = landingFieldDefs('testimonials', 'story-x');
    const value = {
      businessName: 'Aranya',
      founderName: 'Ayesha',
      role: 'Founder',
      location: 'Dhaka',
      website: 'aranya.example',
      quote: 'Great.',
      videoDuration: '2:41',
      videoTitle: 'Story',
      metrics: [{ stat: '3x', label: 'Growth' }],
    };
    const form = landingValueToForm(value, defs, false);
    expect(form.businessName).toBe('Aranya');
    expect(form.metrics).toBe('3x | Growth');
    expect(landingFormToValue(form, defs, false)).toEqual({ value });
  });

  it('round-trips a lines field, dropping blank lines', () => {
    const defs = landingFieldDefs('capabilities', 'packing');
    const form = landingValueToForm(
      { heading: 'H', subheading: 'S', features: ['A', 'B'] },
      defs,
      false,
    );
    expect(form.features).toBe('A\nB');
    const next = landingFormToValue(
      { ...form, features: 'A\n\nB\n' },
      defs,
      false,
    );
    expect(next).toEqual({
      value: { heading: 'H', subheading: 'S', features: ['A', 'B'] },
    });
  });

  it('returns a scalar value as the string itself', () => {
    const defs = landingFieldDefs('hero', 'badge');
    expect(landingValueToForm('Commerce OS', defs, true)).toEqual({
      __value: 'Commerce OS',
    });
    expect(
      landingFormToValue({ __value: '  New badge ' }, defs, true),
    ).toEqual({ value: 'New badge' });
    expect(landingFormToValue({ __value: '   ' }, defs, true)).toEqual({
      error: 'This field cannot be empty.',
    });
  });

  it('tolerates a missing or malformed stored value', () => {
    const defs = landingFieldDefs('faq', 'faq-1');
    expect(landingValueToForm(null, defs, false)).toEqual({
      question: '',
      answer: '',
    });
    expect(landingValueToForm('stray', defs, false)).toEqual({
      question: '',
      answer: '',
    });
  });
});

describe('metrics lines', () => {
  it('serializes metrics and counts skipped rows', () => {
    expect(
      metricsToLines([
        { stat: '3x', label: 'Growth' },
        { stat: '2x' },
        'junk',
      ]),
    ).toEqual({ text: '3x | Growth', skipped: 2 });
  });

  it('parses "stat | label" lines and reports the bad line', () => {
    expect(parseMetricsLines('3x | Growth\n2x | Faster')).toEqual({
      metrics: [
        { stat: '3x', label: 'Growth' },
        { stat: '2x', label: 'Faster' },
      ],
    });
    expect(parseMetricsLines('3x | Growth\nno-pipe-here')).toEqual({
      error:
        'Metrics line 2 needs "stat | label" (e.g. "3x | Faster packing").',
    });
    expect(parseMetricsLines('')).toEqual({ metrics: [] });
  });
});
