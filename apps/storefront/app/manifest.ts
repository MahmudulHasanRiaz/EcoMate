import type { MetadataRoute } from 'next'
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server'
import { hasPlanFeature } from '@/lib/api/storefront-config'

// Per-host manifest: the same path returns a different tenant's branding.
export const dynamic = 'force-dynamic'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  try {
    const config = await getStorefrontConfigServer()
    const planFeatures: string[] = (config as any)?.planFeatures ?? [];
    const hasMobileDistro = hasPlanFeature({ planFeatures }, 'mobile_distribution');

    // Without mobile distribution: return non-installable manifest
    if (!hasMobileDistro) {
      return {
        name: config.store.name || 'EcoMate',
        short_name: config.store.name || 'EcoMate',
        description: config.seo.description || '',
        start_url: '/',
        display: 'browser',
        background_color: '#ffffff',
        theme_color: config.branding?.colors?.primary || '#0089CD',
      };
    }

    let faviconUrl = config.branding?.storefrontFavicon || '/favicon.svg'
    const primaryColor = config.branding?.colors?.primary || '#0089CD'
    const faviconPngUrl = faviconUrl.replace(/\.svg$/, '.png')
    return {
      name: config.store.name || 'EcoMate',
      short_name: config.store.name || 'EcoMate',
      description: config.seo.description || '',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: primaryColor,
      icons: [
        { src: faviconUrl, sizes: 'any', type: 'image/svg+xml' },
        { src: faviconPngUrl, sizes: '192x192', type: 'image/png' },
        { src: faviconPngUrl, sizes: '512x512', type: 'image/png' },
        { src: faviconPngUrl, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }
  } catch {
    return {
      name: 'EcoMate',
      short_name: 'EcoMate',
      description: '',
      start_url: '/',
      display: 'browser',
      background_color: '#ffffff',
      theme_color: '#0089CD',
    }
  }
}
