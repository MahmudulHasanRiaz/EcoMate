import { describe, expect, it } from 'vitest';
import {
  featuresQueryString,
  filterFeatures,
  groupFeaturesByCategory,
  kindBadgeTone,
  kindLabel,
  unknownFeatureKeys,
} from './features';
import type { FeatureSummary } from '../types';

function feature(
  key: string,
  overrides: Partial<FeatureSummary> = {},
): FeatureSummary {
  return {
    key,
    name: key,
    category: 'A: Storefront',
    dependencies: [],
    isActive: true,
    sortOrder: 0,
    kind: 'initial',
    ...overrides,
  };
}

describe('featuresQueryString', () => {
  it('builds an empty query for no filters', () => {
    expect(featuresQueryString({})).toBe('');
  });

  it('encodes kind, category, and search', () => {
    expect(
      featuresQueryString({
        kind: 'add-on',
        category: 'O: Infrastructure',
        search: 'smtp',
      }),
    ).toBe('?kind=add-on&category=O%3A+Infrastructure&search=smtp');
  });
});

describe('kindBadgeTone / kindLabel', () => {
  it('marks add-ons with the indigo accent tone, initial as neutral', () => {
    expect(kindBadgeTone('add-on')).toBe('accent');
    expect(kindBadgeTone('initial')).toBe('neutral');
    expect(kindLabel('add-on')).toBe('Add-on');
    expect(kindLabel('initial')).toBe('Initial');
  });
});

describe('groupFeaturesByCategory', () => {
  it('groups by category in catalogue (alphabetical) order', () => {
    const groups = groupFeaturesByCategory([
      feature('smtp_server', { category: 'O: Infrastructure' }),
      feature('storefront', { category: 'A: Storefront' }),
      feature('pos_system', { category: 'O: Infrastructure' }),
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      'A: Storefront',
      'O: Infrastructure',
    ]);
    expect(groups[1].features.map((f) => f.key)).toEqual([
      'smtp_server',
      'pos_system',
    ]);
  });
});

describe('filterFeatures', () => {
  const all = [
    feature('storefront', { name: 'Storefront', kind: 'add-on' }),
    feature('admin_products', {
      name: 'Admin Products',
      category: 'E: Core Admin — Operation',
    }),
    feature('smtp_server', {
      name: 'Smtp Server',
      kind: 'add-on',
      category: 'O: Infrastructure',
    }),
  ];

  it('filters by kind', () => {
    expect(filterFeatures(all, { kind: 'add-on' }).map((f) => f.key)).toEqual([
      'storefront',
      'smtp_server',
    ]);
  });

  it('filters by category', () => {
    expect(
      filterFeatures(all, { category: 'O: Infrastructure' }).map((f) => f.key),
    ).toEqual(['smtp_server']);
  });

  it('searches key and name, case-insensitively', () => {
    expect(filterFeatures(all, { search: 'SMTP' }).map((f) => f.key)).toEqual([
      'smtp_server',
    ]);
    expect(filterFeatures(all, { search: 'admin' }).map((f) => f.key)).toEqual([
      'admin_products',
    ]);
  });
});

describe('unknownFeatureKeys', () => {
  it('reports saved keys that are not in the catalogue (e.g. the * wildcard)', () => {
    const catalogue = [feature('storefront'), feature('admin_products')];
    expect(
      unknownFeatureKeys(
        ['storefront', '*', 'legacy_key'],
        catalogue,
      ),
    ).toEqual(['*', 'legacy_key']);
  });

  it('returns an empty list when everything is known', () => {
    expect(
      unknownFeatureKeys(['storefront'], [feature('storefront')]),
    ).toEqual([]);
  });
});
