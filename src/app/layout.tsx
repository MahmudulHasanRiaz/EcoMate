
import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { cn } from '@/lib/utils';
import { ClerkProvider } from '@clerk/nextjs';
// import { Poppins } from 'next/font/google';
import { getBrandingSettings, getGeneralSettings } from '@/server/utils/app-settings';

// Force Node runtime so server components do not run in edge (avoids headers() sync warnings)
export const runtime = 'nodejs';

// const poppins = Poppins({
//   subsets: ['latin'],
//   display: 'swap',
//   variable: '--font-body',
//   weight: ['300', '400', '500', '600', '700']
// });

export async function generateMetadata(): Promise<Metadata> {
  let storeName = 'EcoMate';
  let storeAddress = '';
  let branding = {
    standardLogoUrl: '/logo-full.svg',
    iconLogoUrl: '/favicon.ico',
    appIconUrl: '/icons/icon-512x512.png',
  };

  try {
    const [generalSettings, brandingSettings] = await Promise.all([
      getGeneralSettings(),
      getBrandingSettings(),
    ]);
    storeName = generalSettings.storeName || storeName;
    storeAddress = generalSettings.storeAddress || storeAddress;
    branding = {
      standardLogoUrl: brandingSettings.standardLogoUrl || branding.standardLogoUrl,
      iconLogoUrl: brandingSettings.iconLogoUrl || branding.iconLogoUrl,
      appIconUrl: brandingSettings.appIconUrl || branding.appIconUrl,
    };
  } catch (error) {
    // Build-time or temporary DB unavailability fallback.
    console.warn('[LAYOUT_METADATA_FALLBACK]', error);
  }

  const title = storeName || 'EcoMate';
  const description =
    storeAddress?.trim()?.length
      ? `${title} — ${storeAddress}`
      : 'Manage and grow your fashion business with EcoMate.';

  const favicon = branding.iconLogoUrl || '/favicon.ico';
  const appIcon = branding.appIconUrl || favicon;
  const ogImage = branding.standardLogoUrl || appIcon;
  let metadataBase: URL | undefined;
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      metadataBase = new URL(process.env.NEXT_PUBLIC_APP_URL);
    } catch {
      metadataBase = undefined;
    }
  }

  return {
    title,
    description,
    manifest: '/manifest.webmanifest',
    metadataBase,
    icons: {
      icon: favicon,
      shortcut: favicon,
      apple: appIcon,
    },
    openGraph: {
      title,
      description,
      siteName: title,
      images: [{ url: ogImage }],
      type: 'website',
      url: process.env.NEXT_PUBLIC_APP_URL,
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: [ogImage],
    },
  };
}

import { ThemeProvider } from "@/components/theme-provider";
import { ThemeSync } from '@/components/theme-sync';
import MaintenanceGuard from '@/components/maintenance-guard';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let settings: { theme?: 'light' | 'dark' | 'system' } = { theme: 'system' };
  try {
    settings = await getGeneralSettings();
  } catch (error) {
    console.warn('[LAYOUT_SETTINGS_FALLBACK]', error);
  }
  const defaultTheme = (settings as any).theme || 'system';
  const forcedTheme = defaultTheme === 'system' ? undefined : defaultTheme;

  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
          />
          <meta name="theme-color" content="#2563eb" />
          {/* Capture PWA install prompt ASAP and register Service Worker — before React hydrates */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                window.addEventListener('beforeinstallprompt',function(e){
                  e.preventDefault();
                  window.__pwaInstallPrompt=e;
                });
                if ('serviceWorker' in navigator) {
                  window.addEventListener('load', function() {
                    navigator.serviceWorker.register('/sw.js', { scope: '/' });
                  });
                }
              `.replace(/\s+/g, ' '),
            }}
          />
        </head>
        <body
          className={cn("font-sans antialiased", /*poppins.variable*/)}
          suppressHydrationWarning={true}
        >
          <ThemeProvider
            attribute="class"
            defaultTheme={defaultTheme}
            forcedTheme={forcedTheme}
            enableSystem
            disableTransitionOnChange
            storageKey="ecomate-theme"
          >
            <ThemeSync theme={defaultTheme} />
            <MaintenanceGuard>
              {children}
            </MaintenanceGuard>
            <Toaster />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
