/**
 * Tenant branding for the public auth pages (sign-in, sign-up,
 * forgot-password, reset-password).
 *
 * The brand lives in the TENANT backend, not the platform DB: the
 * `SystemSetting` rows `store_name` / `admin_title` / `admin_favicon` /
 * `admin_tagline` / `store_logo` (Settings → Branding & Identity) are
 * served unauthenticated by `GET /system-settings/branding`
 * (`getPublicBranding`, @Public in the backend). The platform `Tenant`
 * model has no logo/favicon field, so this is the only tenant brand
 * source — nothing is invented here.
 *
 * Live fact (2026-11-27, staging): Features Test Store has
 * `storeName: "Features Test Store"` and EVERY image field empty, so
 * the initials mark is the real path for that tenant today. A store
 * that uploads a logo in Settings → Branding gets the logo; one that
 * sets only an admin favicon gets the favicon tile.
 */

export interface PublicBranding {
  storeName: string
  adminTitle: string
  adminFavicon: string
  adminTagline: string
  storefrontFavicon: string
  storefrontOgImage: string
  storeLogo: string
  seoTitle: string
  seoDescription: string
}

export type BrandMarkKind = 'logo' | 'favicon' | 'initials' | 'generic'

export interface BrandMark {
  kind: BrandMarkKind
  /** Image URL for the logo/favicon kinds, '' otherwise. */
  src: string
  /** Display name: admin title, else store name, else ''. */
  name: string
  /** Tagline shown under the name (default 'Admin Dashboard'). */
  tagline: string
  /** Initials derived from the name ('' when there is no name). */
  initials: string
}

/**
 * First letters of the first two words, upper-cased.
 * "Features Test Store" → "FT", "Acme" → "AC", "" → "".
 */
export function brandingInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

/**
 * Resolve what the auth header shows. Precedence: store logo, then
 * admin favicon, then an initials tile from the store name, then the
 * generic EcoMate mark (also the while-loading state — the header
 * never flashes a wrong brand).
 */
export function resolveBrandMark(
  branding: PublicBranding | null | undefined,
): BrandMark {
  const name = (branding?.adminTitle || branding?.storeName || '').trim()
  const tagline = (branding?.adminTagline || '').trim() || 'Admin Dashboard'
  const initials = brandingInitials(name)
  const storeLogo = (branding?.storeLogo || '').trim()
  if (storeLogo) {
    return { kind: 'logo', src: storeLogo, name, tagline, initials }
  }
  const adminFavicon = (branding?.adminFavicon || '').trim()
  if (adminFavicon) {
    return { kind: 'favicon', src: adminFavicon, name, tagline, initials }
  }
  if (name) {
    return { kind: 'initials', src: '', name, tagline, initials }
  }
  return { kind: 'generic', src: '', name: '', tagline, initials: '' }
}
