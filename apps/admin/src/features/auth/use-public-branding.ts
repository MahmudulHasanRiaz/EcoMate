import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import type { PublicBranding } from './branding'

/**
 * Public tenant branding for the auth pages — no session needed
 * (`GET /system-settings/branding` is @Public on the tenant backend).
 * One cached fetch per session (`['public-branding']`, 5-minute
 * staleTime); a failure simply falls back to the generic mark, it
 * never blocks sign-in.
 */
export function usePublicBranding(): {
  branding: PublicBranding | null
  isLoading: boolean
  isError: boolean
} {
  const query = useQuery({
    queryKey: ['public-branding'],
    queryFn: async (): Promise<PublicBranding> => {
      const res = await apiClient.get('/system-settings/branding')
      return normalizeBranding(res.data)
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
  return {
    branding: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

/** Fail-soft: a malformed payload degrades to empty branding, never a crash. */
function normalizeBranding(data: unknown): PublicBranding {
  const record = (data ?? {}) as Record<string, unknown>
  const str = (key: string): string =>
    typeof record[key] === 'string' ? (record[key] as string) : ''
  return {
    storeName: str('storeName'),
    adminTitle: str('adminTitle'),
    adminFavicon: str('adminFavicon'),
    adminTagline: str('adminTagline'),
    storefrontFavicon: str('storefrontFavicon'),
    storefrontOgImage: str('storefrontOgImage'),
    storeLogo: str('storeLogo'),
    seoTitle: str('seoTitle'),
    seoDescription: str('seoDescription'),
  }
}
