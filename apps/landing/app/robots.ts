import type { MetadataRoute } from 'next';
import { fetchLandingSettings } from '@/lib/landing-settings';

/**
 * robots.txt: the landing is the public front door — crawl the marketing
 * pages, keep crawlers out of the API rewrite and the token-based
 * verification page. The site URL derives from the primary domain
 * (the landing lives on www.<primary-domain>).
 *
 * Search-engine kill-switch (Batch 1, item 5): when the console's
 * indexing toggle is off (or SEO_INDEXING_ENABLED=false — staging),
 * robots disallows everything and no sitemap is advertised.
 */
function siteUrl(): string {
  const domain =
    (process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? '').trim() || 'ecomate.bd';
  return `https://www.${domain}`;
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { seoIndexingEnabled } = await fetchLandingSettings();
  if (!seoIndexingEnabled) {
    return { rules: [{ userAgent: '*' , disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/verify-email'],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
