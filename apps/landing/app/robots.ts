import type { MetadataRoute } from 'next';

/**
 * robots.txt: the landing is the public front door — crawl the marketing
 * pages, keep crawlers out of the API rewrite and the token-based
 * verification page. The site URL derives from the primary domain
 * (the landing lives on www.<primary-domain>).
 */
function siteUrl(): string {
  const domain =
    (process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? '').trim() || 'ecomate.bd';
  return `https://www.${domain}`;
}

export default function robots(): MetadataRoute.Robots {
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
