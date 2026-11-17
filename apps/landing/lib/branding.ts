/**
 * Landing branding + returning-owner sign-in.
 *
 * The platform branding settings (platform name, logoUrl) live in the
 * control plane and have no public endpoint yet, so the landing reads
 * them from environment until a public branding endpoint exists:
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
}

export function getBranding(
  env: Record<string, string | undefined> = process.env,
): Branding {
  const platformName = (env.NEXT_PUBLIC_PLATFORM_NAME ?? '').trim() || 'EcoMate';
  const logoUrl = (env.NEXT_PUBLIC_LOGO_URL ?? '').trim();
  return { platformName, logoUrl: isSafeLogoUrl(logoUrl) ? logoUrl : '' };
}

/**
 * A logo URL is safe only as an https URL or a same-origin path. Anything
 * else (javascript:, data:, http:, protocol-relative) is rejected so a
 * misconfigured env value can never turn the brand mark into an XSS or
 * mixed-content vector.
 */
export function isSafeLogoUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
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
