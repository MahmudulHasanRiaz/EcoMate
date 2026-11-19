import { describe, expect, it } from 'vitest';
import {
  accessLabel,
  PLATFORM_ROLES,
  roleLabel,
  sessionDeviceLabel,
} from './users';

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

describe('session device labels', () => {
  it('shortens common browser user-agents', () => {
    expect(
      sessionDeviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 120 · macOS');
    expect(
      sessionDeviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      ),
    ).toBe('Firefox 121 · Windows');
    expect(
      sessionDeviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 17 · iOS');
  });

  it('falls back for unknown or missing agents', () => {
    expect(sessionDeviceLabel(null)).toBe('Unknown device');
    expect(sessionDeviceLabel('')).toBe('Unknown device');
    expect(sessionDeviceLabel('curl/8.0')).toBe('curl/8.0');
    expect(sessionDeviceLabel('x'.repeat(60))).toBe(`${'x'.repeat(45)}…`);
  });
});
