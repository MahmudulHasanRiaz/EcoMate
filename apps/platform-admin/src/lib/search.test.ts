import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  clearRecentSearches,
  flattenGroups,
  getRecentSearches,
  MAX_RECENT_SEARCHES,
  parseConsoleLink,
  RECENT_SEARCHES_KEY,
  saveRecentSearch,
  SEARCH_TYPES,
  TYPE_STATUSES,
  type SearchGroup,
} from './search';

function fakeStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  };
}

describe('buildSearchUrl', () => {
  it('encodes the query and defaults the limit', () => {
    expect(buildSearchUrl('e2e test')).toBe(
      '/search?q=e2e+test&limit=5',
    );
  });

  it('adds type and status only when set', () => {
    expect(buildSearchUrl('inv', 'invoice', 'OPEN')).toBe(
      '/search?q=inv&limit=5&type=invoice&status=OPEN',
    );
    expect(buildSearchUrl('inv', 'all', '')).toBe('/search?q=inv&limit=5');
  });
});

describe('flattenGroups', () => {
  it('flattens in display order and skips empty groups', () => {
    const groups: SearchGroup[] = [
      { type: 'tenant', label: 'Tenants', items: [] },
      {
        type: 'invoice',
        label: 'Invoices',
        items: [
          { type: 'invoice', id: '1', title: 'A', subtitle: '', link: '/billing' },
          { type: 'invoice', id: '2', title: 'B', subtitle: '', link: '/billing' },
        ],
      },
      {
        type: 'user',
        label: 'Users',
        items: [
          { type: 'user', id: '3', title: 'C', subtitle: '', link: '/users' },
        ],
      },
    ];
    expect(flattenGroups(groups).map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});

describe('parseConsoleLink', () => {
  it('splits path and query', () => {
    expect(parseConsoleLink('/billing?tab=invoices')).toEqual({
      to: '/billing',
      search: { tab: 'invoices' },
    });
  });

  it('returns a plain path unchanged', () => {
    expect(parseConsoleLink('/tenants/abc')).toEqual({ to: '/tenants/abc' });
  });
});

describe('recent searches', () => {
  it('stores most-recent-first, deduped, capped at 5', () => {
    const store = fakeStore();
    saveRecentSearch('alpha', store);
    saveRecentSearch('beta', store);
    saveRecentSearch('alpha', store);
    expect(getRecentSearches(store)).toEqual(['alpha', 'beta']);
    for (let i = 0; i < MAX_RECENT_SEARCHES + 2; i++) {
      saveRecentSearch(`q${i}`, store);
    }
    const recent = getRecentSearches(store);
    expect(recent).toHaveLength(MAX_RECENT_SEARCHES);
    expect(recent[0]).toBe(`q${MAX_RECENT_SEARCHES + 1}`);
  });

  it('ignores blank queries and tolerates corrupt storage', () => {
    const store = fakeStore();
    saveRecentSearch('   ', store);
    expect(getRecentSearches(store)).toEqual([]);
    store.setItem(RECENT_SEARCHES_KEY, 'not-json');
    expect(getRecentSearches(store)).toEqual([]);
    store.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['a', 1, null]));
    expect(getRecentSearches(store)).toEqual(['a']);
  });

  it('clearRecentSearches removes the key', () => {
    const store = fakeStore();
    saveRecentSearch('alpha', store);
    clearRecentSearches(store);
    expect(getRecentSearches(store)).toEqual([]);
    expect(store.data[RECENT_SEARCHES_KEY]).toBeUndefined();
  });
});

describe('search vocabularies', () => {
  it('every status-filtered type is a known search type', () => {
    const types = new Set(SEARCH_TYPES.map((t) => t.type));
    for (const type of Object.keys(TYPE_STATUSES)) {
      expect(types.has(type)).toBe(true);
    }
  });

  it('status lists are non-empty and unique', () => {
    for (const [type, statuses] of Object.entries(TYPE_STATUSES)) {
      expect(statuses.length, type).toBeGreaterThan(0);
      expect(new Set(statuses).size, type).toBe(statuses.length);
    }
  });
});
