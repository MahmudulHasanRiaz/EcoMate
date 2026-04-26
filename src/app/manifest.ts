import type { MetadataRoute } from 'next';
import { getBrandingSettings, getGeneralSettings } from '@/server/utils/app-settings';

export const runtime = 'nodejs';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
    let branding: { appIconUrl?: string } = { appIconUrl: '/icons/icon-512x512.png' };
    let general: { storeName?: string; storeAddress?: string } = { storeName: 'Fashionary', storeAddress: '' };

    try {
        [branding, general] = await Promise.all([getBrandingSettings(), getGeneralSettings()]);
    } catch (error) {
        // During build or if DB is temporarily unavailable, fall back to defaults.
        console.warn('[MANIFEST_FALLBACK]', error);
    }

    const name = general.storeName || 'Fashionary';
    const description =
        general.storeAddress?.trim()?.length
            ? `${name} - ${general.storeAddress}`
            : 'Manage and grow your fashion business.';

    // Prefer configured app icon when available; fall back to bundled ones
    const appIcon = branding.appIconUrl || '/icons/icon-512x512.png';

    return {
        name,
        short_name: name,
        description,
        start_url: '/dashboard',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        background_color: '#ffffff',
        theme_color: '#2563eb',
        icons: [
            {
                src: '/icons/icon-192x192.png',
                sizes: '192x192',
                type: 'image/png',
            },
            {
                src: '/icons/icon-512x512.png',
                sizes: '512x512',
                type: 'image/png',
            },
            {
                src: '/icons/icon-maskable-192x192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'maskable',
            },
            {
                src: '/icons/icon-maskable-512x512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
            // App icon from settings (might be same as above; still list for completeness)
            {
                src: appIcon,
                sizes: '512x512',
                type: 'image/png',
            },
        ],
    };
}
