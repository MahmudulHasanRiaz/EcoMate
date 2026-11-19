import { describe, expect, it } from 'vitest'
import {
  domainStatusMeta,
  errorMessage,
  isForbiddenError,
  isValidHostname,
  normalizeHostnameInput,
  recheckSummary,
  type RecheckResult,
} from './lib'

describe('normalizeHostnameInput', () => {
  it('strips scheme, path, port and trailing dot, and lowercases', () => {
    expect(normalizeHostnameInput('https://Shop.Example.com/')).toBe(
      'shop.example.com',
    )
    expect(normalizeHostnameInput('  shop.example.com:443/path  ')).toBe(
      'shop.example.com',
    )
    expect(normalizeHostnameInput('shop.example.com.')).toBe('shop.example.com')
    expect(normalizeHostnameInput('shop.example.com')).toBe('shop.example.com')
  })
})

describe('isValidHostname', () => {
  it('accepts normal hostnames', () => {
    expect(isValidHostname('shop.example.com')).toBe(true)
    expect(isValidHostname('a.bd')).toBe(true)
    expect(isValidHostname('my-shop123.example-store.com.bd')).toBe(true)
  })

  it('rejects schemes, spaces, uppercase and bad edges', () => {
    expect(isValidHostname('https://shop.example.com')).toBe(false)
    expect(isValidHostname('shop example.com')).toBe(false)
    expect(isValidHostname('Shop.Example.com')).toBe(false)
    expect(isValidHostname('-shop.example.com')).toBe(false)
    expect(isValidHostname('shop.example.com-')).toBe(false)
    expect(isValidHostname('shop')).toBe(false)
    expect(isValidHostname('')).toBe(false)
  })
})

describe('domainStatusMeta', () => {
  it('maps every status to a label and a badge variant', () => {
    expect(domainStatusMeta('VERIFIED')).toEqual({
      label: 'Verified',
      variant: 'success',
    })
    expect(domainStatusMeta('ACTIVE')).toEqual({
      label: 'Verified',
      variant: 'success',
    })
    expect(domainStatusMeta('PENDING')).toEqual({
      label: 'Pending verification',
      variant: 'warning',
    })
    expect(domainStatusMeta('FAILED')).toEqual({
      label: 'Verification failed',
      variant: 'danger',
    })
    expect(domainStatusMeta('DISABLED')).toEqual({
      label: 'Disabled',
      variant: 'secondary',
    })
  })
})

function recheck(
  overrides: Partial<RecheckResult> = {},
): RecheckResult {
  return {
    verified: false,
    domain: {
      id: 'd1',
      host: 'shop.example.com',
      type: 'CUSTOM',
      isPrimary: false,
      status: 'PENDING',
      tlsStatus: null,
      verifiedAt: null,
      lastCheckedAt: null,
      createdAt: '2026-11-18T00:00:00.000Z',
      dns: null,
    },
    checks: {
      txt: { ok: false },
      cname: { ok: false, expected: 'cname.ecomate.bd', found: [] },
    },
    dns: null,
    ...overrides,
  }
}

describe('recheckSummary', () => {
  it('celebrates a verified domain', () => {
    expect(recheckSummary(recheck({ verified: true }))).toContain(
      'Domain verified',
    )
  })

  it('names the missing records', () => {
    expect(recheckSummary(recheck())).toContain('TXT record and CNAME record')
    expect(
      recheckSummary(
        recheck({
          checks: {
            txt: { ok: true },
            cname: { ok: false, expected: 'cname.ecomate.bd', found: [] },
          },
        }),
      ),
    ).toContain('CNAME record')
    expect(
      recheckSummary(
        recheck({
          checks: {
            txt: { ok: false },
            cname: { ok: true, expected: 'cname.ecomate.bd', found: ['cname.ecomate.bd.'] },
          },
        }),
      ),
    ).toContain('TXT record')
  })
})

describe('errorMessage', () => {
  it('prefers the server message, string or array', () => {
    expect(
      errorMessage(
        { response: { data: { message: 'Domain is already assigned' } } },
        'fallback',
      ),
    ).toBe('Domain is already assigned')
    expect(
      errorMessage(
        { response: { data: { message: ['a', 'b'] } } },
        'fallback',
      ),
    ).toBe('a, b')
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('fallback')
    expect(errorMessage({}, 'fallback')).toBe('fallback')
  })
})

describe('isForbiddenError', () => {
  it('detects 403s only', () => {
    expect(isForbiddenError({ response: { status: 403 } })).toBe(true)
    expect(isForbiddenError({ response: { status: 409 } })).toBe(false)
    expect(isForbiddenError(new Error('x'))).toBe(false)
  })
})
