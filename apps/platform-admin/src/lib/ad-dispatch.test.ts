import { describe, expect, it } from 'vitest';
import {
  AD_TRACKING_PLATFORMS,
  adDispatchStatusLabel,
  adDispatchTone,
  adPlatformLabel,
} from './ad-dispatch';

describe('ad-dispatch lib', () => {
  it('lists Meta + TikTok with distinct ids and default event names', () => {
    expect(AD_TRACKING_PLATFORMS.map((p) => p.id)).toEqual([
      'meta',
      'tiktok',
    ]);
    expect(
      AD_TRACKING_PLATFORMS.find((p) => p.id === 'meta')?.defaultEventName,
    ).toBe('Lead');
    expect(
      AD_TRACKING_PLATFORMS.find((p) => p.id === 'tiktok')?.defaultEventName,
    ).toBe('SubmitForm');
  });

  it('labels known platforms and passes unknown ids through', () => {
    expect(adPlatformLabel('meta')).toBe('Meta');
    expect(adPlatformLabel('tiktok')).toBe('TikTok');
    expect(adPlatformLabel('future')).toBe('future');
  });

  it('labels dispatch statuses', () => {
    expect(adDispatchStatusLabel('pending')).toBe('Pending');
    expect(adDispatchStatusLabel('sent')).toBe('Sent');
    expect(adDispatchStatusLabel('failed')).toBe('Failed');
    expect(adDispatchStatusLabel('weird')).toBe('weird');
  });

  it('tones follow the semantic mapping (sent indigo, pending amber, failed red)', () => {
    expect(adDispatchTone('sent')).toBe('accent');
    expect(adDispatchTone('pending')).toBe('warning');
    expect(adDispatchTone('failed')).toBe('danger');
    expect(adDispatchTone('weird')).toBe('warning');
  });
});
