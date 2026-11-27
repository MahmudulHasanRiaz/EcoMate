import { describe, expect, it } from 'vitest'
import {
  brandingInitials,
  DEFAULT_BRAND_COLORS,
  isValidHexColor,
  normalizeBrandColors,
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
    ...overrides,
  }
}

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
  it('prefers the store logo when one is set', () => {
    const mark = resolveBrandMark(
      makeBranding({
        storeName: 'Features Test Store',
        storeLogo: '/uploads/logo.png',
        adminFavicon: '/uploads/favicon.png',
      }),
    )
    expect(mark.kind).toBe('logo')
    expect(mark.src).toBe('/uploads/logo.png')
    expect(mark.name).toBe('Features Test Store')
    expect(mark.initials).toBe('FT')
  })

  it('falls back to the admin favicon when there is no logo', () => {
    const mark = resolveBrandMark(
      makeBranding({
        storeName: 'Features Test Store',
        adminFavicon: '/uploads/favicon.png',
      }),
    )
    expect(mark.kind).toBe('favicon')
    expect(mark.src).toBe('/uploads/favicon.png')
  })

  it('falls back to an initials tile when no image is set', () => {
    const mark = resolveBrandMark(
      makeBranding({ storeName: 'Features Test Store' }),
    )
    expect(mark.kind).toBe('initials')
    expect(mark.src).toBe('')
    expect(mark.initials).toBe('FT')
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
