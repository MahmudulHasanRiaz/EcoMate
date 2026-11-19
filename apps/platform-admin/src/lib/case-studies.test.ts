import { describe, expect, it } from 'vitest';
import {
  formatMetricLines,
  isValidCaseStudySlug,
  parseMetricLines,
  slugifyTitle,
} from './case-studies';

describe('isValidCaseStudySlug', () => {
  it('accepts lowercase hyphenated slugs', () => {
    expect(isValidCaseStudySlug('dhaka-fashion-house')).toBe(true);
    expect(isValidCaseStudySlug('a1-b2')).toBe(true);
  });

  it('rejects uppercase, spaces, underscores, and edge hyphens', () => {
    expect(isValidCaseStudySlug('Dhaka-Fashion')).toBe(false);
    expect(isValidCaseStudySlug('dhaka fashion')).toBe(false);
    expect(isValidCaseStudySlug('dhaka_fashion')).toBe(false);
    expect(isValidCaseStudySlug('-dhaka-')).toBe(false);
    expect(isValidCaseStudySlug('dhaka--fashion')).toBe(false);
    expect(isValidCaseStudySlug('')).toBe(false);
  });
});

describe('slugifyTitle', () => {
  it('lowercases and hyphenates a title', () => {
    expect(slugifyTitle('Dhaka Fashion House')).toBe('dhaka-fashion-house');
  });

  it('strips punctuation and collapses separators', () => {
    expect(slugifyTitle('  Dhaka & Fashion — House!  ')).toBe(
      'dhaka-fashion-house',
    );
  });

  it('returns an empty string for a title with no slug characters', () => {
    expect(slugifyTitle('!!!')).toBe('');
  });
});

describe('parseMetricLines', () => {
  it('parses stat | label lines and skips blanks', () => {
    const { lines, error } = parseMetricLines(
      '3x | Faster packing\n\n৳2.1M | Monthly GMV',
    );
    expect(error).toBeNull();
    expect(lines).toEqual([
      { stat: '3x', label: 'Faster packing' },
      { stat: '৳2.1M', label: 'Monthly GMV' },
    ]);
  });

  it('accepts an empty textarea as zero metrics', () => {
    const { lines, error } = parseMetricLines('  \n ');
    expect(error).toBeNull();
    expect(lines).toEqual([]);
  });

  it('rejects a line without a pipe', () => {
    const { error } = parseMetricLines('3x faster packing');
    expect(error).toContain('stat | label');
  });

  it('rejects a line with an empty stat or label', () => {
    expect(parseMetricLines('3x | ').error).toContain('both a stat');
    expect(parseMetricLines(' | Faster').error).toContain('both a stat');
  });

  it('rejects more than 6 lines', () => {
    const text = Array.from({ length: 7 }, (_, i) => `${i} | Line ${i}`).join(
      '\n',
    );
    expect(parseMetricLines(text).error).toContain('At most 6');
  });
});

describe('formatMetricLines', () => {
  it('round-trips through parseMetricLines', () => {
    const lines = [
      { stat: '3x', label: 'Faster packing' },
      { stat: '৳2.1M', label: 'Monthly GMV' },
    ];
    expect(parseMetricLines(formatMetricLines(lines)).lines).toEqual(lines);
  });

  it('formats an empty list as an empty string', () => {
    expect(formatMetricLines([])).toBe('');
  });
});
