'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/landingTypes';
import {
  blogPostDate,
  youtubeEmbedUrl,
  type PublicBlogPost,
} from '@/lib/blog';

const CHROME: Record<
  Locale,
  {
    back: string;
    minRead: string;
    gallery: string;
    watchVideo: string;
    tags: string;
    close: string;
  }
> = {
  en: {
    back: '← Back to blog',
    minRead: 'min read',
    gallery: 'Gallery',
    watchVideo: 'Watch the video ↗',
    tags: 'Tags',
    close: 'Close',
  },
  bn: {
    back: '← ব্লগে ফিরুন',
    minRead: 'মিনিটের পড়া',
    gallery: 'গ্যালারি',
    watchVideo: 'ভিডিও দেখুন ↗',
    tags: 'ট্যাগ',
    close: 'বন্ধ করুন',
  },
};

function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Blog detail: hero (title, meta, featured image), video embed below
 * the hero, sanitized body, gallery grid after the body (click to
 * enlarge in a lightbox), tags. EN/BN toggle switches title/body —
 * missing Bangla falls back to English, never to a blank page.
 * The HTML rendered here was sanitized server-side at fetch time
 * (lib/blog.ts) — this component never sanitizes or trusts raw input.
 */
export function BlogDetailView({
  post,
  defaultLocale,
}: {
  post: PublicBlogPost;
  defaultLocale: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const chrome = CHROME[locale];

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const title =
    (locale === 'bn' ? post.titleBn : post.titleEn) || post.titleEn;
  const content =
    (locale === 'bn' ? post.contentBn : post.contentEn) ||
    post.contentEn;
  const categoryName = post.category
    ? (locale === 'bn' ? post.category.nameBn : post.category.nameEn) ||
      post.category.nameEn
    : null;
  const date = formatDate(blogPostDate(post), locale);
  const embedUrl = youtubeEmbedUrl(post.videoUrl);

  return (
    <article>
      <div className="mk-blog-detail-top">
        <Link className="mk-blog-back" href="/blog">
          {chrome.back}
        </Link>
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
      </div>

      {categoryName && (
        <p className="eyebrow">
          <Link href={`/blog?category=${post.category!.slug}`}>
            {categoryName}
          </Link>
        </p>
      )}
      <h1>{title}</h1>
      <p className="mk-blog-detail-meta">
        {[post.author, date].filter(Boolean).join(' · ')}
        {post.readTime ? ` · ${post.readTime} ${chrome.minRead}` : ''}
      </p>

      {post.featuredImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="mk-blog-hero-image"
          src={post.featuredImageUrl}
          alt=""
        />
      )}

      {post.videoUrl &&
        (embedUrl ? (
          <div className="mk-vid-frame mk-blog-video">
            <iframe
              src={embedUrl}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="mk-blog-video-link">
            <a href={post.videoUrl} target="_blank" rel="noreferrer">
              {chrome.watchVideo}
            </a>
          </p>
        ))}

      <div
        className="mk-prose"
        dangerouslySetInnerHTML={{ __html: content }}
      />

      {post.galleryUrls.length > 0 && (
        <section aria-label={chrome.gallery}>
          <h2 className="mk-blog-gallery-heading">{chrome.gallery}</h2>
          <div className="mk-blog-gallery">
            {post.galleryUrls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                className="mk-blog-gallery-item"
                onClick={() => setLightbox(url)}
                aria-label={`Open image ${index + 1} full size`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      )}

      {post.tags.length > 0 && (
        <p className="mk-blog-tags">
          <span className="mk-blog-tags-label">{chrome.tags}: </span>
          {post.tags.map((tag, index) => (
            <span key={tag.id}>
              {index > 0 && ' · '}
              <Link href={`/blog?tag=${tag.slug}`}>
                {(locale === 'bn' ? tag.nameBn : tag.nameEn) || tag.nameEn}
              </Link>
            </span>
          ))}
        </p>
      )}

      {lightbox && (
        <div
          className="mk-blog-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={chrome.gallery}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="mk-blog-lightbox-close"
            onClick={() => setLightbox(null)}
          >
            {chrome.close} ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </article>
  );
}
