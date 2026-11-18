import type { MetadataRoute } from 'next';
import { fetchLandingSettings } from '@/lib/landing-settings';

/**
 * Minimal sitemap: the public landing pages (no tenant or token routes).
 *
 * Search-engine kill-switch (Batch 1, item 5): when indexing is off,
 * the sitemap is empty (and robots.txt stops advertising it).
 */
function siteUrl(): string {
  const domain =
    (process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? '').trim() || 'ecomate.bd';
  return `https://www.${domain}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { seoIndexingEnabled } = await fetchLandingSettings();
  if (!seoIndexingEnabled) return [];
  const base = siteUrl();
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${base}/signup`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}/sign-in`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${base}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
