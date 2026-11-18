import { describe, expect, it } from 'vitest'
import { sanitizeSettingsMap } from './storage-api'

// R-NULL-SETTINGS: some tenants have the literal strings "null" /
// "undefined" stored as setting values (a null stringified on an earlier
// write path). The settings editors render values verbatim, so those
// tenants saw the literal text "null" in App Name / App URL / Admin
// Email. The sanitizer maps them to '' at the API boundary.
describe('sanitizeSettingsMap', () => {
  it('maps null, undefined and the literal strings "null"/"undefined" to empty', () => {
    expect(
      sanitizeSettingsMap({
        app_name: 'null',
        app_url: 'undefined',
        admin_email: null,
        store_name: undefined,
      }),
    ).toEqual({
      app_name: '',
      app_url: '',
      admin_email: '',
      store_name: '',
    })
  })

  it('leaves genuine values untouched, including values containing "null"', () => {
    expect(
      sanitizeSettingsMap({
        app_name: 'Null & Co',
        app_url: 'https://example.com',
        admin_email: 'admin@example.com',
      }),
    ).toEqual({
      app_name: 'Null & Co',
      app_url: 'https://example.com',
      admin_email: 'admin@example.com',
    })
  })

  it('returns an empty map for null/undefined input', () => {
    expect(sanitizeSettingsMap(null)).toEqual({})
    expect(sanitizeSettingsMap(undefined)).toEqual({})
  })
})
