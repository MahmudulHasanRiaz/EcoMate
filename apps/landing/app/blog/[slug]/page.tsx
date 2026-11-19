import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { fetchBlogPost } from '@/lib/blog';
import { fetchLandingSettings } from '@/lib/landing-settings';
import { BlogDetailView } from './blog-detail-view';

function siteUrl(): string {
  const domain =
    (process.env.NEXT_PUBLIC_PRIMARY_DOMAIN ?? '').trim() || 'ecomate.bd';
  return `https://www.${domain}`;
}

/**
 * Per-post SEO from the post's own SEO fields (default locale, else
 * English, else the post title/excerpt). Canonical URL is the
 * operator-set canonical when present. Drafts/scheduled-not-due/
 * deleted posts 404 here (the public API only serves visible posts),
 * so search engines never see them.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [post, settings] = await Promise.all([
    fetchBlogPost(slug),
    fetchLandingSettings(),
  ]);
  if (!post) return { title: 'Post not found — EcoMate' };
  const locale = settings.defaultLocale;
  const title =
    (locale === 'bn' ? post.seoTitleBn : post.seoTitleEn) ||
    post.seoTitleEn ||
    (locale === 'bn' ? post.titleBn : post.titleEn) ||
    post.titleEn;
  const description =
    (locale === 'bn' ? post.seoDescBn : post.seoDescEn) ||
    post.seoDescEn ||
    (locale === 'bn' ? post.excerptBn : post.excerptEn) ||
    post.excerptEn ||
    undefined;
  return {
    title: `${title} — EcoMate`,
    description,
    alternates: post.canonicalUrl
      ? { canonical: post.canonicalUrl }
      : { canonical: `${siteUrl()}/blog/${post.slug}` },
    openGraph: {
      title: `${title} — EcoMate`,
      description,
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      authors: post.author ? [post.author] : undefined,
      images: post.featuredImageUrl
        ? [{ url: post.featuredImageUrl }]
        : undefined,
    },
  };
}

/**
 * Public blog detail (/blog/[slug]). Server-rendered; the fetch never
 * throws — a missing/unpublished post 404s, an unreachable API 404s
 * too (fail-soft: the archive still renders).
 */
export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [post, settings] = await Promise.all([
    fetchBlogPost(slug),
    fetchLandingSettings(),
  ]);
  if (!post) notFound();
  return (
    <>
      <SiteHeader />
      <main className="mk-legal mk-blog-detail">
        <BlogDetailView post={post} defaultLocale={settings.defaultLocale} />
      </main>
    </>
  );
}
