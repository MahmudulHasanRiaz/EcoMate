import { describe, expect, it } from 'vitest';
import {
  NAV_COLLAPSED_KEY,
  readNavCollapsed,
  writeNavCollapsed,
  type KeyValueStore,
} from './nav-collapse';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe('nav-collapse pin', () => {
  it('defaults to expanded when nothing is stored', () => {
    expect(readNavCollapsed(memoryStore())).toBe(false);
  });

  it('reads a stored "true" as collapsed', () => {
    expect(
      readNavCollapsed(memoryStore({ [NAV_COLLAPSED_KEY]: 'true' })),
    ).toBe(true);
  });

  it('reads a stored "false" as expanded', () => {
    expect(
      readNavCollapsed(memoryStore({ [NAV_COLLAPSED_KEY]: 'false' })),
    ).toBe(false);
  });

  it('treats a garbage stored value as expanded', () => {
    expect(
      readNavCollapsed(memoryStore({ [NAV_COLLAPSED_KEY]: 'yes' })),
    ).toBe(false);
  });

  it('persists a toggle and reads it back', () => {
    const store = memoryStore();
    writeNavCollapsed(true, store);
    expect(readNavCollapsed(store)).toBe(true);
    writeNavCollapsed(false, store);
    expect(readNavCollapsed(store)).toBe(false);
    expect(store.getItem(NAV_COLLAPSED_KEY)).toBe('false');
  });

  it('survives an unavailable store', () => {
    expect(readNavCollapsed(null)).toBe(false);
    expect(() => writeNavCollapsed(true, null)).not.toThrow();
  });
});
