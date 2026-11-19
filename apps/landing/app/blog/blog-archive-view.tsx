'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Locale } from '@/lib/landingTypes';
import {
  blogPostDate,
  type PublicBlogPost,
} from '@/lib/blog';

const CHROME: Record<
  Locale,
  {
    empty: string;
    minRead: string;
    readMore: string;
  }
> = {
  en: {
    empty:
      'No posts published yet. Check back soon — or start your own story with a free trial.',
    minRead: 'min read',
    readMore: 'Read the post →',
  },
  bn: {
    empty:
      'এখনো কোনো পোস্ট প্রকাশিত হয়নি। পরে আবার দেখুন — অথবা free trial দিয়ে নিজের গল্প শুরু করুন।',
    minRead: 'মিনিটের পড়া',
    readMore: 'পোস্টটি পড়ুন →',
  },
};

function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Blog archive cards + EN/BN toggle. The posts arrive server-side
 * (already sanitized); the toggle only switches which locale's
 * title/excerpt each card shows — missing Bangla falls back to
 * English, never to a blank card.
 */
export function BlogArchiveView({
  posts,
  defaultLocale,
}: {
  posts: PublicBlogPost[];
  defaultLocale: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const chrome = CHROME[locale];

  return (
    <div>
      <div className="mk-blog-locale" role="group" aria-label="Language">
        <button
          type="button"
          className="mk-blog-locale-btn"
          data-on={locale === 'en' || undefined}
          onClick={() => setLocale('en')}
        >
          English
        </button>
        <button
          type="button"
          className="mk-blog-locale-btn"
          data-on={locale === 'bn' || undefined}
          onClick={() => setLocale('bn')}
        >
          বাংলা
        </button>
      </div>

      {posts.length === 0 ? (
        <p className="mk-blog-empty">{chrome.empty}</p>
      ) : (
        <div className="mk-blog-grid">
          {posts.map((post) => {
            const title =
              (locale === 'bn' ? post.titleBn : post.titleEn) ||
              post.titleEn;
            const excerpt =
              (locale === 'bn' ? post.excerptBn : post.excerptEn) ||
              post.excerptEn ||
              '';
            const categoryName = post.category
              ? (locale === 'bn'
                  ? post.category.nameBn
                  : post.category.nameEn) || post.category.nameEn
              : null;
            const date = formatDate(blogPostDate(post), locale);
            return (
              <Link
                key={post.id}
                className="mk-blog-card"
                href={`/blog/${post.slug}`}
              >
                {post.featuredImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="mk-blog-card-image"
                    src={post.featuredImageUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="mk-blog-card-image mk-blog-card-image--empty"
                    aria-hidden
                  />
                )}
                <span className="mk-blog-card-body">
                  {categoryName && (
                    <span className="mk-blog-card-category">
                      {categoryName}
                    </span>
                  )}
                  <span className="mk-blog-card-title">{title}</span>
                  {excerpt && (
                    <span className="mk-blog-card-excerpt">{excerpt}</span>
                  )}
                  <span className="mk-blog-card-meta">
                    {[post.author, date]
                      .filter(Boolean)
                      .join(' · ')}
                    {post.readTime
                      ? ` · ${post.readTime} ${chrome.minRead}`
                      : ''}
                  </span>
                  <span className="mk-blog-card-more">
                    {chrome.readMore}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
