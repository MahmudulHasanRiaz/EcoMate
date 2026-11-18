/**
 * Landing branding + returning-owner sign-in.
 *
 * The platform branding settings (platform name, logoUrl, faviconUrl)
 * live in the control plane and are served by GET /public/branding.
 * fetchBranding() reads them server-side (5-minute revalidate, same as
 * the managed content); when the API is down it falls back to the env
 * values, so the landing never breaks. getBranding() is the env-only
 * fallback (and the unit-test seam).
 *
 *   NEXT_PUBLIC_PLATFORM_NAME  — brand name (default "EcoMate")
 *   NEXT_PUBLIC_LOGO_URL       — logo image URL (default: text brand mark)
 *   NEXT_PUBLIC_PRIMARY_DOMAIN — tenant base domain for sign-in links
 *                                (default "ecomate.bd")
 */

import { SLUG_PATTERN } from './signup-validation';

export interface Branding {
  platformName: string;
  /** Empty string = no logo configured; render the text brand mark. */
  logoUrl: string;
  /** Empty string = no favicon configured; render the built-in icon. */
  faviconUrl: string;
}

export function getBranding(
  env: Record<string, string | undefined> = process.env,
): Branding {
  const platformName = (env.NEXT_PUBLIC_PLATFORM_NAME ?? '').trim() || 'EcoMate';
  const logoUrl = (env.NEXT_PUBLIC_LOGO_URL ?? '').trim();
  return {
    platformName,
    logoUrl: isSafeLogoUrl(logoUrl) ? logoUrl : '',
    faviconUrl: '',
  };
}

function platformApiBase(): string {
  const configured = (
    process.env.PLATFORM_API_URL || 'http://localhost:4100/api'
  ).replace(/\/+$/, '');
  return configured.endsWith('/api') ? configured : `${configured}/api`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Server-side fetch of the managed branding. Never throws: API down,
 * malformed payload, or an unsafe URL all fall back to the env values.
 * Tagged 'branding' so the cache purge revalidates it immediately.
 */
export async function fetchBranding(): Promise<Branding> {
  const fallback = getBranding();
  try {
    const response = await fetch(`${platformApiBase()}/public/branding`, {
      next: { revalidate: 300, tags: ['branding'] },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return fallback;
    const data: unknown = await response.json();
    if (!isRecord(data)) return fallback;
    const platformName =
      typeof data.platformName === 'string' && data.platformName.trim()
        ? data.platformName.trim()
        : fallback.platformName;
    const logoUrl =
      typeof data.logoUrl === 'string' && isSafeLogoUrl(data.logoUrl)
        ? data.logoUrl
        : fallback.logoUrl;
    const faviconUrl =
      typeof data.faviconUrl === 'string' && isSafeLogoUrl(data.faviconUrl)
        ? data.faviconUrl
        : '';
    return { platformName, logoUrl, faviconUrl };
  } catch {
    return fallback;
  }
}

/**
 * A logo/favicon URL is safe as an https URL, a same-origin path, or a
 * data:image/* URL. data: URLs are allowed deliberately: the console
 * stores uploaded logos/favicons as data URLs (operator-controlled, same
 * trust as the console itself), and the CSP already allows `img-src
 * data:`. Anything else (javascript:, http:, protocol-relative) is
 * rejected so a misconfigured value can never turn the brand mark into
 * an XSS or mixed-content vector.
 */
export function isSafeLogoUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** `https://<slug>.<primary-domain>/admin/sign-in`, or null for a bad slug. */
export function tenantAdminSignInUrl(
  slug: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const clean = slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(clean)) return null;
  const domain = (env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? '').trim() || 'ecomate.bd';
  return `https://${clean}.${domain}/admin/sign-in`;
}
