import { describe, expect, it, beforeEach } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { useEntitlementsStore } from '@/stores/entitlements-store'
import { requireFeature } from './require-feature'

function setEntitlements(features: string[], loaded: boolean) {
  useEntitlementsStore.setState({ features, previousFeatures: features, loaded })
}

function redirectOptions(fn: () => unknown) {
  try {
    fn()
    expect.unreachable('should have thrown')
  } catch (e) {
    expect(isRedirect(e)).toBe(true)
    return (e as unknown as { options: { to?: string; search?: unknown } }).options
  }
  throw new Error('unreachable')
}

describe('requireFeature', () => {
  beforeEach(() => {
    setEntitlements([], false)
  })

  it('lets an entitled tenant through BEFORE the layout fetch sets loaded (refresh race)', () => {
    // Regression test for the SMTP guard defect: beforeLoad runs before
    // the authenticated layout mounts, so `loaded` is still false on a
    // full reload / direct navigation — but the store already hydrated
    // the feature list from localStorage, so the guard must not bounce.
    setEntitlements(['smtp_server'], false)

    expect(() => requireFeature('smtp_server')).not.toThrow()
  })

  it('lets the * wildcard through before loaded', () => {
    setEntitlements(['*'], false)

    expect(() => requireFeature('smtp_server')).not.toThrow()
  })

  it('lets an entitled tenant through after loaded', () => {
    setEntitlements(['smtp_server'], true)

    expect(() => requireFeature('smtp_server')).not.toThrow()
  })

  it('redirects a tenant WITHOUT the feature to /feature-unavailable (before loaded)', () => {
    setEntitlements(['admin_products'], false)

    const options = redirectOptions(() => requireFeature('smtp_server'))
    expect(options.to).toBe('/feature-unavailable')
    expect(options.search).toEqual({ feature: 'smtp_server' })
  })

  it('redirects a tenant WITHOUT the feature to /feature-unavailable (after loaded)', () => {
    setEntitlements(['admin_products'], true)

    const options = redirectOptions(() => requireFeature('smtp_server'))
    expect(options.to).toBe('/feature-unavailable')
    expect(options.search).toEqual({ feature: 'smtp_server' })
  })

  it('redirects when the entitlement list is empty', () => {
    setEntitlements([], true)

    const options = redirectOptions(() => requireFeature('smtp_server'))
    expect(options.to).toBe('/feature-unavailable')
  })
})
