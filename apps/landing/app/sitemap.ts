import type { MetadataRoute } from 'next';
import { fetchBlogPosts } from '@/lib/blog';
import { fetchPublicCaseStudies } from '@/lib/case-studies';
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
  // Published case studies only (the fetch is fail-soft: [] when the
  // API is down). The index page is listed only when at least one
  // study is published — an empty index is not worth crawling.
  const studies = await fetchPublicCaseStudies();
  const studyEntries: MetadataRoute.Sitemap =
    studies.length === 0
      ? []
      : [
          {
            url: `${base}/case-studies`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.7,
          },
          ...studies.map((study) => ({
            url: `${base}/case-studies/${study.slug}`,
            lastModified: new Date(study.updatedAt),
            changeFrequency: 'monthly' as const,
            priority: 0.6,
          })),
        ];
  // Published blog posts only (the fetch is fail-soft: empty when the
  // API is down). Same rule as case studies: the /blog index is
  // listed only when at least one post is published.
  const { data: posts } = await fetchBlogPosts({ limit: 100 });
  const blogEntries: MetadataRoute.Sitemap =
    posts.length === 0
      ? []
      : [
          {
            url: `${base}/blog`,
            lastModified: now,
            changeFrequency: 'weekly',
            priority: 0.7,
          },
          ...posts.map((post) => ({
            url: `${base}/blog/${post.slug}`,
            lastModified: new Date(
              post.publishedAt ?? post.updatedAt,
            ),
            changeFrequency: 'monthly' as const,
            priority: 0.6,
          })),
        ];
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
    ...blogEntries,
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
    ...studyEntries,
  ];
}
