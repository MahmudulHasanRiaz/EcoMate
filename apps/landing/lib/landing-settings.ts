/**
 * Public landing settings (Batch 1, items 2 + 5): the default locale a
 * first-time visitor sees and the search-engine indexing flag, served by
 * GET /public/landing-settings. Server-side fetch, never throws — an
 * unreachable API yields the defaults (English, indexing on), never a
 * failed page. Tagged 'landing-settings' so the cache purge revalidates
 * it immediately.
 *
 * The endpoint also serves the UI-managed landing origin + tenant base
 * domain (domain configurability): the landing derives its canonical
 * URLs and tenant sign-in links from them at RUNTIME instead of the
 * build-time NEXT_PUBLIC_PRIMARY_DOMAIN. The env var remains the
 * fail-soft fallback when the API is down or predates the fields.
 */
import type { Locale } from './landingTypes';

export interface LandingSettings {
  defaultLocale: Locale;
  seoIndexingEnabled: boolean;
  /** Full landing origin (canonical URLs, robots, sitemap). */
  landingUrl: string;
  /** Tenant base domain (`{slug}.{tenantDomain}` sign-in links). */
  tenantDomain: string;
}

function defaultTenantDomain(): string {
  return (
    (process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? '').trim() || 'ecomate.bd'
  );
}

function defaultLandingUrl(): string {
  return `https://www.${defaultTenantDomain()}`;
}

export const DEFAULT_LANDING_SETTINGS: LandingSettings = {
  defaultLocale: 'en',
  seoIndexingEnabled: true,
  landingUrl: defaultLandingUrl(),
  tenantDomain: defaultTenantDomain(),
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

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
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
    const landingUrl =
      typeof data.landingUrl === 'string' &&
      isValidHttpUrl(data.landingUrl.trim())
        ? data.landingUrl.trim().replace(/\/+$/, '')
        : DEFAULT_LANDING_SETTINGS.landingUrl;
    const tenantDomain =
      typeof data.tenantDomain === 'string' &&
      HOSTNAME_RE.test(data.tenantDomain.trim().toLowerCase())
        ? data.tenantDomain.trim().toLowerCase()
        : DEFAULT_LANDING_SETTINGS.tenantDomain;
    return {
      defaultLocale:
        data.defaultLocale === 'en' || data.defaultLocale === 'bn'
          ? data.defaultLocale
          : 'en',
      seoIndexingEnabled:
        typeof data.seoIndexingEnabled === 'boolean'
          ? data.seoIndexingEnabled
          : true,
      landingUrl,
      tenantDomain,
    };
  } catch {
    return DEFAULT_LANDING_SETTINGS;
  }
}
