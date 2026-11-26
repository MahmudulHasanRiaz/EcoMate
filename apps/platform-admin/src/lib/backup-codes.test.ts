import { describe, expect, it } from 'vitest';
import {
  backupCodesPresentedKey,
  hasLocalBackupCodesPresented,
  markLocalBackupCodesPresented,
} from './backup-codes';

function memoryStore(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('backup-codes presented marker', () => {
  it('is keyed per user id', () => {
    expect(backupCodesPresentedKey('u1')).toBe(
      'ecomate.platform.backup-codes-presented.u1',
    );
    expect(backupCodesPresentedKey('u1')).not.toBe(
      backupCodesPresentedKey('u2'),
    );
  });

  it('starts absent and sticks once marked', () => {
    const store = memoryStore();
    expect(hasLocalBackupCodesPresented('u1', store)).toBe(false);
    markLocalBackupCodesPresented('u1', store);
    expect(hasLocalBackupCodesPresented('u1', store)).toBe(true);
    expect(hasLocalBackupCodesPresented('u2', store)).toBe(false);
  });

  it('tolerates unavailable storage', () => {
    expect(hasLocalBackupCodesPresented('u1', null)).toBe(false);
    expect(() => markLocalBackupCodesPresented('u1', null)).not.toThrow();
  });
});
