/**
 * Public landing settings (Batch 1, items 2 + 5): the default locale a
 * first-time visitor sees and the search-engine indexing flag, served by
 * GET /public/landing-settings. Server-side fetch, never throws — an
 * unreachable API yields the defaults (English, indexing on), never a
 * failed page. Tagged 'landing-settings' so the cache purge revalidates
 * it immediately.
 */
import type { Locale } from './landingTypes';

export interface LandingSettings {
  defaultLocale: Locale;
  seoIndexingEnabled: boolean;
}

export const DEFAULT_LANDING_SETTINGS: LandingSettings = {
  defaultLocale: 'en',
  seoIndexingEnabled: true,
};

function platformApiBase(): string {
  const configured = (
    process.env.PLATFORM_API_URL || 'http://localhost:4100/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function fetchLandingSettings(): Promise<LandingSettings> {
  try {
    const response = await fetch(
      `${platformApiBase()}/public/landing-settings`,
      {
        next: { revalidate: 300, tags: ['landing-settings'] },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return DEFAULT_LANDING_SETTINGS;
    const data: unknown = await response.json();
    if (!isRecord(data)) return DEFAULT_LANDING_SETTINGS;
    return {
      defaultLocale:
        data.defaultLocale === 'en' || data.defaultLocale === 'bn'
          ? data.defaultLocale
          : 'en',
      seoIndexingEnabled:
        typeof data.seoIndexingEnabled === 'boolean'
          ? data.seoIndexingEnabled
          : true,
    };
  } catch {
    return DEFAULT_LANDING_SETTINGS;
  }
}
