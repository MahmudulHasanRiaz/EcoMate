import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import {
  fetchBlogCategories,
  fetchBlogPosts,
} from '@/lib/blog';
import { fetchLandingSettings } from '@/lib/landing-settings';
import { BlogArchiveView } from './blog-archive-view';

export const metadata: Metadata = {
  title: 'Blog — EcoMate',
  description:
    'Guides, product news, and commerce lessons from the team building EcoMate.',
};

/**
 * Public blog archive (/blog). Server-rendered from the published
 * posts; the fetches never throw — an unreachable API renders the
 * empty state, never a failed page. Category/tag filters are
 * server-side links (?category= / ?tag=); the EN/BN toggle lives in
 * the client view below (locale is client state on this landing).
 */
export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    tag?: string;
    search?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const [list, categories, settings] = await Promise.all([
    fetchBlogPosts({
      page,
      limit: 12,
      category: params.category,
      tag: params.tag,
      search: params.search,
    }),
    fetchBlogCategories(),
    fetchLandingSettings(),
  ]);

  const tagFilter = params.tag ?? '';
  const categoryFilter = params.category ?? '';
  const baseParams = new URLSearchParams();
  if (tagFilter) baseParams.set('tag', tagFilter);
  if (params.search) baseParams.set('search', params.search);
  const pageHref = (nextPage: number) => {
    const qs = new URLSearchParams(baseParams);
    if (categoryFilter) qs.set('category', categoryFilter);
    if (nextPage > 1) qs.set('page', String(nextPage));
    const query = qs.toString();
    return query ? `/blog?${query}` : '/blog';
  };
  const categoryHref = (slug: string | null) => {
    const qs = new URLSearchParams(baseParams);
    if (slug) qs.set('category', slug);
    const query = qs.toString();
    return query ? `/blog?${query}` : '/blog';
  };
  // Clear-tag keeps the category/search filters, drops only the tag.
  const clearTagHref = (() => {
    const qs = new URLSearchParams();
    if (categoryFilter) qs.set('category', categoryFilter);
    if (params.search) qs.set('search', params.search);
    const query = qs.toString();
    return query ? `/blog?${query}` : '/blog';
  })();

  return (
    <>
      <SiteHeader />
      <main className="mk-legal mk-blog-list">
        <p className="eyebrow">Blog</p>
        <h1>Notes from the EcoMate team</h1>
        <p className="mk-blog-intro">
          Guides, product news, and commerce lessons from the team
          building EcoMate.
        </p>

        {categories.length > 0 && (
          <nav
            className="mk-blog-filters"
            aria-label="Filter posts by category"
          >
            <Link
              className="mk-blog-chip"
              data-on={!categoryFilter || undefined}
              href={categoryHref(null)}
            >
              All
            </Link>
            {categories.map((category) => (
              <Link
                key={category.id}
                className="mk-blog-chip"
                data-on={
                  categoryFilter === category.slug || undefined
                }
                href={categoryHref(category.slug)}
              >
                {category.nameEn} ({category.postCount})
              </Link>
            ))}
          </nav>
        )}

        {tagFilter && (
          <p className="mk-blog-tag-filter">
            Tagged “{tagFilter}” ·{' '}
            <Link href={clearTagHref}>Clear filter</Link>
          </p>
        )}

        <BlogArchiveView
          posts={list.data}
          defaultLocale={settings.defaultLocale}
        />

        {list.meta.totalPages > 1 && (
          <nav className="mk-blog-pager" aria-label="Blog pages">
            {list.meta.page > 1 ? (
              <Link
                className="mk-btn mk-btn-sm"
                href={pageHref(list.meta.page - 1)}
              >
                ← Newer posts
              </Link>
            ) : (
              <span />
            )}
            <span className="mk-blog-pager-info">
              Page {list.meta.page} of {list.meta.totalPages}
            </span>
            {list.meta.page < list.meta.totalPages ? (
              <Link
                className="mk-btn mk-btn-sm"
                href={pageHref(list.meta.page + 1)}
              >
                Older posts →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </main>
    </>
  );
}
