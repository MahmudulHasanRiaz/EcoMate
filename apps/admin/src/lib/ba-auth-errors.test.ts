import { describe, expect, it } from 'vitest'
import {
  baErrorMessage,
  getBaErrorCode,
  isTwoFactorRequiredError,
  socialCallbackUrls,
  SOCIAL_PROVIDERS,
} from './ba-auth-errors'

describe('ba-auth-errors (Phase 3)', () => {
  describe('getBaErrorCode', () => {
    it('reads a top-level code', () => {
      expect(getBaErrorCode({ code: 'TWO_FACTOR_REQUIRED' })).toBe('TWO_FACTOR_REQUIRED')
    })

    it('reads a nested body.code', () => {
      expect(getBaErrorCode({ body: { code: 'INVALID_TOKEN' } })).toBe('INVALID_TOKEN')
    })

    it('prefers the top-level code over body.code', () => {
      expect(getBaErrorCode({ code: 'A', body: { code: 'B' } })).toBe('A')
    })

    it('returns undefined for null, undefined, and code-less errors', () => {
      expect(getBaErrorCode(null)).toBeUndefined()
      expect(getBaErrorCode(undefined)).toBeUndefined()
      expect(getBaErrorCode({ message: 'boom' })).toBeUndefined()
      expect(getBaErrorCode({ body: 'plain string body' })).toBeUndefined()
    })
  })

  describe('baErrorMessage', () => {
    it('prefers body.message', () => {
      expect(
        baErrorMessage({ body: { message: 'Server said no' }, message: 'client text' }, 'Fallback'),
      ).toBe('Server said no')
    })

    it('falls back to the top-level message', () => {
      expect(baErrorMessage({ message: 'Bad password' }, 'Fallback')).toBe('Bad password')
    })

    it('appends the status when there is no message', () => {
      expect(baErrorMessage({ status: 429 }, 'Too many attempts')).toBe('Too many attempts (error 429)')
    })

    it('returns the fallback for null/empty errors', () => {
      expect(baErrorMessage(null, 'Fallback')).toBe('Fallback')
      expect(baErrorMessage({}, 'Fallback')).toBe('Fallback')
    })
  })

  describe('isTwoFactorRequiredError', () => {
    it('matches TWO_FACTOR_REQUIRED at the top level and in the body', () => {
      expect(isTwoFactorRequiredError({ code: 'TWO_FACTOR_REQUIRED' })).toBe(true)
      expect(isTwoFactorRequiredError({ body: { code: 'TWO_FACTOR_REQUIRED' } })).toBe(true)
    })

    it('rejects other codes and null', () => {
      expect(isTwoFactorRequiredError({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe(false)
      expect(isTwoFactorRequiredError(null)).toBe(false)
    })
  })

  describe('SOCIAL_PROVIDERS', () => {
    it('lists Google, GitHub, and Facebook', () => {
      expect(SOCIAL_PROVIDERS.map((p) => p.id)).toEqual(['google', 'github', 'facebook'])
    })
  })

  describe('socialCallbackUrls', () => {
    it('builds callback + error URLs on the current origin under /admin', () => {
      const { callbackURL, errorCallbackURL } = socialCallbackUrls('/op/orders')
      expect(callbackURL).toBe(`${window.location.origin}/admin/op/orders`)
      expect(errorCallbackURL).toBe(`${window.location.origin}/admin/sign-in`)
    })

    it('defaults the callback to / when no redirect is given', () => {
      const { callbackURL } = socialCallbackUrls()
      expect(callbackURL).toBe(`${window.location.origin}/admin/`)
    })

    it('ignores a redirectTo that is not an absolute path', () => {
      const { callbackURL } = socialCallbackUrls('https://evil.example/x')
      expect(callbackURL).toBe(`${window.location.origin}/admin/`)
    })
  })
})
