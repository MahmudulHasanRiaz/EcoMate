import { apiClient } from '@/lib/api-client'

/**
 * R-NULL-SETTINGS: SystemSetting values are free-form strings, and some
 * tenants have the literal strings "null" / "undefined" stored (a null
 * stringified on an earlier write path). The settings editors render the
 * value verbatim, so those tenants saw the literal text "null" in App
 * Name / App URL / Admin Email. Sanitize at the API boundary so every
 * consumer (general + storefront editors) sees empty instead of "null".
 * A genuine setting value is never exactly the word "null".
 */
export function sanitizeSettingsMap(
  map: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(map ?? {})) {
    out[key] =
      value === null ||
      value === undefined ||
      value === 'null' ||
      value === 'undefined'
        ? ''
        : String(value)
  }
  return out
}

export const systemSettingsApi = {
  getAll: () =>
    apiClient
      .get<Record<string, string>>('/system-settings')
      .then((r) => ({ ...r, data: sanitizeSettingsMap(r.data) })),
  getStorefrontConfig: () =>
    apiClient.get<{ canonicalDomain?: string }>('/system-settings/storefront'),
  getStorageConfig: () => apiClient.get<any>('/system-settings/storage'),
  set: (key: string, value: string) => apiClient.post(`/system-settings/${key}`, { value }),
}
