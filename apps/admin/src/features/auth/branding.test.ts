import { describe, expect, it } from 'vitest'
import {
  brandingInitials,
  DEFAULT_BRAND_COLORS,
  DEFAULT_LOGIN_METHODS,
  isValidHexColor,
  normalizeBrandColors,
  normalizeBrandDisplay,
  normalizeLoginMethods,
  resolveBrandMark,
  type PublicBranding,
} from './branding'

function makeBranding(overrides: Partial<PublicBranding>): PublicBranding {
  return {
    storeName: '',
    adminTitle: '',
    adminFavicon: '',
    adminTagline: '',
    storefrontFavicon: '',
    storefrontOgImage: '',
    storeLogo: '',
    seoTitle: '',
    seoDescription: '',
    colors: DEFAULT_BRAND_COLORS,
    display: 'name',
    loginMethods: DEFAULT_LOGIN_METHODS,
    ...overrides,
  }
}

describe('normalizeLoginMethods (login round 2)', () => {
  it('defaults to password + email OTP on, phone off, password default when unset', () => {
    expect(normalizeLoginMethods(undefined)).toEqual(DEFAULT_LOGIN_METHODS)
    expect(normalizeLoginMethods(null)).toEqual(DEFAULT_LOGIN_METHODS)
    expect(normalizeLoginMethods('not-an-object')).toEqual(
      DEFAULT_LOGIN_METHODS,
    )
    expect(normalizeLoginMethods({})).toEqual({
      password: true,
      emailOtp: true,
      phoneOtp: false,
      default: 'password',
    })
  })

  it('keeps a stored email-OTP default', () => {
    expect(
      normalizeLoginMethods({
        password: true,
        emailOtp: true,
        phoneOtp: false,
        default: 'emailOtp',
      }),
    ).toEqual({
      password: true,
      emailOtp: true,
      phoneOtp: false,
      default: 'emailOtp',
    })
  })

  it('falls back to the first enabled method when the default is disabled', () => {
    expect(
      normalizeLoginMethods({
        password: false,
        emailOtp: true,
        default: 'password',
      }).default,
    ).toBe('emailOtp')
  })

  it('never offers phone OTP — a stored true is forced off (no SMS provider)', () => {
    expect(
      normalizeLoginMethods({
        password: true,
        emailOtp: true,
        phoneOtp: true,
        default: 'phoneOtp',
      }),
    ).toEqual({
      password: true,
      emailOtp: true,
      phoneOtp: false,
      default: 'password',
    })
  })

  it('falls back to the defaults when everything is off', () => {
    expect(
      normalizeLoginMethods({
        password: false,
        emailOtp: false,
        phoneOtp: false,
        default: 'emailOtp',
      }),
    ).toEqual(DEFAULT_LOGIN_METHODS)
  })
})

describe('brandingInitials', () => {
  it('takes the first letters of the first two words', () => {
    expect(brandingInitials('Features Test Store')).toBe('FT')
  })

  it('takes two letters from a single word', () => {
    expect(brandingInitials('Acme')).toBe('AC')
  })

  it('handles a one-letter name', () => {
    expect(brandingInitials('a')).toBe('A')
  })

  it('returns empty for a blank name', () => {
    expect(brandingInitials('')).toBe('')
    expect(brandingInitials('   ')).toBe('')
  })

  it('ignores extra whitespace between words', () => {
    expect(brandingInitials('My   Shop')).toBe('MS')
  })
})

describe('resolveBrandMark', () => {
  it("shows the store logo alone in 'logo' mode (no name tile)", () => {
    const mark = resolveBrandMark(
      makeBranding({
        storeName: 'Features Test Store',
        storeLogo: '/uploads/logo.png',
        storefrontFavicon: '/uploads/favicon.png',
        display: 'logo',
      }),
    )
    expect(mark.kind).toBe('logo')
    expect(mark.src).toBe('/uploads/logo.png')
    expect(mark.name).toBe('Features Test Store')
  })

  it("falls back to the name text when 'logo' mode has no logo", () => {
    const mark = resolveBrandMark(
      makeBranding({ storeName: 'Features Test Store', display: 'logo' }),
    )
    expect(mark.kind).toBe('name')
    expect(mark.src).toBe('')
    expect(mark.name).toBe('Features Test Store')
  })

  it("shows the storefront favicon beside the name in 'name+logo' mode", () => {
    const mark = resolveBrandMark(
      makeBranding({
        storeName: 'Features Test Store',
        storeLogo: '/uploads/logo.png',
        storefrontFavicon: '/uploads/favicon.png',
        display: 'name+logo',
      }),
    )
    expect(mark.kind).toBe('favicon')
    expect(mark.src).toBe('/uploads/favicon.png')
    expect(mark.name).toBe('Features Test Store')
  })

  it("falls back to the name alone when 'name+logo' mode has no favicon", () => {
    const mark = resolveBrandMark(
      makeBranding({
        storeName: 'Features Test Store',
        storeLogo: '/uploads/logo.png',
        display: 'name+logo',
      }),
    )
    expect(mark.kind).toBe('name')
    expect(mark.src).toBe('')
  })

  it("shows the name alone in 'name' mode even when images are set", () => {
    const mark = resolveBrandMark(
      makeBranding({
        storeName: 'Features Test Store',
        storeLogo: '/uploads/logo.png',
        storefrontFavicon: '/uploads/favicon.png',
        display: 'name',
      }),
    )
    expect(mark.kind).toBe('name')
    expect(mark.src).toBe('')
    expect(mark.name).toBe('Features Test Store')
  })

  it('never renders an initials tile — the storefront has none', () => {
    for (const display of ['name', 'logo', 'name+logo'] as const) {
      const mark = resolveBrandMark(
        makeBranding({ storeName: 'Features Test Store', display }),
      )
      expect(mark.kind).not.toBe('initials')
    }
  })

  it('prefers the admin title over the store name', () => {
    const mark = resolveBrandMark(
      makeBranding({ storeName: 'My Shop', adminTitle: 'My Shop Admin' }),
    )
    expect(mark.name).toBe('My Shop Admin')
    expect(mark.initials).toBe('MS')
  })

  it('defaults the tagline to "Admin Dashboard"', () => {
    expect(
      resolveBrandMark(makeBranding({ storeName: 'My Shop' })).tagline,
    ).toBe('Admin Dashboard')
    expect(
      resolveBrandMark(
        makeBranding({ storeName: 'My Shop', adminTagline: 'Back office' }),
      ).tagline,
    ).toBe('Back office')
  })

  it('returns the generic mark when there is no branding at all', () => {
    for (const branding of [null, undefined, makeBranding({})]) {
      const mark = resolveBrandMark(branding)
      expect(mark.kind).toBe('generic')
      expect(mark.name).toBe('')
      expect(mark.initials).toBe('')
    }
  })
})

describe('normalizeBrandDisplay', () => {
  it('passes the three storefront modes through', () => {
    expect(normalizeBrandDisplay('name')).toBe('name')
    expect(normalizeBrandDisplay('logo')).toBe('logo')
    expect(normalizeBrandDisplay('name+logo')).toBe('name+logo')
  })

  it("falls back to 'name' for anything else", () => {
    expect(normalizeBrandDisplay(undefined)).toBe('name')
    expect(normalizeBrandDisplay(null)).toBe('name')
    expect(normalizeBrandDisplay('banner')).toBe('name')
    expect(normalizeBrandDisplay(42)).toBe('name')
  })
})

describe('normalizeBrandColors (login redesign Step 1)', () => {
  it('returns the storefront defaults when nothing is provided', () => {
    expect(normalizeBrandColors(undefined)).toEqual(DEFAULT_BRAND_COLORS)
    expect(normalizeBrandColors(null)).toEqual(DEFAULT_BRAND_COLORS)
    expect(normalizeBrandColors({})).toEqual(DEFAULT_BRAND_COLORS)
  })

  it('keeps valid configured hex colours', () => {
    const colors = normalizeBrandColors({
      primary: '#123456',
      accent: '#abcdef',
    })
    expect(colors.primary).toBe('#123456')
    expect(colors.accent).toBe('#abcdef')
    expect(colors.primaryDark).toBe(DEFAULT_BRAND_COLORS.primaryDark)
  })

  it('falls back per-key on invalid values instead of passing them through', () => {
    const colors = normalizeBrandColors({
      primary: 'red',
      accent: '#12',
      text: 'javascript:alert(1)',
      border: 123,
    })
    expect(colors.primary).toBe(DEFAULT_BRAND_COLORS.primary)
    expect(colors.accent).toBe(DEFAULT_BRAND_COLORS.accent)
    expect(colors.text).toBe(DEFAULT_BRAND_COLORS.text)
    expect(colors.border).toBe(DEFAULT_BRAND_COLORS.border)
  })

  it('accepts 3-digit hex', () => {
    expect(normalizeBrandColors({ primary: '#abc' }).primary).toBe('#abc')
  })
})

describe('isValidHexColor', () => {
  it('accepts #RGB and #RRGGBB only', () => {
    expect(isValidHexColor('#0089CD')).toBe(true)
    expect(isValidHexColor('#abc')).toBe(true)
    expect(isValidHexColor('#0089CD ')).toBe(true)
    expect(isValidHexColor('0089CD')).toBe(false)
    expect(isValidHexColor('red')).toBe(false)
    expect(isValidHexColor('#12')).toBe(false)
    expect(isValidHexColor('')).toBe(false)
    expect(isValidHexColor(undefined)).toBe(false)
    expect(isValidHexColor(123)).toBe(false)
  })
})
