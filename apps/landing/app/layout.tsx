import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import {
  Hind_Siliguri,
  Instrument_Serif,
  Inter,
  JetBrains_Mono,
} from 'next/font/google';
import {
  fetchPublicPlans,
  trialCtaCopy,
  trialDaysForPlans,
} from '@/lib/plans';
import './globals.css';

// next/font self-hosts the families and defines these variables on <html>;
// app/globals.css maps them onto the --font-sans / --font-serif /
// --font-bangla / --font-mono names the mk-* classes use.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument-serif',
});
const bangla = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-hind-siliguri',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export async function generateMetadata(): Promise<Metadata> {
  // Trial length comes from the live plan list, never a hardcoded number.
  // The fetch never throws; a downed API just yields the dateless copy.
  const plans = await fetchPublicPlans();
  const trialDays = trialDaysForPlans(
    plans,
    process.env.NEXT_PUBLIC_TRIAL_DAYS,
  );
  const cta = trialCtaCopy(trialDays);
  return {
    title: 'EcoMate — a commerce workspace you own',
    description: `Launch your storefront, run orders and inventory, and keep your data. ${cta}.`,
    other: {
      'theme-color': '#090A0F',
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    // `lang` is `en` here — the root layout is shared by both locales and
    // the locale toggle is client state; `document.lang` syncs in the
    // provider post-hydration. `suppressHydrationWarning` absorbs the
    // resulting `lang` + dark-class mismatches without console noise.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${serif.variable} ${bangla.variable} ${mono.variable}`}
    >
      <body>
        {/* Apply the stored theme (default dark) before paint so the first
            frame matches the design instead of flashing light. The CSP
            allows inline scripts (see next.config.ts). */}
        <Script
          id="ecomate-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('ecomate-theme')!=='light'){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
