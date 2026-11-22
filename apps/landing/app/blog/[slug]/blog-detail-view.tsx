'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MediaGallery } from '@/components/media-gallery';
import type { Locale } from '@/lib/landingTypes';
import { blogPostDate, type PublicBlogPost } from '@/lib/blog';
import {
  isDirectVideoFile,
  resolveMedia,
  resolveThumbnail,
  videoEmbedUrl,
} from '@/lib/content-media';

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
 * Blog detail: hero (title, meta, resolved thumbnail), all videos
 * stacked below the hero (YouTube/Vimeo embed, <video> for uploads,
 * plain link otherwise), sanitized body, image gallery after the body
 * (shared MediaGallery: grid + lightbox), tags. EN/BN toggle switches
 * title/body — missing Bangla falls back to English, never to a blank
 * page. The HTML rendered here was sanitized server-side at fetch
 * time (lib/blog.ts) — this component never sanitizes or trusts raw
 * input. Media resolves new-first with legacy fallback
 * (resolveMedia), so pre-backfill posts render identically.
 */
export function BlogDetailView({
  post,
  defaultLocale,
}: {
  post: PublicBlogPost;
  defaultLocale: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const chrome = CHROME[locale];

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
  const media = resolveMedia(post);
  const thumbnail = resolveThumbnail(media);
  // The thumbnail video plays first, then the gallery — deduped, so
  // a video that is both thumbnail and gallery entry plays once.
  const playList = [
    ...(media.thumbnailType === 'video' && media.thumbnailVideoUrl
      ? [{ url: media.thumbnailVideoUrl }]
      : []),
    ...media.videos,
  ].filter(
    (video, index, all) =>
      all.findIndex((other) => other.url === video.url) === index,
  );

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

      {thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="mk-blog-hero-image"
          src={thumbnail}
          alt=""
        />
      )}

      {playList.map((video, index) => {
        const embedUrl = videoEmbedUrl(video.url);
        const videoTitle = video.title || title;
        if (embedUrl) {
          return (
            <div
              key={`${video.url}-${index}`}
              className="mk-vid-frame mk-blog-video"
            >
              <iframe
                src={embedUrl}
                title={videoTitle}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          );
        }
        if (isDirectVideoFile(video.url)) {
          return (
            <video
              key={`${video.url}-${index}`}
              className="mk-blog-hero-image"
              src={video.url}
              poster={thumbnail ?? undefined}
              controls
              preload="metadata"
            />
          );
        }
        return (
          <p key={`${video.url}-${index}`} className="mk-blog-video-link">
            <a href={video.url} target="_blank" rel="noreferrer">
              {chrome.watchVideo}
            </a>
          </p>
        );
      })}

      <div
        className="mk-prose"
        dangerouslySetInnerHTML={{ __html: content }}
      />

      <MediaGallery
        images={media.galleryImages}
        heading={chrome.gallery}
        closeLabel={chrome.close}
      />

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
    </article>
  );
}
