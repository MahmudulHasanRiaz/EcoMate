import { describe, expect, it } from 'vitest';
import { accessLabel, PLATFORM_ROLES, roleLabel } from './users';

describe('role labels', () => {
  it('labels all four platform roles', () => {
    expect(PLATFORM_ROLES).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
      'READONLY',
    ]);
    expect(roleLabel('SUPERADMIN')).toBe('Superadmin');
    expect(roleLabel('READONLY')).toBe('Read-only');
    expect(roleLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('labels all four access levels', () => {
    expect(accessLabel('none')).toBe('None');
    expect(accessLabel('read')).toBe('Read');
    expect(accessLabel('write')).toBe('Write');
    expect(accessLabel('full')).toBe('Full');
  });
});
