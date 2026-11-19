import { describe, expect, it } from 'vitest';
import {
  blogQueryString,
  blogStatusLabel,
  flattenCategories,
  slugify,
} from './blog';

describe('slugify', () => {
  it('lowercases, hyphenates, strips accents and trims hyphens', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('  Café & POS — Guide  ')).toBe('cafe-pos-guide');
    expect(slugify('বাংলা শিরোনাম')).toBe('');
    expect(slugify('a--b')).toBe('a-b');
  });
});

describe('blogStatusLabel', () => {
  it('shows the effective status, with the stored one when they differ', () => {
    expect(
      blogStatusLabel({ status: 'published', effectiveStatus: 'published' }),
    ).toBe('Published');
    expect(
      blogStatusLabel({ status: 'scheduled', effectiveStatus: 'published' }),
    ).toBe('Published (Scheduled)');
    expect(
      blogStatusLabel({ status: 'scheduled', effectiveStatus: 'scheduled' }),
    ).toBe('Scheduled');
  });
});

describe('flattenCategories', () => {
  it('flattens a tree with depth indentation', () => {
    const tree: any = [
      {
        id: 'root',
        nameEn: 'Root',
        children: [
          {
            id: 'child',
            nameEn: 'Child',
            children: [{ id: 'grand', nameEn: 'Grand', children: [] }],
          },
        ],
      },
      { id: 'other', nameEn: 'Other', children: [] },
    ];
    expect(flattenCategories(tree)).toEqual([
      { id: 'root', label: 'Root' },
      { id: 'child', label: '— Child' },
      { id: 'grand', label: '— — Grand' },
      { id: 'other', label: 'Other' },
    ]);
  });
});

describe('blogQueryString', () => {
  it('skips empty values and encodes the rest', () => {
    expect(
      blogQueryString({ page: 2, status: '', search: 'a b' }),
    ).toBe('?page=2&search=a+b');
    expect(blogQueryString({})).toBe('');
  });
});
