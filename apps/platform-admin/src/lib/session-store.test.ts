import { describe, expect, it } from 'vitest';
import {
  readSession,
  writeSession,
  SESSION_STORAGE_KEY,
  type KeyValueStore,
} from './session-store';
import type { Session } from '../types';

function memoryStore(entries: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const SESSION: Session = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: {
    id: 'u1',
    email: 'op@example.com',
    name: 'Op',
    role: 'SUPERADMIN',
    status: 'ACTIVE',
  },
};

describe('console session store (R-SESSION)', () => {
  it('reads a session from localStorage', () => {
    const primary = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(SESSION),
    });
    expect(readSession(primary, memoryStore())).toEqual(SESSION);
  });

  it('returns null when both stores are empty', () => {
    expect(readSession(memoryStore(), memoryStore())).toBeNull();
  });

  it('rejects a malformed or incomplete stored session', () => {
    const primary = memoryStore({ [SESSION_STORAGE_KEY]: '{"accessToken":' });
    expect(readSession(primary, memoryStore())).toBeNull();
    const incomplete = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify({ accessToken: 'x' }),
    });
    expect(readSession(incomplete, memoryStore())).toBeNull();
  });

  it('migrates a legacy sessionStorage session to localStorage', () => {
    const primary = memoryStore();
    const legacy = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(SESSION),
    });
    expect(readSession(primary, legacy)).toEqual(SESSION);
    // Migrated into localStorage and removed from sessionStorage.
    expect(primary.getItem(SESSION_STORAGE_KEY)).toBe(
      JSON.stringify(SESSION),
    );
    expect(legacy.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('prefers localStorage over a stale sessionStorage copy', () => {
    const newer: Session = { ...SESSION, accessToken: 'access-2' };
    const primary = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(newer),
    });
    const legacy = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(SESSION),
    });
    expect(readSession(primary, legacy)).toEqual(newer);
  });

  it('writes to localStorage and drops the legacy copy', () => {
    const primary = memoryStore();
    const legacy = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(SESSION),
    });
    writeSession(SESSION, primary, legacy);
    expect(primary.getItem(SESSION_STORAGE_KEY)).toBe(
      JSON.stringify(SESSION),
    );
    expect(legacy.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('clearing removes the session from both stores', () => {
    const primary = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(SESSION),
    });
    const legacy = memoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(SESSION),
    });
    writeSession(null, primary, legacy);
    expect(primary.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(legacy.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});
