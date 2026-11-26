import { describe, it, expect } from 'vitest'
import {
  baErrorMessage,
  getBaErrorCode,
  isTwoFactorRequiredError,
  socialCallbackUrls,
} from '../ba-auth-errors'

describe('ba-auth-errors (POS)', () => {
  it('detects TWO_FACTOR_REQUIRED from code and from body.code', () => {
    expect(isTwoFactorRequiredError({ code: 'TWO_FACTOR_REQUIRED' })).toBe(true)
    expect(
      isTwoFactorRequiredError({ body: { code: 'TWO_FACTOR_REQUIRED' } }),
    ).toBe(true)
    expect(isTwoFactorRequiredError({ code: 'INVALID_CREDENTIALS' })).toBe(false)
    expect(isTwoFactorRequiredError(null)).toBe(false)
    expect(isTwoFactorRequiredError(undefined)).toBe(false)
  })

  it('reads the code from wherever the client put it', () => {
    expect(getBaErrorCode({ code: 'X' })).toBe('X')
    expect(getBaErrorCode({ body: { code: 'Y' } })).toBe('Y')
    expect(getBaErrorCode({})).toBeUndefined()
  })

  it('prefers the server message, then the client message, then the fallback', () => {
    expect(
      baErrorMessage({ body: { message: 'Server says no' } }, 'Fallback'),
    ).toBe('Server says no')
    expect(baErrorMessage({ message: 'Client says no' }, 'Fallback')).toBe(
      'Client says no',
    )
    expect(baErrorMessage({ status: 500 }, 'Fallback')).toBe('Fallback (error 500)')
    expect(baErrorMessage(null, 'Fallback')).toBe('Fallback')
  })

  it('points social callbacks at the POS origin', () => {
    const urls = socialCallbackUrls()
    expect(urls.callbackURL).toBe('http://localhost:3000/pos/')
    expect(urls.errorCallbackURL).toBe('http://localhost:3000/pos/')
  })
})
