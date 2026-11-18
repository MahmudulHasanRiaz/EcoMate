import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LANDING_SETTINGS,
  fetchLandingSettings,
} from '../landing-settings';

describe('fetchLandingSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the managed settings on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          defaultLocale: 'bn',
          seoIndexingEnabled: false,
        }),
      }),
    );
    await expect(fetchLandingSettings()).resolves.toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
    });
  });

  it('defaults to English + indexing on when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(fetchLandingSettings()).resolves.toEqual(
      DEFAULT_LANDING_SETTINGS,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    await expect(fetchLandingSettings()).resolves.toEqual(
      DEFAULT_LANDING_SETTINGS,
    );
  });

  it('sanitises malformed values instead of crashing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          defaultLocale: 'fr',
          seoIndexingEnabled: 'yes',
        }),
      }),
    );
    await expect(fetchLandingSettings()).resolves.toEqual(
      DEFAULT_LANDING_SETTINGS,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => 'nope',
      }),
    );
    await expect(fetchLandingSettings()).resolves.toEqual(
      DEFAULT_LANDING_SETTINGS,
    );
  });
});
