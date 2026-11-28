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
 * the name alone is the real path for that tenant today. A store
 * whose brand system says `display: 'logo'` gets its store logo; one
 * that says `'name+logo'` gets its storefront favicon beside the name.
 * The display mode is the storefront's own setting (`store_systems`),
 * never a second login setting.
 */

/**
 * The tenant's brand colours (login redesign Step 1). Same keys +
 * defaults as `GET /system-settings/storefront` — one default family
 * everywhere. The admin login reads them from
 * `GET /system-settings/branding` (unauthenticated, pre-login) and
 * applies them as SCOPED CSS vars on the auth wrapper only; the global
 * `--primary` (#4f6bf2) is never touched, so the logged-in admin keeps
 * its fixed brand.
 */
export interface BrandColors {
  primary: string
  primaryDark: string
  accent: string
  text: string
  background: string
  success: string
  danger: string
  border: string
}

export const DEFAULT_BRAND_COLORS: BrandColors = {
  primary: '#0089CD',
  primaryDark: '#006da3',
  accent: '#E77250',
  text: '#0a0a0a',
  background: '#FFFFFF',
  success: '#22C55E',
  danger: '#EF4444',
  border: '#E5E7EB',
}

/** A stored colour must be a valid hex value — anything else is a fallback. */
export function isValidHexColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
  )
}

/** Fail-soft: a partial/invalid payload degrades per-key to the defaults. */
export function normalizeBrandColors(data: unknown): BrandColors {
  const record = (data ?? {}) as Record<string, unknown>
  const pick = (key: keyof BrandColors): string =>
    isValidHexColor(record[key]) ? (record[key] as string).trim() : DEFAULT_BRAND_COLORS[key]
  return {
    primary: pick('primary'),
    primaryDark: pick('primaryDark'),
    accent: pick('accent'),
    text: pick('text'),
    background: pick('background'),
    success: pick('success'),
    danger: pick('danger'),
    border: pick('border'),
  }
}

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
  colors: BrandColors
  /**
   * Login polish: the storefront header's brand display mode — the
   * FIRST brand system's `display` from the `store_systems` setting,
   * served by `GET /system-settings/branding` as `display`. This is
   * the ONLY display setting: the login header renders exactly what
   * the storefront header renders for the same tenant ('logo' =
   * logo only, 'name+logo' = favicon + name side by side,
   * 'name' = name only). An old backend sends none — 'name'.
   */
  display: BrandDisplay
}

/** The storefront header's display modes (StoreBrand / Footer). */
export type BrandDisplay = 'name' | 'logo' | 'name+logo'

/** Fail-soft: only the three known modes pass through, else 'name'. */
export function normalizeBrandDisplay(value: unknown): BrandDisplay {
  return value === 'logo' || value === 'name+logo' || value === 'name'
    ? value
    : 'name'
}

export type BrandMarkKind = 'logo' | 'favicon' | 'name' | 'generic'

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
 * Resolve what the auth header shows — driven ONLY by the storefront's
 * own display mode (`branding.display`, systems[0].display), exactly
 * like the storefront header (StoreBrand): 'logo' shows the store
 * logo on its own (wide/short logos render as-is; no name, no tile),
 * 'name+logo' shows the storefront favicon beside the name, 'name'
 * shows the name alone. The initials tile is gone: the storefront
 * never renders one, so the login must not either. Fallbacks stay
 * inside the mode — a missing logo in 'logo' mode falls back to the
 * name text, a missing favicon in 'name+logo' mode to the name alone
 * — and with no brand at all the generic EcoMate mark shows (also
 * the while-loading state, so the header never flashes a wrong brand).
 */
export function resolveBrandMark(
  branding: PublicBranding | null | undefined,
): BrandMark {
  const name = (branding?.adminTitle || branding?.storeName || '').trim()
  const tagline = (branding?.adminTagline || '').trim() || 'Admin Dashboard'
  const initials = brandingInitials(name)
  const display = normalizeBrandDisplay(branding?.display)
  if (display === 'logo') {
    const storeLogo = (branding?.storeLogo || '').trim()
    if (storeLogo) {
      return { kind: 'logo', src: storeLogo, name, tagline, initials }
    }
    if (name) {
      return { kind: 'name', src: '', name, tagline, initials }
    }
    return { kind: 'generic', src: '', name: '', tagline, initials: '' }
  }
  if (display === 'name+logo') {
    const storefrontFavicon = (branding?.storefrontFavicon || '').trim()
    if (storefrontFavicon && name) {
      return { kind: 'favicon', src: storefrontFavicon, name, tagline, initials }
    }
    if (name) {
      return { kind: 'name', src: '', name, tagline, initials }
    }
    return { kind: 'generic', src: '', name: '', tagline, initials: '' }
  }
  if (name) {
    return { kind: 'name', src: '', name, tagline, initials }
  }
  return { kind: 'generic', src: '', name: '', tagline, initials: '' }
}
